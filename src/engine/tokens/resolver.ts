import { applyFormatters } from '@/engine/tokens/formatters';
import { parseTokens, type Segment } from '@/engine/tokens/parser';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Resolves a tokenised string against one record-source row.
 *
 * A column lookup, never a query — this runs once per token per record during
 * export, so anything heavier would not finish (CLAUDE.md §2.3).
 */

export type ResolveOptions = {
  /** Used when a value is absent. See `isAbsent`. */
  readonly fallback: string;
  /** Surfaced on any error, so the diagnostics panel can focus the object. */
  readonly objectId?: string;
};

/**
 * Absence is NULL, empty, or whitespace-only.
 *
 * Numeric zero and a false flag are NOT absent: seat 0 and "no seat" are
 * different facts, and a card that silently prints the fallback for seat 0
 * sends a guest to the wrong table.
 */
function isAbsent(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

/**
 * A record source returns a flat row, so `guests.first_name` must also find a
 * column called `first_name`. An exact match wins, because a query is free to
 * alias a column to something containing a dot.
 */
function lookup(
  row: Record<string, unknown>,
  reference: string,
): { found: boolean; value: unknown } {
  if (Object.hasOwn(row, reference)) {
    return { found: true, value: row[reference] };
  }

  const dot = reference.lastIndexOf('.');
  if (dot !== -1) {
    const bare = reference.slice(dot + 1);
    if (Object.hasOwn(row, bare)) {
      return { found: true, value: row[bare] };
    }
  }

  return { found: false, value: null };
}

type Resolved =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'token'; readonly text: string; readonly empty: boolean };

/**
 * Removes whitespace orphaned by a token that resolved to nothing.
 *
 * "{{First}} {{Middle}} {{Last}}" with no middle name must read "Ada
 * Lovelace", not "Ada  Lovelace". Only whitespace ADJACENT to an emptied
 * token is touched — an author's deliberate double space in literal text is
 * left alone.
 */
function joinCollapsing(parts: readonly Resolved[]): string {
  const output: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) continue;

    if (part.kind === 'token') {
      output.push(part.text);
      continue;
    }

    const previous = parts[index - 1];
    const afterEmptyToken = previous?.kind === 'token' && previous.empty;

    // Drop the whitespace FOLLOWING an empty token, never the whitespace
    // before it. The pair of gaps around a missing middle name has to
    // collapse to one space, not to none — dropping both sides yields
    // "AdaLovelace". Consecutive empty tokens chain correctly because each
    // drops only its own trailing gap, and the leading and trailing cases
    // are cleaned up by the final trim.
    if (afterEmptyToken && /^\s+$/.test(part.text)) continue;

    output.push(part.text);
  }

  return output.join('').trim();
}

export function resolveTokens(
  template: string,
  row: Record<string, unknown>,
  options: ResolveOptions,
): Result<string> {
  const parsed = parseTokens(template);
  if (!parsed.ok) {
    return options.objectId === undefined
      ? err(parsed.error)
      : err({ ...parsed.error, objectId: options.objectId });
  }

  const parts: Resolved[] = [];

  for (const segment of parsed.value as readonly Segment[]) {
    if (segment.kind === 'literal') {
      parts.push({ kind: 'literal', text: segment.text });
      continue;
    }

    const { found, value } = lookup(row, segment.reference);
    if (!found) {
      return err(
        appError('TOKEN_UNKNOWN_COLUMN', `No column "${segment.reference}" in this record.`, {
          hint: 'Check the record source, or the column name in the token.',
          ...(options.objectId === undefined ? {} : { objectId: options.objectId }),
        }),
      );
    }

    const absent = isAbsent(value);
    const raw = absent ? options.fallback : String(value);
    const text = applyFormatters(raw, segment.formatters);

    // A token that fell back to a non-empty string is NOT empty: the fallback
    // is content the author asked for, and the space around it stays.
    parts.push({ kind: 'token', text, empty: text === '' });
  }

  return ok(joinCollapsing(parts));
}
