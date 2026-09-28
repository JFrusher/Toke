import { type InferredType, inferType } from '@/engine/db/csv';
import type { DatabaseHandle } from '@/engine/db/database';
import type { Row } from '@/engine/db/protocol';
import { lookup } from '@/engine/tokens/resolver';
import { appError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * The Record Source: the single query per design whose rows ARE the print run.
 * One row produces one card.
 *
 * Tokens resolve as column lookups against the current row (CLAUDE.md §2.3),
 * so this query runs once per design rather than once per token per record.
 */

export type ColumnSchema = {
  readonly name: string;
  readonly type: InferredType;
};

export type RecordSet = {
  readonly sql: string;
  readonly rows: readonly Row[];
  readonly rowCount: number;
  readonly columns: readonly string[];
};

/**
 * A record source is re-evaluated on every preview and every export, so it
 * must not be able to mutate. Otherwise cycling through records would quietly
 * rewrite the guest list.
 */
export function assertReadOnly(sql: string): Result<true> {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  // Reject anything after the first statement. "SELECT 1; DROP TABLE guests"
  // would otherwise pass a naive prefix check.
  const withoutTrailingSemicolon = stripped.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    return err(
      appError('RECORD_SOURCE_NOT_READONLY', 'A record source must be a single statement.', {
        hint: 'Remove the extra statement after the semicolon.',
      }),
    );
  }

  if (!/^\s*(SELECT|WITH)\b/i.test(withoutTrailingSemicolon)) {
    return err(
      appError(
        'RECORD_SOURCE_NOT_READONLY',
        'A record source must be a SELECT (or a WITH ending in one).',
        { hint: 'This query would modify data, and it runs on every preview.' },
      ),
    );
  }

  const forbidden =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i;
  if (forbidden.test(withoutTrailingSemicolon)) {
    return err(
      appError('RECORD_SOURCE_NOT_READONLY', 'A record source cannot modify the database.', {
        hint: 'It is re-run on every preview and every export.',
      }),
    );
  }

  return ok(true);
}

export function runRecordSource(db: DatabaseHandle, sql: string): Result<RecordSet> {
  const readOnly = assertReadOnly(sql);
  if (isErr(readOnly)) return err(readOnly.error);

  const result = db.query(sql);
  if (isErr(result)) return err(result.error);

  return ok({
    sql,
    rows: result.value.rows,
    rowCount: result.value.rows.length,
    columns: result.value.columns.map((column) => column.name),
  });
}

/**
 * Types are inferred from the returned values rather than read from the
 * declared schema: a record source may join, alias or compute columns that
 * exist in no table.
 */
/**
 * Same inference as columnSchemaFor, over plain rows.
 *
 * The main thread gets rows over RPC rather than a RecordSet, and must not
 * build a second inference rule — two would drift.
 */
export function columnSchemaForRows(
  columns: readonly string[],
  rows: readonly Row[],
): readonly ColumnSchema[] {
  return columnSchemaFor({ sql: '', rows, rowCount: rows.length, columns });
}

export function columnSchemaFor(set: RecordSet): readonly ColumnSchema[] {
  return set.columns.map((name) => {
    const values = set.rows.map((row) => {
      const value = row[name];
      return value === null || value === undefined ? '' : String(value);
    });

    return { name, type: inferType(values) };
  });
}

/**
 * How many records each value of a column covers, most first — the "41
 * standard, 9 veg, 3 GF" a planner checks before a mixed run. Empty cells
 * count under "".
 */
export function variantCounts(
  rows: readonly Record<string, unknown>[],
  column: string,
): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = String(lookup(row, column).value ?? '').trim();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Why a mixed run cannot go ahead, one line per problem; empty when it can.
 * Every value must name a design, and every named design must share the run's
 * trim — cards of different sizes cannot sit in one imposition grid.
 */
export function layoutProblems(
  counts: readonly (readonly [string, number])[],
  designs: readonly { readonly name: string; readonly width: number; readonly height: number }[],
  trim: { readonly width: number; readonly height: number },
): string[] {
  const byName = new Map(designs.map((design) => [design.name.trim().toLowerCase(), design]));
  const problems: string[] = [];
  for (const [value, count] of counts) {
    if (value === '') continue;
    const design = byName.get(value.toLowerCase());
    const records = `${count} ${count === 1 ? 'record' : 'records'}`;
    if (design === undefined) problems.push(`No design is called "${value}" (${records}).`);
    else if (
      Math.abs(design.width - trim.width) > 0.01 ||
      Math.abs(design.height - trim.height) > 0.01
    )
      problems.push(
        `"${design.name}" is a different size from this design, so it cannot share the run.`,
      );
  }
  return problems;
}
