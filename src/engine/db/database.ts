import initSqlJs, { type Database } from 'sql.js';
import type { ColumnMeta, ExecResult, QueryResult, Row, SqlValue } from '@/engine/db/protocol';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * The ONLY module that imports sql.js (CLAUDE.md §2.1). It is instantiated
 * inside `db.worker.ts`; nothing on the main thread touches it.
 *
 * Every operation returns a Result. SQLite errors are expected input — a typo
 * in the SQL console must not take the connection down.
 */

export type DatabaseHandle = {
  query(sql: string, params?: readonly SqlValue[]): Result<QueryResult>;
  exec(sql: string, params?: readonly SqlValue[]): Result<ExecResult>;
  /** Runs `body` inside a transaction, rolling back if it throws. */
  transaction<T>(body: () => T): Result<T>;
  export(): Uint8Array;
  close(): void;
};

export type OpenOptions = {
  /** Restore a previously exported database. */
  readonly bytes?: Uint8Array;
  /** Where to find sql-wasm.wasm. Browsers need `/sql-wasm.wasm`. */
  readonly locateFile?: (file: string) => string;
};

function sqlError(error: unknown, sql: string) {
  const message = error instanceof Error ? error.message : String(error);
  return appError('SQL_ERROR', message, { hint: sql.slice(0, 200) });
}

export async function openDatabase(options: OpenOptions = {}): Promise<Result<DatabaseHandle>> {
  let db: Database;

  try {
    const SQL = await initSqlJs(
      options.locateFile === undefined ? undefined : { locateFile: options.locateFile },
    );
    db = options.bytes === undefined ? new SQL.Database() : new SQL.Database(options.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(appError('DB_OPEN_FAILED', `Could not start the database engine: ${message}`));
  }

  // SQLite defaults foreign key enforcement OFF. Without this every FOREIGN
  // KEY in the schema is decorative and orphaned rows accumulate silently.
  db.run('PRAGMA foreign_keys = ON');

  const handle: DatabaseHandle = {
    query(sql, params) {
      try {
        const statement = db.prepare(sql);
        try {
          if (params !== undefined && params.length > 0) {
            statement.bind(params as SqlValue[]);
          }

          const rows: Row[] = [];
          while (statement.step()) {
            rows.push(statement.getAsObject() as Row);
          }

          const columns: ColumnMeta[] = statement.getColumnNames().map((name) => ({ name }));
          return ok({ rows, columns });
        } finally {
          statement.free();
        }
      } catch (error) {
        return err(sqlError(error, sql));
      }
    },

    exec(sql, params) {
      try {
        if (params !== undefined && params.length > 0) {
          db.run(sql, params as SqlValue[]);
        } else {
          db.run(sql);
        }
        return ok({ rowsModified: db.getRowsModified() });
      } catch (error) {
        return err(sqlError(error, sql));
      }
    },

    transaction(body) {
      try {
        db.run('BEGIN');
      } catch (error) {
        return err(sqlError(error, 'BEGIN'));
      }

      try {
        const value = body();
        db.run('COMMIT');
        return ok(value);
      } catch (error) {
        // Rollback must not mask the original failure, so its own error is
        // deliberately swallowed — there is nothing useful a caller could do
        // with "rollback failed" that the original error does not already say.
        try {
          db.run('ROLLBACK');
        } catch {
          /* ignore */
        }
        return err(sqlError(error, 'transaction'));
      }
    },

    export() {
      return db.export();
    },

    close() {
      db.close();
    },
  };

  return ok(handle);
}
