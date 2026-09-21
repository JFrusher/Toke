import type { ColumnMapping, InferredType, ParsedCsv } from '@/engine/db/csv';
import type { DatabaseHandle } from '@/engine/db/database';
import type { SqlValue } from '@/engine/db/protocol';
import { appError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * Applies a confirmed column mapping to the database.
 *
 * The entire import is one transaction. A half-imported guest list is worse
 * than no import: the user cannot tell which records are missing, and the
 * place cards that do print look perfectly correct.
 */

export type ImportMode = 'replace' | 'append';

export type ImportPlan = {
  readonly table: string;
  readonly mode: ImportMode;
  readonly mappings: readonly ColumnMapping[];
};

export type ImportReport = {
  readonly inserted: number;
  readonly createdColumns: readonly string[];
};

const SQLITE_TYPE: Record<InferredType, string> = {
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'BOOLEAN',
  text: 'TEXT',
};

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 't']);

/** SQLite has no identifier binding, so names are quoted rather than interpolated raw. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function coerce(raw: string, type: InferredType): SqlValue {
  const value = raw.trim();

  // Blank becomes NULL, never ''. A token bound to a blank field must hit its
  // fallback, and the fallback triggers on NULL; '' would render as nothing.
  if (value === '') return null;

  switch (type) {
    case 'boolean':
      return TRUTHY.has(value.toLowerCase()) ? 1 : 0;
    case 'integer': {
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case 'real': {
      const parsed = Number.parseFloat(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case 'text':
      return value;
  }
}

export function importCsv(
  db: DatabaseHandle,
  csv: ParsedCsv,
  plan: ImportPlan,
): Result<ImportReport> {
  const active = plan.mappings.filter(
    (mapping): mapping is ColumnMapping & { target: string } =>
      mapping.action !== 'ignore' && mapping.target !== null,
  );

  if (active.length === 0) {
    return err(
      appError('CSV_IMPORT_FAILED', 'No columns are mapped for import.', {
        hint: 'Map at least one column to a field.',
      }),
    );
  }

  const sourceIndex = new Map(csv.columns.map((column, index) => [column.name, index]));
  const table = quoteIdentifier(plan.table);
  const createdColumns: string[] = [];

  const applied = db.transaction(() => {
    // ALTER TABLE lives inside the transaction too: a failed import must not
    // leave orphan columns behind on the table.
    for (const mapping of active) {
      if (mapping.action !== 'create') continue;

      const added = db.exec(
        `ALTER TABLE ${table} ADD COLUMN ${quoteIdentifier(mapping.target)} ${SQLITE_TYPE[mapping.type]}`,
      );
      if (isErr(added)) {
        throw new Error(`could not add column "${mapping.target}": ${added.error.message}`);
      }
      createdColumns.push(mapping.target);
    }

    if (plan.mode === 'replace') {
      const cleared = db.exec(`DELETE FROM ${table}`);
      if (isErr(cleared)) {
        throw new Error(`could not clear ${plan.table}: ${cleared.error.message}`);
      }
    }

    const columnList = active.map((m) => quoteIdentifier(m.target)).join(', ');
    const placeholders = active.map(() => '?').join(', ');
    const insert = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`;

    let inserted = 0;
    csv.rows.forEach((row, index) => {
      const values = active.map((mapping) => {
        const column = sourceIndex.get(mapping.source);
        return coerce(column === undefined ? '' : (row[column] ?? ''), mapping.type);
      });

      const result = db.exec(insert, values);
      if (isErr(result)) {
        // Row number is 1-based over data rows, matching what the user sees
        // in a spreadsheet below the header.
        throw new Error(`row ${index + 1}: ${result.error.message}`);
      }
      inserted += 1;
    });

    return inserted;
  });

  if (isErr(applied)) {
    return err(
      appError('CSV_IMPORT_FAILED', applied.error.message, {
        hint: 'Nothing was imported — the whole batch was rolled back.',
      }),
    );
  }

  return ok({ inserted: applied.value, createdColumns });
}
