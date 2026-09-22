'use client';

import { useRef, useState } from 'react';
import { SqlHighlight } from '@/components/data/SqlHighlight';
import { Button } from '@/components/ui/Button';
import { assertReadOnly } from '@/engine/db/recordSource';
import { useDataStore } from '@/engine/store/useDataStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import type { AppError } from '@/lib/errors';
import { isErr } from '@/lib/result';

/**
 * A query box over the same database the record source reads.
 *
 * Read-only, enforced before the statement reaches the worker: the console is
 * for finding the right SELECT, and a DELETE typed here would destroy the
 * guest list with no undo — the command stack covers the canvas, not the data.
 */

type ResultTable = {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
};

/** Distinct rows, newest first, so re-running a query does not fill the list. */
function remember(history: readonly string[], sql: string): readonly string[] {
  return [sql, ...history.filter((entry) => entry !== sql)].slice(0, 20);
}

export function SqlConsole() {
  const query = useDataStore((s) => s.query);
  const recordSource = useDataStore((s) => s.recordSource);
  const setRecordSource = useDataStore((s) => s.setRecordSource);

  const [sql, setSql] = useState('SELECT * FROM guests');
  const [result, setResult] = useState<ResultTable | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [history, setHistory] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  const overlay = useRef<HTMLPreElement>(null);

  async function run() {
    setBusy(true);
    setError(null);

    const readOnly = assertReadOnly(sql);
    if (isErr(readOnly)) {
      setError(readOnly.error);
      reportDiagnostic('sql console', 'error', readOnly.error);
      setBusy(false);
      return;
    }

    const response = await query(sql);
    setBusy(false);

    if (isErr(response)) {
      // The SQLite message verbatim: "no such column: frist_name" says exactly
      // what to fix, and a friendlier paraphrase would say less.
      setError(response.error);
      reportDiagnostic('sql console', 'error', response.error);
      return;
    }

    setResult({
      columns: response.value.columns.map((column) => column.name),
      rows: response.value.rows,
    });
    setHistory((entries) => remember(entries, sql));
  }

  const isCurrentSource = sql.trim() === recordSource.trim();

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative shrink-0 border-hairline border-b">
          {/* The highlighted copy sits behind a transparent textarea, which is
              what keeps native undo, IME and selection working. Both share
              exactly one font metric, or the two layers drift apart. */}
          <pre
            ref={overlay}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-2 font-mono text-[12px] leading-[1.5]"
          >
            <SqlHighlight sql={sql} />
          </pre>

          <textarea
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            onScroll={(event) => {
              if (overlay.current !== null) {
                overlay.current.scrollTop = event.currentTarget.scrollTop;
              }
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void run();
              }
            }}
            spellCheck={false}
            aria-label="SQL query"
            data-testid="sql-input"
            rows={4}
            className="relative w-full resize-none whitespace-pre-wrap break-words bg-transparent p-2 font-mono text-[12px] text-transparent leading-[1.5] caret-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-hairline border-b px-2 py-1.5">
          <Button onClick={run} disabled={busy} data-testid="sql-run">
            Run
          </Button>
          <span className="text-[11px] text-ink-subtle">Ctrl+Enter</span>

          <Button
            variant="quiet"
            disabled={busy || isCurrentSource}
            onClick={() => void setRecordSource(sql)}
            data-testid="sql-use-as-source"
            className="ml-auto"
          >
            {isCurrentSource ? 'Is the record source' : 'Use as record source'}
          </Button>
        </div>

        {error !== null && (
          <p role="alert" data-testid="sql-error" className="px-2 py-1.5 text-[12px] text-overflow">
            {error.message}
            {error.hint !== undefined && <span className="text-ink-muted"> {error.hint}</span>}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {result === null ? (
            <p className="p-2 text-[12px] text-ink-muted">No results yet.</p>
          ) : result.rows.length === 0 ? (
            <p data-testid="sql-empty" className="p-2 text-[12px] text-ink-muted">
              The query returned no rows.
            </p>
          ) : (
            <table data-testid="sql-results" className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="sticky top-0 border-hairline border-b bg-panel px-2 py-1 text-left font-medium text-[11px] text-ink-muted"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: a query result is a positional snapshot, never reordered or edited in place
                    key={index}
                    className="border-hairline border-b"
                  >
                    {result.columns.map((column) => (
                      <td key={column} data-numeric className="px-2 py-1 text-ink">
                        {row[column] === null || row[column] === undefined
                          ? ''
                          : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <aside
        aria-label="Query history"
        className="w-56 shrink-0 overflow-auto border-hairline-strong border-l"
      >
        <h3 className="px-2 py-1.5 font-medium text-[11px] text-ink-muted">History</h3>
        {history.length === 0 ? (
          <p className="px-2 text-[11px] text-ink-subtle">Nothing run yet.</p>
        ) : (
          <ul data-testid="sql-history">
            {history.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  onClick={() => setSql(entry)}
                  className="block w-full truncate px-2 py-1 text-left font-mono text-[11px] text-ink transition-colors hover:bg-accent-weak focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  {entry}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
