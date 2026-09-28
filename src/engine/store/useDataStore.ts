import { create } from 'zustand';
import { createDbClient, type DbClient } from '@/engine/db/client';
import type { ColumnMapping } from '@/engine/db/csv';
import type { ImportMode, ImportPlan, ImportReport } from '@/engine/db/import';
import type { QueryResult, Row, SqlValue } from '@/engine/db/protocol';
import { assertReadOnly, type ColumnSchema, columnSchemaForRows } from '@/engine/db/recordSource';
import { type TableColumn, toTableColumns } from '@/engine/db/schema';
import { createWorkerTransport } from '@/engine/db/workerTransport';
import { DEFAULT_RECORD_SOURCE } from '@/engine/persistence/project';
import type { AppError } from '@/lib/errors';
import { appError } from '@/lib/errors';
import { err, isErr, type Result } from '@/lib/result';

/**
 * Owns the connection to the database worker.
 *
 * The client itself is a module singleton rather than store state: it holds a
 * live Worker, which is neither serialisable nor comparable, and putting it in
 * the store would make every selector see a changing reference.
 */
let client: DbClient | null = null;

function ensureClient(): DbClient {
  client ??= createDbClient(createWorkerTransport());
  return client;
}

export type DataStatus = 'idle' | 'opening' | 'ready' | 'error';

type DataState = {
  readonly status: DataStatus;
  readonly error: AppError | null;
  readonly table: string;
  /**
   * Every user table and its columns, for the table picker and the SQL
   * console's schema list. Includes tables the user created from a CSV.
   */
  readonly schema: Readonly<Record<string, readonly string[]>>;
  /** Queries the user named in the SQL console, kept in the project's database. */
  readonly savedQueries: readonly { readonly name: string; readonly sql: string }[];
  /** Everything in the edited table — what the data grid shows. */
  readonly rows: readonly Row[];
  readonly columns: readonly TableColumn[];

  /**
   * The design's record source: the query whose rows ARE the print run.
   * Distinct from `rows` on purpose — the grid edits the whole table while a
   * design may print only accepted guests, and previewing the wrong set is
   * how a run comes back with the wrong people on it.
   */
  readonly recordSource: string;
  readonly records: readonly Row[];
  readonly recordColumns: readonly ColumnSchema[];
  readonly recordSourceError: AppError | null;

  open: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Shows another table in the grid. */
  setTable: (table: string) => Promise<void>;
  /** Saves under a name, replacing any query already called that. */
  saveQuery: (name: string, sql: string) => Promise<void>;
  removeQuery: (name: string) => Promise<void>;
  /**
   * Imports a CSV, optionally with a mapping the user has edited.
   *
   * Without `mappings` the proposal is used as-is, which is what the tests and
   * the template loader want. With them, the user's corrections win.
   */
  runImport: (
    csvText: string,
    mode: ImportMode,
    mappings?: readonly ColumnMapping[],
    /** Defaults to the table in the grid. With mode 'create', the new table's name. */
    table?: string,
  ) => Promise<Result<ImportReport>>;
  updateCell: (id: number, column: string, value: SqlValue) => Promise<void>;
  addRow: () => Promise<void>;
  deleteRow: (id: number) => Promise<void>;
  setRecordSource: (sql: string) => Promise<void>;
  /**
   * Runs an ad-hoc query for the SQL console.
   *
   * Returns a Result rather than storing one: a console query is a one-off
   * the user is looking at, not app state, and putting it in the store would
   * re-render every subscriber for a result only one panel reads.
   */
  query: (sql: string) => Promise<Result<QueryResult>>;
  refreshRecords: () => Promise<void>;
  exportDatabase: () => Promise<Uint8Array>;
  loadDatabase: (bytes: Uint8Array) => Promise<void>;
};

/** User tables and their columns, in column order. Internal tables are hidden. */
const SCHEMA_QUERY = `
  SELECT m.name AS table_name, p.name AS column_name
  FROM sqlite_master m JOIN pragma_table_info(m.name) p
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND substr(m.name, 1, 5) <> 'toke_'
    AND m.name <> 'schema_version'
  ORDER BY m.name, p.cid`;

/** Why a name cannot be a new table, or null if it can. */
export function newTableProblem(
  name: string,
  schema: Readonly<Record<string, readonly string[]>>,
): string | null {
  if (name.trim() === '') return 'The new table needs a name.';
  if (/^(sqlite|toke)_/i.test(name)) return 'Names starting "sqlite_" or "toke_" are reserved.';
  const taken = Object.keys(schema).some((t) => t.toLowerCase() === name.toLowerCase());
  return taken ? `There is already a table called ${name}.` : null;
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export const useDataStore = create<DataState>((set, get) => ({
  status: 'idle',
  error: null,
  table: 'guests',
  schema: {},
  savedQueries: [],
  rows: [],
  columns: [],
  recordSource: DEFAULT_RECORD_SOURCE,
  records: [],
  recordColumns: [],
  recordSourceError: null,

  async open() {
    if (get().status === 'opening' || get().status === 'ready') return;
    set({ status: 'opening', error: null });

    const db = ensureClient();

    const started = await db.init();
    if (isErr(started)) {
      set({ status: 'error', error: started.error });
      return;
    }

    const migrated = await db.migrate();
    if (isErr(migrated)) {
      set({ status: 'error', error: migrated.error });
      return;
    }

    set({ status: 'ready' });
    await get().refresh();
  },

  async refresh() {
    const db = ensureClient();

    const listed = await db.query(SCHEMA_QUERY);
    if (isErr(listed)) {
      set({ error: listed.error });
      return;
    }
    const schema: Record<string, string[]> = {};
    for (const row of listed.value.rows) {
      const name = String(row.table_name);
      schema[name] = [...(schema[name] ?? []), String(row.column_name)];
    }
    // A table dropped from the SQL console, or a project without it, falls
    // back to guests rather than leaving the grid pointing at nothing.
    if (schema[get().table] === undefined) set({ table: 'guests' });
    const saved = await db.query('SELECT name, sql FROM toke_saved_queries ORDER BY name');
    set({
      schema,
      savedQueries: isErr(saved)
        ? []
        : saved.value.rows.map((row) => ({ name: String(row.name), sql: String(row.sql) })),
    });
    if (isErr(saved)) set({ error: saved.error });
    const table = get().table;

    const info = await db.query(`PRAGMA table_info(${quote(table)})`);
    if (isErr(info)) {
      set({ error: info.error });
      return;
    }

    const rows = await db.query(`SELECT * FROM ${quote(table)} ORDER BY id`);
    if (isErr(rows)) {
      set({ error: rows.error });
      return;
    }

    set({
      columns: toTableColumns(info.value.rows),
      rows: rows.value.rows,
      error: null,
    });

    // The record source reads the same database, so it has to be re-run
    // whenever the table changes or the preview goes stale.
    await get().refreshRecords();
  },

  query(sql) {
    return ensureClient().query(sql);
  },

  async saveQuery(name, sql) {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const result = await ensureClient().exec(
      'INSERT OR REPLACE INTO toke_saved_queries (name, sql) VALUES (?, ?)',
      [trimmed, sql],
    );
    if (isErr(result)) set({ error: result.error });
    await get().refresh();
  },

  async removeQuery(name) {
    const result = await ensureClient().exec('DELETE FROM toke_saved_queries WHERE name = ?', [
      name,
    ]);
    if (isErr(result)) set({ error: result.error });
    await get().refresh();
  },

  async setTable(table) {
    if (get().schema[table] === undefined) return;
    set({ table });
    await get().refresh();
  },

  async setRecordSource(sql) {
    set({ recordSource: sql });
    await get().refreshRecords();
  },

  async refreshRecords() {
    const sql = get().recordSource;

    // Validated on the main thread before it reaches the worker: a record
    // source re-runs on every preview and every export, so a mutating query
    // would quietly rewrite the guest list while the user cycled records.
    const readOnly = assertReadOnly(sql);
    if (isErr(readOnly)) {
      set({ recordSourceError: readOnly.error, records: [], recordColumns: [] });
      return;
    }

    const result = await ensureClient().query(sql);
    if (isErr(result)) {
      // Previous records are deliberately kept: an invalid query while the
      // user is mid-edit should not blank the canvas.
      set({ recordSourceError: result.error });
      return;
    }

    set({
      records: result.value.rows,
      recordColumns: columnSchemaForRows(
        result.value.columns.map((column) => column.name),
        result.value.rows,
      ),
      recordSourceError: null,
    });
  },

  async runImport(csvText, mode, mappings, into) {
    const db = ensureClient();
    const table = into ?? get().table;

    if (mode === 'create') {
      const problem = newTableProblem(table, get().schema);
      if (problem !== null) {
        const failure = appError('CSV_IMPORT_FAILED', problem, {
          hint: 'Choose another name for the new table.',
        });
        set({ error: failure });
        return err(failure);
      }
    }

    const { parseCsv, proposeMapping } = await import('@/engine/db/csv');

    const parsed = parseCsv(csvText);
    if (isErr(parsed)) {
      set({ error: parsed.error });
      return parsed;
    }

    const info = await db.query(`PRAGMA table_info(${quote(table)})`);
    if (isErr(info)) {
      set({ error: info.error });
      return info;
    }

    const plan: ImportPlan = {
      table,
      mode,
      mappings:
        mappings ??
        proposeMapping(
          parsed.value.columns,
          mode === 'create' ? [] : toTableColumns(info.value.rows),
        ),
    };

    const report = await db.importCsv(parsed.value, plan);
    if (isErr(report)) {
      set({ error: report.error });
      return report;
    }

    // A new table is shown straight away: it is what the user just made.
    set({ error: null, table });
    await get().refresh();
    return report;
  },

  async updateCell(id, column, value) {
    const known = get().columns.some((c) => c.name === column);
    if (!known) {
      // Guards against an identifier reaching SQL from anywhere but the
      // introspected schema.
      set({ error: appError('SQL_ERROR', `Unknown column: ${column}`) });
      return;
    }

    const db = ensureClient();
    const result = await db.exec(
      `UPDATE ${quote(get().table)} SET ${quote(column)} = ? WHERE id = ?`,
      [value, id],
    );

    if (isErr(result)) {
      set({ error: result.error });
      return;
    }
    await get().refresh();
  },

  async addRow() {
    const db = ensureClient();
    // Blank text for every column that must be filled and has no default —
    // on guests that is the two names; a user's own table may have none.
    const required = get().columns.filter((c) => c.notNull && !c.primaryKey && !c.hasDefault);
    const result = await db.exec(
      required.length === 0
        ? `INSERT INTO ${quote(get().table)} DEFAULT VALUES`
        : `INSERT INTO ${quote(get().table)} (${required.map((c) => quote(c.name)).join(', ')}) VALUES (${required.map(() => "''").join(', ')})`,
    );
    if (isErr(result)) {
      set({ error: result.error });
      return;
    }
    await get().refresh();
  },

  async exportDatabase() {
    const result = await ensureClient().export();
    if (isErr(result)) {
      set({ error: result.error });
      return new Uint8Array();
    }
    return result.value;
  },

  async loadDatabase(bytes) {
    const db = ensureClient();
    const started = await db.init(bytes);
    if (isErr(started)) {
      set({ status: 'error', error: started.error });
      return;
    }
    // Migrate after load: a project saved by an older build may predate the
    // current schema.
    const migrated = await db.migrate();
    if (isErr(migrated)) {
      set({ status: 'error', error: migrated.error });
      return;
    }
    set({ status: 'ready', error: null });
    await get().refresh();
  },

  async deleteRow(id) {
    const db = ensureClient();
    const result = await db.exec(`DELETE FROM ${quote(get().table)} WHERE id = ?`, [id]);
    if (isErr(result)) {
      set({ error: result.error });
      return;
    }
    await get().refresh();
  },
}));

/** Test seam: drop the singleton so a fresh worker is created next time. */
export function resetDbClient(): void {
  client?.close();
  client = null;
}
