/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv, proposeMapping } from '@/engine/db/csv';
import { type DatabaseHandle, openDatabase } from '@/engine/db/database';
import { importCsv } from '@/engine/db/import';
import { migrate, tableColumns } from '@/engine/db/schema';
import { isErr, isOk } from '@/lib/result';

let db: DatabaseHandle;

beforeEach(async () => {
  const opened = await openDatabase();
  if (!isOk(opened)) throw new Error('could not open database');
  db = opened.value;
  migrate(db);
});

function rows(sql: string) {
  const result = db.query(sql);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value.rows;
}

function planFor(csv: string, mode: 'replace' | 'append' = 'replace') {
  const parsed = parseCsv(csv);
  if (!isOk(parsed)) throw new Error(parsed.error.message);

  const columns = tableColumns(db, 'guests');
  if (!isOk(columns)) throw new Error(columns.error.message);

  return {
    parsed: parsed.value,
    plan: {
      table: 'guests',
      mode,
      mappings: proposeMapping(parsed.value.columns, columns.value),
    } as const,
  };
}

describe('importCsv', () => {
  it('inserts mapped rows', () => {
    const { parsed, plan } = planFor('first_name,last_name\nAda,Lovelace\nGrace,Hopper');
    const report = importCsv(db, parsed, plan);

    if (!isOk(report)) throw new Error(report.error.message);
    expect(report.value.inserted).toBe(2);
    expect(rows('SELECT first_name, last_name FROM guests ORDER BY id')).toEqual([
      { first_name: 'Ada', last_name: 'Lovelace' },
      { first_name: 'Grace', last_name: 'Hopper' },
    ]);
  });

  it('creates columns the table does not have', () => {
    const { parsed, plan } = planFor('first_name,last_name,nickname\nAda,Lovelace,Addy');
    const report = importCsv(db, parsed, plan);

    if (!isOk(report)) throw new Error(report.error.message);
    expect(report.value.createdColumns).toEqual(['nickname']);
    expect(rows('SELECT nickname FROM guests')).toEqual([{ nickname: 'Addy' }]);
  });

  it('coerces booleans to SQLite integers', () => {
    const { parsed, plan } = planFor(
      'first_name,last_name,is_vegetarian\nAda,Lovelace,yes\nGrace,Hopper,no',
    );
    importCsv(db, parsed, plan);

    expect(rows('SELECT is_vegetarian FROM guests ORDER BY id')).toEqual([
      { is_vegetarian: 1 },
      { is_vegetarian: 0 },
    ]);
  });

  it('stores a blank cell as NULL, not an empty string', () => {
    // A place card bound to a blank field must hit its fallback, and the
    // fallback triggers on NULL. An empty string would render as nothing.
    const { parsed, plan } = planFor('first_name,last_name,seat_number\nAda,Lovelace,');
    importCsv(db, parsed, plan);
    expect(rows('SELECT seat_number FROM guests')).toEqual([{ seat_number: null }]);
  });

  it('ignores columns mapped to ignore', () => {
    const { parsed, plan } = planFor('id,first_name,last_name\n99,Ada,Lovelace');
    importCsv(db, parsed, plan);
    // AUTOINCREMENT assigns 1; the CSV's id was not written.
    expect(rows('SELECT id FROM guests')).toEqual([{ id: 1 }]);
  });
});

describe('replace vs append', () => {
  it('replace clears existing rows first', () => {
    const first = planFor('first_name,last_name\nAda,Lovelace');
    importCsv(db, first.parsed, first.plan);

    const second = planFor('first_name,last_name\nGrace,Hopper');
    importCsv(db, second.parsed, second.plan);

    expect(rows('SELECT first_name FROM guests')).toEqual([{ first_name: 'Grace' }]);
  });

  it('re-importing the same file does not duplicate', () => {
    const csv = 'first_name,last_name\nAda,Lovelace\nGrace,Hopper';
    const first = planFor(csv);
    importCsv(db, first.parsed, first.plan);
    const second = planFor(csv);
    importCsv(db, second.parsed, second.plan);

    expect(rows('SELECT COUNT(*) AS c FROM guests')[0]).toEqual({ c: 2 });
  });

  it('append keeps existing rows', () => {
    const first = planFor('first_name,last_name\nAda,Lovelace');
    importCsv(db, first.parsed, first.plan);

    const second = planFor('first_name,last_name\nGrace,Hopper', 'append');
    importCsv(db, second.parsed, second.plan);

    expect(rows('SELECT COUNT(*) AS c FROM guests')[0]).toEqual({ c: 2 });
  });
});

describe('atomicity', () => {
  it('rolls the whole import back when a row violates a constraint', () => {
    // Row 2 has no last_name, which is NOT NULL. Half-importing a guest list
    // is worse than not importing it: the user cannot tell what is missing.
    const { parsed, plan } = planFor(
      'first_name,last_name,rsvp_status\nAda,Lovelace,Accepted\nGrace,Hopper,Maybe\nJean,Bartik,Accepted',
    );
    const report = importCsv(db, parsed, plan);

    expect(isErr(report)).toBe(true);
    expect(rows('SELECT COUNT(*) AS c FROM guests')[0]).toEqual({ c: 0 });
  });

  it('names the offending row number in the error', () => {
    const { parsed, plan } = planFor(
      'first_name,last_name,rsvp_status\nAda,Lovelace,Accepted\nGrace,Hopper,Maybe',
    );
    const report = importCsv(db, parsed, plan);

    expect(isErr(report)).toBe(true);
    if (isErr(report)) {
      expect(report.error.code).toBe('CSV_IMPORT_FAILED');
      expect(report.error.message).toMatch(/row 2/i);
    }
  });

  it('leaves previously imported data untouched when a later import fails', () => {
    const good = planFor('first_name,last_name\nAda,Lovelace');
    importCsv(db, good.parsed, good.plan);

    const bad = planFor('first_name,last_name,rsvp_status\nGrace,Hopper,Nope');
    importCsv(db, bad.parsed, bad.plan);

    expect(rows('SELECT first_name FROM guests')).toEqual([{ first_name: 'Ada' }]);
  });
});

describe('scale', () => {
  it('imports 5000 rows in one transaction, under two seconds', () => {
    const lines = ['first_name,last_name'];
    for (let i = 0; i < 5000; i += 1) {
      lines.push(`First${i},Last${i}`);
    }
    const { parsed, plan } = planFor(lines.join('\n'));

    const started = Date.now();
    const report = importCsv(db, parsed, plan);
    const elapsed = Date.now() - started;

    if (!isOk(report)) throw new Error(report.error.message);
    expect(report.value.inserted).toBe(5000);
    expect(elapsed).toBeLessThan(2000);
  });
});
