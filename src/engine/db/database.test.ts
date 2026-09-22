/**
 * @vitest-environment node
 *
 * Exercises real sql.js against a real in-memory database. No mocks: the
 * whole point of this layer is that SQLite behaves the way we think it does.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, openDatabase } from '@/engine/db/database';
import { isErr, isOk } from '@/lib/result';

let db: DatabaseHandle;

async function open(): Promise<DatabaseHandle> {
  const result = await openDatabase();
  if (!isOk(result)) {
    throw new Error(`could not open database: ${result.error.message}`);
  }
  return result.value;
}

beforeEach(async () => {
  db = await open();
});

describe('openDatabase', () => {
  it('answers the simplest possible query', () => {
    const result = db.query('SELECT 1 AS one');
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rows).toEqual([{ one: 1 }]);
  });

  it('reports column names', () => {
    const result = db.query('SELECT 1 AS alpha, 2 AS beta');
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.columns.map((c) => c.name)).toEqual(['alpha', 'beta']);
  });

  it('enables foreign key enforcement on open', () => {
    // SQLite defaults this OFF. Without it every FOREIGN KEY in the schema is
    // decorative, and orphaned rows accumulate silently.
    const result = db.query('PRAGMA foreign_keys');
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rows[0]).toEqual({ foreign_keys: 1 });
  });
});

describe('query', () => {
  beforeEach(() => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL, blob BLOB)');
    db.exec("INSERT INTO t (name, score) VALUES ('Ada', 9.5), ('Grace', 8), (NULL, NULL)");
  });

  it('returns every row as an object', () => {
    const result = db.query('SELECT id, name FROM t ORDER BY id');
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rows).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' },
      { id: 3, name: null },
    ]);
  });

  it('preserves SQL NULL as null, not undefined or empty string', () => {
    const result = db.query('SELECT name FROM t WHERE id = 3');
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rows[0]).toEqual({ name: null });
  });

  it('binds positional parameters', () => {
    const result = db.query('SELECT name FROM t WHERE score > ?', [9]);
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rows).toEqual([{ name: 'Ada' }]);
  });

  it('binds a parameter that would be an injection if interpolated', () => {
    const result = db.query('SELECT name FROM t WHERE name = ?', ["'; DROP TABLE t; --"]);
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rows).toEqual([]);
    expect(isOk(db.query('SELECT 1 FROM t'))).toBe(true);
  });

  it('returns an empty result set rather than an error for no matches', () => {
    const result = db.query('SELECT * FROM t WHERE id = 999');
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rows).toEqual([]);
    expect(result.value.columns.length).toBeGreaterThan(0);
  });
});

describe('errors', () => {
  it('returns a structured error for invalid SQL instead of throwing', () => {
    const result = db.query('SELECT * FROM does_not_exist');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('SQL_ERROR');
      expect(result.error.message).toMatch(/does_not_exist/);
    }
  });

  it('stays usable after a failed query', () => {
    // A dead connection after one typo in the SQL console would be unusable.
    db.query('THIS IS NOT SQL');
    expect(isOk(db.query('SELECT 1 AS one'))).toBe(true);
  });

  it('rejects a foreign key violation, proving the pragma is live', () => {
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))');
    const result = db.exec('INSERT INTO child (parent_id) VALUES (42)');
    expect(isErr(result)).toBe(true);
  });
});

describe('exec', () => {
  it('reports rows modified', () => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)');
    const result = db.exec('INSERT INTO t (n) VALUES (1), (2), (3)');
    if (!isOk(result)) throw new Error(result.error.message);
    expect(result.value.rowsModified).toBe(3);
  });

  it('runs multiple statements in one call', () => {
    const result = db.exec('CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER);');
    expect(isOk(result)).toBe(true);
    expect(isOk(db.query('SELECT * FROM a'))).toBe(true);
    expect(isOk(db.query('SELECT * FROM b'))).toBe(true);
  });
});

describe('transactions', () => {
  beforeEach(() => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
  });

  it('commits a successful transaction', () => {
    const result = db.transaction(() => {
      db.exec('INSERT INTO t (n) VALUES (1)');
      db.exec('INSERT INTO t (n) VALUES (2)');
      return true;
    });

    expect(isOk(result)).toBe(true);
    const rows = db.query('SELECT COUNT(*) AS c FROM t');
    if (!isOk(rows)) throw new Error('query failed');
    expect(rows.value.rows[0]).toEqual({ c: 2 });
  });

  it('rolls the whole batch back when one statement fails', () => {
    // CSV import depends on this: a bad row mid-file must leave the table
    // untouched rather than half-populated.
    const result = db.transaction(() => {
      db.exec('INSERT INTO t (n) VALUES (1)');
      const bad = db.exec('INSERT INTO t (n) VALUES (NULL)');
      if (isErr(bad)) throw new Error('constraint violated');
      return true;
    });

    expect(isErr(result)).toBe(true);
    const rows = db.query('SELECT COUNT(*) AS c FROM t');
    if (!isOk(rows)) throw new Error('query failed');
    expect(rows.value.rows[0]).toEqual({ c: 0 });
  });
});

describe('export and restore', () => {
  it('round trips the database through bytes', () => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO t (name) VALUES ('Ada')");

    const bytes = db.export();
    expect(bytes.byteLength).toBeGreaterThan(0);

    return openDatabase({ bytes }).then((restored) => {
      if (!isOk(restored)) throw new Error('restore failed');
      const rows = restored.value.query('SELECT name FROM t');
      if (!isOk(rows)) throw new Error('query failed');
      expect(rows.value.rows).toEqual([{ name: 'Ada' }]);
    });
  });
});
