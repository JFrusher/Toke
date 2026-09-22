/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, openDatabase } from '@/engine/db/database';
import { columnSchemaFor, runRecordSource } from '@/engine/db/recordSource';
import { migrate } from '@/engine/db/schema';
import { isErr, isOk } from '@/lib/result';

let db: DatabaseHandle;

beforeEach(async () => {
  const opened = await openDatabase();
  if (!isOk(opened)) throw new Error('could not open database');
  db = opened.value;
  migrate(db);

  db.exec("INSERT INTO event_tables (table_number, table_name) VALUES (1, 'Top Table')");
  db.exec(
    `INSERT INTO guests (first_name, last_name, rsvp_status, is_vegetarian, table_id, seat_number)
     VALUES ('Ada','Lovelace','Accepted',1,1,1),
            ('Grace','Hopper','Accepted',0,1,2),
            ('Jean','Bartik','Declined',0,NULL,NULL)`,
  );
});

function run(sql: string) {
  const result = runRecordSource(db, sql);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
}

describe('runRecordSource', () => {
  it('returns the rows the query selects', () => {
    const set = run("SELECT first_name, last_name FROM guests WHERE rsvp_status = 'Accepted'");
    expect(set.rows).toEqual([
      { first_name: 'Ada', last_name: 'Lovelace' },
      { first_name: 'Grace', last_name: 'Hopper' },
    ]);
  });

  it('reports the row count that drives the print run', () => {
    const set = run("SELECT * FROM guests WHERE rsvp_status = 'Accepted'");
    expect(set.rowCount).toBe(2);
  });

  it('carries the originating SQL for the diagnostics panel', () => {
    const sql = 'SELECT first_name FROM guests';
    expect(run(sql).sql).toBe(sql);
  });

  it('treats zero rows as a valid empty state, not an error', () => {
    // A filter matching nobody is an ordinary intermediate state while the
    // user is editing the query, not a failure.
    const set = run("SELECT * FROM guests WHERE rsvp_status = 'Nonexistent'");
    expect(set.rows).toEqual([]);
    expect(set.rowCount).toBe(0);
    expect(set.columns.length).toBeGreaterThan(0);
  });

  it('supports joins across tables', () => {
    const set = run(
      `SELECT g.first_name, t.table_name
       FROM guests g JOIN event_tables t ON g.table_id = t.id
       ORDER BY g.id`,
    );
    expect(set.rows[0]).toEqual({ first_name: 'Ada', table_name: 'Top Table' });
  });

  it('returns an error for invalid SQL rather than throwing', () => {
    const result = runRecordSource(db, 'SELECT * FROM nope');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('SQL_ERROR');
  });

  it('rejects a statement that writes', () => {
    // A record source is evaluated on every preview and every export. If it
    // could mutate, cycling records would quietly rewrite the guest list.
    const result = runRecordSource(db, "DELETE FROM guests WHERE first_name = 'Ada'");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('RECORD_SOURCE_NOT_READONLY');

    const check = db.query('SELECT COUNT(*) AS c FROM guests');
    if (!isOk(check)) throw new Error('query failed');
    expect(check.value.rows[0]).toEqual({ c: 3 });
  });

  it('rejects multiple statements', () => {
    const result = runRecordSource(db, 'SELECT 1; DROP TABLE guests;');
    expect(isErr(result)).toBe(true);
  });

  it('allows a leading WITH clause', () => {
    const set = run(
      `WITH accepted AS (SELECT * FROM guests WHERE rsvp_status = 'Accepted')
       SELECT first_name FROM accepted ORDER BY id`,
    );
    expect(set.rows).toHaveLength(2);
  });
});

describe('columnSchemaFor', () => {
  it('infers a type per column from the result set', () => {
    const set = run('SELECT first_name, seat_number FROM guests ORDER BY id');
    const schema = columnSchemaFor(set);

    expect(schema).toEqual([
      { name: 'first_name', type: 'text' },
      { name: 'seat_number', type: 'integer' },
    ]);
  });

  it('infers boolean for a 0/1 column', () => {
    const set = run('SELECT is_vegetarian FROM guests ORDER BY id');
    expect(columnSchemaFor(set)[0]).toEqual({ name: 'is_vegetarian', type: 'boolean' });
  });

  it('ignores NULLs when inferring', () => {
    const set = run('SELECT seat_number FROM guests ORDER BY id');
    expect(columnSchemaFor(set)[0]?.type).toBe('integer');
  });

  it('falls back to text for an all-NULL column', () => {
    const set = run('SELECT location_zone FROM event_tables');
    expect(columnSchemaFor(set)[0]).toEqual({ name: 'location_zone', type: 'text' });
  });

  it('reports columns even when the result set is empty', () => {
    // The Inspector's field picker must still populate while a filter matches
    // nothing, otherwise editing the query becomes impossible.
    const set = run('SELECT first_name, last_name FROM guests WHERE 0');
    expect(columnSchemaFor(set).map((c) => c.name)).toEqual(['first_name', 'last_name']);
  });
});
