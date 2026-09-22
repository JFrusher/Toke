/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, openDatabase } from '@/engine/db/database';
import { currentVersion, migrate, SCHEMA_VERSION, tableColumns } from '@/engine/db/schema';
import { isErr, isOk } from '@/lib/result';

let db: DatabaseHandle;

beforeEach(async () => {
  const opened = await openDatabase();
  if (!isOk(opened)) throw new Error('could not open database');
  db = opened.value;
});

function rows(sql: string) {
  const result = db.query(sql);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value.rows;
}

describe('migrate', () => {
  it('brings a fresh database to the current version', () => {
    const result = migrate(db);
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value).toEqual({ from: 0, to: SCHEMA_VERSION });
  });

  it('creates the three starter tables', () => {
    migrate(db);
    const names = rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['event_tables', 'guests', 'menu_selections', 'schema_version']),
    );
  });

  it('is a no-op when run again', () => {
    migrate(db);
    const second = migrate(db);
    if (!isOk(second)) throw new Error(second.error.message);
    expect(second.value).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
  });

  it('does not duplicate data when run twice', () => {
    migrate(db);
    db.exec("INSERT INTO guests (first_name, last_name) VALUES ('Ada', 'Lovelace')");
    migrate(db);
    expect(rows('SELECT COUNT(*) AS c FROM guests')[0]).toEqual({ c: 1 });
  });

  it('reports the version through currentVersion', () => {
    expect(currentVersion(db)).toEqual({ ok: true, value: 0 });
    migrate(db);
    expect(currentVersion(db)).toEqual({ ok: true, value: SCHEMA_VERSION });
  });
});

describe('guests', () => {
  beforeEach(() => {
    migrate(db);
  });

  it('requires a first and last name', () => {
    expect(isErr(db.exec("INSERT INTO guests (last_name) VALUES ('Lovelace')"))).toBe(true);
    expect(isErr(db.exec("INSERT INTO guests (first_name) VALUES ('Ada')"))).toBe(true);
  });

  it('defaults rsvp_status to Pending', () => {
    db.exec("INSERT INTO guests (first_name, last_name) VALUES ('Ada', 'Lovelace')");
    expect(rows('SELECT rsvp_status FROM guests')[0]).toEqual({ rsvp_status: 'Pending' });
  });

  it('rejects an rsvp_status outside the allowed set', () => {
    const result = db.exec(
      "INSERT INTO guests (first_name, last_name, rsvp_status) VALUES ('Ada', 'L', 'Maybe')",
    );
    expect(isErr(result)).toBe(true);
  });

  it('accepts each allowed rsvp_status', () => {
    for (const status of ['Accepted', 'Declined', 'Pending']) {
      const result = db.exec(
        'INSERT INTO guests (first_name, last_name, rsvp_status) VALUES (?, ?, ?)',
        ['A', 'B', status],
      );
      expect(isOk(result)).toBe(true);
    }
  });

  it('rejects a table_id that does not exist', () => {
    // Proves PRAGMA foreign_keys is actually in force, not merely declared.
    const result = db.exec(
      "INSERT INTO guests (first_name, last_name, table_id) VALUES ('Ada', 'L', 99)",
    );
    expect(isErr(result)).toBe(true);
  });

  it('accepts a valid table_id', () => {
    db.exec("INSERT INTO event_tables (table_number, table_name) VALUES (1, 'Top Table')");
    const result = db.exec(
      "INSERT INTO guests (first_name, last_name, table_id) VALUES ('Ada', 'L', 1)",
    );
    expect(isOk(result)).toBe(true);
  });
});

describe('event_tables', () => {
  beforeEach(() => {
    migrate(db);
  });

  it('enforces a unique table_number', () => {
    db.exec("INSERT INTO event_tables (table_number, table_name) VALUES (1, 'One')");
    const duplicate = db.exec(
      "INSERT INTO event_tables (table_number, table_name) VALUES (1, 'Also One')",
    );
    expect(isErr(duplicate)).toBe(true);
  });

  it('defaults capacity to 10', () => {
    db.exec("INSERT INTO event_tables (table_number, table_name) VALUES (1, 'One')");
    expect(rows('SELECT capacity FROM event_tables')[0]).toEqual({ capacity: 10 });
  });
});

describe('menu_selections', () => {
  beforeEach(() => {
    migrate(db);
    db.exec("INSERT INTO guests (first_name, last_name) VALUES ('Ada', 'Lovelace')");
  });

  it('allows one selection per guest', () => {
    const first = db.exec("INSERT INTO menu_selections (guest_id, main_choice) VALUES (1, 'Beef')");
    expect(isOk(first)).toBe(true);
  });

  it('rejects a second selection for the same guest', () => {
    // The PRD modelled this 1:1 but omitted the constraint, so nothing stopped
    // a guest accumulating contradictory menu rows.
    db.exec("INSERT INTO menu_selections (guest_id, main_choice) VALUES (1, 'Beef')");
    const duplicate = db.exec(
      "INSERT INTO menu_selections (guest_id, main_choice) VALUES (1, 'Fish')",
    );
    expect(isErr(duplicate)).toBe(true);
  });

  it('rejects a selection for a guest that does not exist', () => {
    expect(
      isErr(db.exec("INSERT INTO menu_selections (guest_id, main_choice) VALUES (99, 'Beef')")),
    ).toBe(true);
  });
});

describe('tableColumns', () => {
  beforeEach(() => {
    migrate(db);
  });

  it('introspects the guests table', () => {
    const result = tableColumns(db, 'guests');
    if (!isOk(result)) throw new Error(result.error.message);

    const names = result.value.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'first_name', 'last_name', 'rsvp_status', 'table_id']),
    );
  });

  it('reports declared types and nullability', () => {
    const result = tableColumns(db, 'guests');
    if (!isOk(result)) throw new Error(result.error.message);

    const firstName = result.value.find((c) => c.name === 'first_name');
    expect(firstName).toMatchObject({ declaredType: 'TEXT', notNull: true });

    const seat = result.value.find((c) => c.name === 'seat_number');
    expect(seat).toMatchObject({ declaredType: 'INTEGER', notNull: false });
  });

  it('errors for a table that does not exist', () => {
    expect(isErr(tableColumns(db, 'nope'))).toBe(true);
  });
});
