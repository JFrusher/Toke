/**
 * Structured application errors. Every fallible engine function returns one of
 * these inside a Result rather than throwing — CLAUDE.md §3.
 *
 * `objectId` is what lets the diagnostics panel (P9.2) focus the canvas object
 * an error came from. Populate it wherever the error has a spatial origin.
 */

export type ErrorCode =
  | 'ASSET_INVALID'
  | 'ASSET_NOT_FOUND'
  | 'TOKE_CORRUPT'
  | 'TOKE_VERSION_UNSUPPORTED'
  | 'TOKE_WRITE_FAILED'
  | 'CSV_IMPORT_FAILED'
  | 'RECORD_SOURCE_NOT_READONLY'
  | 'CSV_EMPTY'
  | 'CSV_INVALID_HEADER'
  | 'SQL_ERROR'
  | 'DB_OPEN_FAILED'
  | 'DB_CLOSED'
  | 'DB_PROTOCOL'
  | 'DB_NOT_INITIALISED'
  | 'DB_ERROR'
  | 'INVALID_LENGTH'
  | 'SINGULAR_MATRIX'
  | 'INVALID_SPEC'
  | 'DESIGN_EXCEEDS_SHEET';

export type AppError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly hint?: string;
  readonly objectId?: string;
};

type AppErrorExtras = {
  readonly hint?: string;
  readonly objectId?: string;
};

export function appError(code: ErrorCode, message: string, extras?: AppErrorExtras): AppError {
  // Keys are spread conditionally rather than assigned undefined:
  // exactOptionalPropertyTypes distinguishes an absent key from an explicit
  // undefined, and consumers check with `in` / Object.hasOwn.
  return {
    code,
    message,
    ...(extras?.hint !== undefined ? { hint: extras.hint } : {}),
    ...(extras?.objectId !== undefined ? { objectId: extras.objectId } : {}),
  };
}
