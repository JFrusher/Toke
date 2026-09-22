import type { DatabaseHandle } from '@/engine/db/database';
import type { Row } from '@/engine/db/protocol';
import { appError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * Starter schema and a forward-only migration runner.
 *
 * Migrations are append-only: never edit a shipped migration, add another.
 * A project file (P4.2) carries a database written by whatever version created
 * it, and editing history would silently corrupt older files on open.
 */

export type Migration = {
  readonly version: number;
  readonly up: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE event_tables (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        table_number  INTEGER NOT NULL UNIQUE,
        table_name    TEXT    NOT NULL,
        capacity      INTEGER DEFAULT 10,
        location_zone TEXT
      );

      CREATE TABLE guests (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name           TEXT NOT NULL,
        last_name            TEXT NOT NULL,
        dietary_requirements TEXT    DEFAULT 'None',
        is_vegetarian        BOOLEAN DEFAULT 0,
        is_plus_one          BOOLEAN DEFAULT 0,
        table_id             INTEGER,
        seat_number          INTEGER,
        rsvp_status          TEXT CHECK(rsvp_status IN ('Accepted','Declined','Pending'))
                             DEFAULT 'Pending',
        FOREIGN KEY (table_id) REFERENCES event_tables(id)
      );

      -- UNIQUE(guest_id) is an addition to the PRD, which modelled this 1:1
      -- but omitted the constraint. Without it a guest accumulates
      -- contradictory menu rows and the place card cannot say which is right.
      CREATE TABLE menu_selections (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_id       INTEGER NOT NULL UNIQUE,
        starter_choice TEXT,
        main_choice    TEXT,
        dessert_choice TEXT,
        FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_guests_table_id    ON guests(table_id);
      CREATE INDEX idx_guests_rsvp_status ON guests(rsvp_status);
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

export function currentVersion(db: DatabaseHandle): Result<number> {
  const exists = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
  );
  if (isErr(exists)) return err(exists.error);
  if (exists.value.rows.length === 0) return ok(0);

  const result = db.query('SELECT MAX(version) AS version FROM schema_version');
  if (isErr(result)) return err(result.error);

  const version = result.value.rows[0]?.version;
  return ok(typeof version === 'number' ? version : 0);
}

export function migrate(db: DatabaseHandle): Result<{ from: number; to: number }> {
  const created = db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  if (isErr(created)) return err(created.error);

  const from = currentVersion(db);
  if (isErr(from)) return err(from.error);

  const pending = MIGRATIONS.filter((m) => m.version > from.value).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    return ok({ from: from.value, to: from.value });
  }

  // One transaction for the whole run: a half-applied schema is worse than an
  // unmigrated one, because nothing downstream can tell which it is.
  const applied = db.transaction(() => {
    for (const migration of pending) {
      const result = db.exec(migration.up);
      if (isErr(result)) {
        throw new Error(`migration ${migration.version} failed: ${result.error.message}`);
      }

      const stamped = db.exec('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
        migration.version,
        new Date().toISOString(),
      ]);
      if (isErr(stamped)) {
        throw new Error(`could not record migration ${migration.version}`);
      }
    }
    return true;
  });

  if (isErr(applied)) return err(applied.error);

  return ok({ from: from.value, to: SCHEMA_VERSION });
}

export type TableColumn = {
  readonly name: string;
  readonly declaredType: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
};

export function tableColumns(db: DatabaseHandle, table: string): Result<readonly TableColumn[]> {
  // Identifiers cannot be bound as parameters, so the name is validated
  // against the catalogue first rather than interpolated blind.
  const known = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
  if (isErr(known)) return err(known.error);

  if (known.value.rows.length === 0) {
    return err(appError('SQL_ERROR', `No such table: ${table}`));
  }

  const result = db.query(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
  if (isErr(result)) return err(result.error);

  return ok(toTableColumns(result.value.rows));
}

/**
 * Pure mapper over `PRAGMA table_info` rows. Split out so the main thread can
 * introspect over RPC without a dedicated worker op.
 */
export function toTableColumns(rows: readonly Row[]): readonly TableColumn[] {
  return rows.map((row) => ({
    name: String(row.name),
    declaredType: String(row.type ?? ''),
    notNull: row.notnull === 1,
    primaryKey: row.pk === 1,
  }));
}
