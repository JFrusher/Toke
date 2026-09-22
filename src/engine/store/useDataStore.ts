import { create } from 'zustand';
import { createDbClient, type DbClient } from '@/engine/db/client';
import type { ImportMode, ImportPlan, ImportReport } from '@/engine/db/import';
import type { QueryResult, Row, SqlValue } from '@/engine/db/protocol';
import { assertReadOnly, type ColumnSchema, columnSchemaForRows } from '@/engine/db/recordSource';
import { type TableColumn, toTableColumns } from '@/engine/db/schema';
import { createWorkerTransport } from '@/engine/db/workerTransport';
import { DEFAULT_RECORD_SOURCE } from '@/engine/persistence/project';
import type { AppError } from '@/lib/errors';
import { appError } from '@/lib/errors';
import { isErr, isOk, type Result } from '@/lib/result';

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
  runImport: (csvText: string, mode: ImportMode) => Promise<Result<ImportReport>>;
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

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export const useDataStore = create<DataState>((set, get) => ({
  status: 'idle',
  error: null,
  table: 'guests',
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

  async runImport(csvText, mode) {
    const db = ensureClient();
    const table = get().table;

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
      mappings: proposeMapping(parsed.value.columns, toTableColumns(info.value.rows)),
    };

    const report = await db.importCsv(parsed.value, plan);
    if (isErr(report)) {
      set({ error: report.error });
      return report;
    }

    set({ error: null });
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
    const result = await db.exec(
      `INSERT INTO ${quote(get().table)} (first_name, last_name) VALUES ('', '')`,
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

export { isOk };
