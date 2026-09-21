import type { ParsedCsv } from '@/engine/db/csv';
import type { ImportPlan, ImportReport } from '@/engine/db/import';
import type {
  DbReply,
  DbRequest,
  DbSuccess,
  ExecResult,
  QueryResult,
  SqlValue,
  Transport,
} from '@/engine/db/protocol';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Typed RPC to the database worker.
 *
 * Every method resolves with a Result and never rejects. A rejected promise
 * would force try/catch at every call site and would surface as an unhandled
 * rejection the first time one was forgotten — and a failed query is ordinary
 * input here, not an exceptional condition.
 */

export type DbClient = {
  init(bytes?: Uint8Array): Promise<Result<true>>;
  query(sql: string, params?: readonly SqlValue[]): Promise<Result<QueryResult>>;
  exec(sql: string, params?: readonly SqlValue[]): Promise<Result<ExecResult>>;
  export(): Promise<Result<Uint8Array>>;
  migrate(): Promise<Result<{ from: number; to: number }>>;
  importCsv(csv: ParsedCsv, plan: ImportPlan): Promise<Result<ImportReport>>;
  close(): void;
};

type Pending = {
  readonly resolve: (reply: Result<DbSuccess>) => void;
};

export function createDbClient(transport: Transport): DbClient {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;

  transport.onMessage((reply: DbReply) => {
    const entry = pending.get(reply.id);
    // An unknown id means a stale or duplicate reply. Dropping it is correct;
    // throwing would take down the worker's message handler.
    if (entry === undefined) return;

    pending.delete(reply.id);
    entry.resolve(reply.ok ? ok(reply.result) : err(reply.error));
  });

  function send(payload: DbRequest): Promise<Result<DbSuccess>> {
    if (closed) {
      return Promise.resolve(err(appError('DB_CLOSED', 'The database connection is closed.')));
    }

    const id = nextId;
    nextId += 1;

    return new Promise<Result<DbSuccess>>((resolve) => {
      pending.set(id, { resolve });
      transport.post({ id, payload });
    });
  }

  function wrongShape(expected: string, got: string) {
    return err(
      appError('DB_PROTOCOL', `Expected a "${expected}" reply from the database, got "${got}".`),
    );
  }

  return {
    async init(bytes) {
      const reply = await send(bytes === undefined ? { op: 'init' } : { op: 'init', bytes });
      if (!reply.ok) return err(reply.error);
      return reply.value.op === 'init' ? ok(true) : wrongShape('init', reply.value.op);
    },

    async query(sql, params) {
      const reply = await send(
        params === undefined ? { op: 'query', sql } : { op: 'query', sql, params },
      );
      if (!reply.ok) return err(reply.error);
      if (reply.value.op !== 'query') return wrongShape('query', reply.value.op);
      return ok({ rows: reply.value.rows, columns: reply.value.columns });
    },

    async exec(sql, params) {
      const reply = await send(
        params === undefined ? { op: 'exec', sql } : { op: 'exec', sql, params },
      );
      if (!reply.ok) return err(reply.error);
      if (reply.value.op !== 'exec') return wrongShape('exec', reply.value.op);
      return ok({ rowsModified: reply.value.rowsModified });
    },

    async export() {
      const reply = await send({ op: 'export' });
      if (!reply.ok) return err(reply.error);
      return reply.value.op === 'export'
        ? ok(reply.value.bytes)
        : wrongShape('export', reply.value.op);
    },

    async migrate() {
      const reply = await send({ op: 'migrate' });
      if (!reply.ok) return err(reply.error);
      if (reply.value.op !== 'migrate') return wrongShape('migrate', reply.value.op);
      return ok({ from: reply.value.from, to: reply.value.to });
    },

    async importCsv(csv, plan) {
      const reply = await send({ op: 'import', csv, plan });
      if (!reply.ok) return err(reply.error);
      if (reply.value.op !== 'import') return wrongShape('import', reply.value.op);
      return ok({ inserted: reply.value.inserted, createdColumns: reply.value.createdColumns });
    },

    close() {
      closed = true;

      // Settle everything in flight. Leaving them pending would hang any
      // caller awaiting a query when the worker is torn down.
      const inFlight = [...pending.values()];
      pending.clear();
      for (const entry of inFlight) {
        entry.resolve(err(appError('DB_CLOSED', 'The database connection was closed.')));
      }

      transport.terminate();
    },
  };
}
