import type { AppError } from '@/lib/errors';

/**
 * Wire format between the main thread and `db.worker.ts`.
 *
 * Everything here must be structured-cloneable — plain objects, primitives and
 * typed arrays only. No class instances, no functions.
 */

export type SqlValue = string | number | Uint8Array | null;
export type Row = Record<string, SqlValue>;

export type ColumnMeta = {
  readonly name: string;
};

export type QueryResult = {
  readonly rows: readonly Row[];
  readonly columns: readonly ColumnMeta[];
};

export type ExecResult = {
  readonly rowsModified: number;
};

export type DbRequest =
  | { readonly op: 'init'; readonly bytes?: Uint8Array }
  | { readonly op: 'query'; readonly sql: string; readonly params?: readonly SqlValue[] }
  | { readonly op: 'exec'; readonly sql: string; readonly params?: readonly SqlValue[] }
  | { readonly op: 'export' };

export type DbSuccess =
  | { readonly op: 'init' }
  | ({ readonly op: 'query' } & QueryResult)
  | ({ readonly op: 'exec' } & ExecResult)
  | { readonly op: 'export'; readonly bytes: Uint8Array };

export type DbRequestEnvelope = {
  readonly id: number;
  readonly payload: DbRequest;
};

export type DbReply =
  | { readonly id: number; readonly ok: true; readonly result: DbSuccess }
  | { readonly id: number; readonly ok: false; readonly error: AppError };

/**
 * Abstracts the Worker so the client can be tested without one. The real
 * implementation wraps `postMessage` / `onmessage`.
 */
export type Transport = {
  post(request: DbRequestEnvelope): void;
  onMessage(handler: (reply: DbReply) => void): void;
  terminate(): void;
};
