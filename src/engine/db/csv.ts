import Papa from 'papaparse';
import type { TableColumn } from '@/engine/db/schema';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * CSV parsing and column type inference. Pure: no database, no IO.
 *
 * Inference is deliberately conservative. Widening a column later is cheap;
 * coercing "007" to the number 7 destroys information at import time and
 * cannot be undone.
 */

export type InferredType = 'integer' | 'real' | 'text' | 'boolean';

export type ParsedColumn = {
  readonly name: string;
  readonly inferred: InferredType;
  readonly samples: readonly string[];
};

export type RaggedRow = {
  /** 1-based index among data rows, excluding the header. */
  readonly row: number;
  readonly got: number;
  readonly expected: number;
};

export type ParsedCsv = {
  readonly columns: readonly ParsedColumn[];
  readonly rows: readonly (readonly string[])[];
  readonly rowCount: number;
  readonly ragged: readonly RaggedRow[];
  readonly delimiter: string;
};

const BOOLEAN_TRUE = new Set(['1', 'true', 'yes', 'y', 't']);
const BOOLEAN_FALSE = new Set(['0', 'false', 'no', 'n', 'f']);

const INTEGER_PATTERN = /^-?\d+$/;
const REAL_PATTERN = /^-?(?:\d+\.\d+|\.\d+|\d+)$/;

export function inferType(values: readonly string[]): InferredType {
  const present = values.map((v) => v.trim()).filter((v) => v !== '');
  if (present.length === 0) return 'text';

  const lower = present.map((v) => v.toLowerCase());

  // Requires at least two distinct values: a column of all "1" is far more
  // likely a count than a flag, and typing it boolean would be wrong.
  const allBoolean = lower.every((v) => BOOLEAN_TRUE.has(v) || BOOLEAN_FALSE.has(v));
  if (allBoolean && new Set(lower).size > 1) return 'boolean';

  // A leading zero makes the value an identifier, not a number — phone
  // numbers, reference codes, some postcodes. Coercing loses the zeros.
  const hasLeadingZero = present.some((v) => /^-?0\d/.test(v));
  if (hasLeadingZero) return 'text';

  if (present.every((v) => INTEGER_PATTERN.test(v))) return 'integer';
  if (present.every((v) => REAL_PATTERN.test(v))) return 'real';

  return 'text';
}

/** Longest run of values used to infer a column's type. */
const SAMPLE_LIMIT = 200;

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

export function parseCsv(input: string): Result<ParsedCsv> {
  const text = stripBom(input);

  if (text.trim() === '') {
    return err(
      appError('CSV_EMPTY', 'The file is empty.', {
        hint: 'Export a CSV with a header row and at least one record.',
      }),
    );
  }

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    // Papa detects the delimiter from the header when given an empty string.
    delimiter: '',
  });

  const table = parsed.data;
  const header = table[0];

  if (header === undefined || header.length === 0) {
    return err(appError('CSV_EMPTY', 'The file has no header row.'));
  }

  const names = header.map((name) => name.trim());

  const blank = names.indexOf('');
  if (blank !== -1) {
    return err(
      appError('CSV_INVALID_HEADER', `Column ${blank + 1} has no name.`, {
        hint: 'Every column needs a header.',
      }),
    );
  }

  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  if (duplicates.length > 0) {
    return err(
      appError(
        'CSV_INVALID_HEADER',
        `Duplicate column name: ${[...new Set(duplicates)].join(', ')}.`,
        { hint: 'Rename one of them — otherwise they overwrite each other.' },
      ),
    );
  }

  const dataRows = table.slice(1);
  const ragged: RaggedRow[] = [];
  const rows: string[][] = [];

  dataRows.forEach((row, index) => {
    if (row.length !== names.length) {
      // Reported, never padded. A silently padded row imports a guest with a
      // blank surname and no warning anywhere.
      ragged.push({ row: index + 1, got: row.length, expected: names.length });
    }
    rows.push(row.map((cell) => cell ?? ''));
  });

  const columns: ParsedColumn[] = names.map((name, index) => {
    const samples = rows.slice(0, SAMPLE_LIMIT).map((row) => row[index] ?? '');
    return { name, inferred: inferType(samples), samples: samples.slice(0, 5) };
  });

  return ok({
    columns,
    rows,
    rowCount: rows.length,
    ragged,
    delimiter: parsed.meta.delimiter,
  });
}

export type MappingAction = 'map' | 'create' | 'ignore';

export type ColumnMapping = {
  readonly source: string;
  readonly target: string | null;
  readonly action: MappingAction;
  readonly type: InferredType;
};

/** Normalise for matching: case, spaces, hyphens and punctuation all collapse. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function proposeMapping(
  sources: readonly ParsedColumn[],
  target: readonly TableColumn[],
): readonly ColumnMapping[] {
  const byNormalised = new Map(target.map((column) => [normalise(column.name), column]));

  return sources.map((source) => {
    const key = normalise(source.name);
    const match = byNormalised.get(key);

    // Never write the primary key. An imported id collides with AUTOINCREMENT
    // and fails in ways that are hard to attribute back to the CSV.
    if (match !== undefined && (match.primaryKey || match.name === 'id')) {
      return { source: source.name, target: null, action: 'ignore', type: source.inferred };
    }

    if (match !== undefined) {
      return { source: source.name, target: match.name, action: 'map', type: source.inferred };
    }

    return { source: source.name, target: key, action: 'create', type: source.inferred };
  });
}
