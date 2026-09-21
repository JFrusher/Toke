import { create } from 'zustand';
import { createDbClient, type DbClient } from '@/engine/db/client';
import type { ImportMode, ImportPlan, ImportReport } from '@/engine/db/import';
import type { Row, SqlValue } from '@/engine/db/protocol';
import { type TableColumn, toTableColumns } from '@/engine/db/schema';
import { createWorkerTransport } from '@/engine/db/workerTransport';
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
  readonly rows: readonly Row[];
  readonly columns: readonly TableColumn[];

  open: () => Promise<void>;
  refresh: () => Promise<void>;
  runImport: (csvText: string, mode: ImportMode) => Promise<Result<ImportReport>>;
  updateCell: (id: number, column: string, value: SqlValue) => Promise<void>;
  addRow: () => Promise<void>;
  deleteRow: (id: number) => Promise<void>;
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
