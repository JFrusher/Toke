'use client';

import { Fragment } from 'react';

/**
 * SQL syntax colouring, rendered behind a transparent textarea.
 *
 * Deliberately not CodeMirror. The console needs highlighting, `Ctrl+Enter`
 * and an error line — not folding, linting or autocomplete — and a textarea
 * keeps native undo, IME composition, selection and screen-reader behaviour
 * that a custom editor has to rebuild badly. The cost is that highlighting is
 * token-level and has no parser: a keyword inside an unterminated string will
 * still colour. Acceptable for a query box; the ceiling is recorded in
 * tasks.todo if the console ever grows into an editor.
 */

const KEYWORDS = new Set(
  [
    'select',
    'from',
    'where',
    'group',
    'by',
    'having',
    'order',
    'limit',
    'offset',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'cross',
    'on',
    'as',
    'and',
    'or',
    'not',
    'in',
    'is',
    'null',
    'like',
    'between',
    'case',
    'when',
    'then',
    'else',
    'end',
    'distinct',
    'union',
    'all',
    'with',
    'asc',
    'desc',
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'coalesce',
    'cast',
  ].map((word) => word),
);

/** Splits into strings, comments, numbers, words and everything else. */
const TOKEN = /('[^']*'?|--[^\n]*|\b\d+(?:\.\d+)?\b|\b\w+\b|\s+|[^\s\w]+)/g;

function classOf(token: string): string {
  if (token.startsWith("'")) return 'text-ok';
  if (token.startsWith('--')) return 'text-ink-subtle';
  if (/^\d/.test(token)) return 'text-conditional';
  if (KEYWORDS.has(token.toLowerCase())) return 'font-medium text-accent';
  return 'text-ink';
}

export function SqlHighlight({ sql }: { sql: string }) {
  const tokens = sql.match(TOKEN) ?? [];

  return (
    <>
      {tokens.map((token, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a positional token list regenerated whole on every keystroke, holding no state
        <Fragment key={index}>
          <span className={classOf(token)}>{token}</span>
        </Fragment>
      ))}
      {/* A trailing newline is not rendered by a <pre>, so the overlay would
          scroll one line short of the textarea it sits behind. */}
      {'\n'}
    </>
  );
}
