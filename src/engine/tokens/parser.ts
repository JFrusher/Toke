import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * Parses `{{ table.field | formatter | formatter }}` out of a string.
 *
 * Tokens are column references, resolved against the current record-source
 * row (CLAUDE.md §2.3). They never execute SQL.
 */

export type Segment =
  | { readonly kind: 'literal'; readonly text: string }
  | {
      readonly kind: 'token';
      /** As written — may be table-qualified. */
      readonly reference: string;
      readonly formatters: readonly string[];
      /** The original `{{ … }}` text, so a parse can be reassembled exactly. */
      readonly raw: string;
    };

export const FORMATTER_NAMES = ['upper', 'lower', 'title', 'trim'] as const;
export type FormatterName = (typeof FORMATTER_NAMES)[number];

/** Column references are SQL identifiers, optionally dotted. */
const REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isFormatterName(value: string): value is FormatterName {
  return (FORMATTER_NAMES as readonly string[]).includes(value);
}

export function parseTokens(input: string): Result<readonly Segment[]> {
  const segments: Segment[] = [];
  let literal = '';
  let index = 0;

  function flushLiteral() {
    if (literal !== '') {
      segments.push({ kind: 'literal', text: literal });
      literal = '';
    }
  }

  while (index < input.length) {
    // `\{{` escapes a token opener, for a design that needs literal braces.
    if (input.startsWith('\\{{', index)) {
      literal += '{{';
      index += 3;
      continue;
    }

    if (!input.startsWith('{{', index)) {
      literal += input[index];
      index += 1;
      continue;
    }

    const close = input.indexOf('}}', index + 2);
    if (close === -1) {
      // Unclosed. This is the normal state halfway through typing a token, so
      // it reads as literal text rather than erroring and flashing the
      // inspector red on the way to something valid.
      literal += input.slice(index);
      break;
    }

    const raw = input.slice(index, close + 2);
    const body = input.slice(index + 2, close).trim();

    if (body === '') {
      return err(
        appError('TOKEN_EMPTY', 'A token needs a column name.', {
          hint: 'For example {{ first_name }}.',
        }),
      );
    }

    const parts = body.split('|').map((part) => part.trim());
    const reference = parts[0] ?? '';

    if (!REFERENCE_PATTERN.test(reference)) {
      return err(
        appError('TOKEN_INVALID_REFERENCE', `"${reference}" is not a column reference.`, {
          hint: 'Use a column name, optionally qualified — first_name or guests.first_name.',
        }),
      );
    }

    const formatters: string[] = [];
    for (const part of parts.slice(1)) {
      const name = part.toLowerCase();
      if (name === '') {
        return err(appError('TOKEN_UNKNOWN_FORMATTER', 'A formatter in the chain is empty.'));
      }
      if (!isFormatterName(name)) {
        // Named explicitly: silently ignoring an unknown formatter would
        // print unformatted text across a whole run with no warning.
        return err(
          appError('TOKEN_UNKNOWN_FORMATTER', `Unknown formatter "${part}".`, {
            hint: `Available: ${FORMATTER_NAMES.join(', ')}.`,
          }),
        );
      }
      formatters.push(name);
    }

    flushLiteral();
    segments.push({ kind: 'token', reference, formatters, raw });
    index = close + 2;
  }

  flushLiteral();
  return ok(segments);
}

/** True when the string contains at least one well-formed token. */
export function isTokenised(input: string): boolean {
  const parsed = parseTokens(input);
  return parsed.ok && parsed.value.some((segment) => segment.kind === 'token');
}

/**
 * True when the string is MEANT to contain a token, whether or not it parses.
 *
 * Distinct from isTokenised, which is false for a malformed token because it
 * cannot produce one. Pre-flight must use this: skipping unparseable nodes
 * would hide exactly the bindings that are broken, and report the run clean
 * while those objects print nothing.
 */
export function hasTokenSyntax(input: string): boolean {
  if (isTokenised(input)) return true;
  const parsed = parseTokens(input);
  return !parsed.ok;
}

/** Distinct column references, in order of first appearance. */
export function tokenColumns(input: string): readonly string[] {
  const parsed = parseTokens(input);
  if (!parsed.ok) return [];

  const seen = new Set<string>();
  for (const segment of parsed.value) {
    if (segment.kind === 'token') seen.add(segment.reference);
  }
  return [...seen];
}
