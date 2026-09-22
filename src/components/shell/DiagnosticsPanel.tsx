'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { type Severity, useDiagnosticsStore } from '@/engine/store/useDiagnosticsStore';

/**
 * Everything that has gone wrong, in one list.
 *
 * A finding carrying an `objectId` selects that object when clicked — which is
 * the whole reason `AppError` carries one. Reading "text overflows" with no way
 * to find *which* text on a 40-object card is barely better than silence.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
};

/**
 * Colour is never the only carrier (CLAUDE.md §4.7) — each row shows the word
 * as well, so the list still reads correctly in greyscale or with a colour
 * vision deficiency.
 */
const SEVERITY_CLASS: Record<Severity, string> = {
  error: 'text-overflow',
  warning: 'text-conditional',
  info: 'text-ink-muted',
};

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function DiagnosticsPanel() {
  const entries = useDiagnosticsStore((s) => s.entries);
  const clear = useDiagnosticsStore((s) => s.clear);
  const setSelection = useCanvasStore((s) => s.setSelection);

  const [filter, setFilter] = useState<Severity | 'all'>('all');

  const shown = useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => entry.severity === filter)),
    [entries, filter],
  );

  const counts = useMemo(
    () => ({
      error: entries.filter((e) => e.severity === 'error').length,
      warning: entries.filter((e) => e.severity === 'warning').length,
      info: entries.filter((e) => e.severity === 'info').length,
    }),
    [entries],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-hairline border-b px-3 py-1.5">
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Filter by severity</legend>
          {(['all', 'error', 'warning', 'info'] as const).map((option) => (
            <Button
              key={option}
              variant={filter === option ? 'default' : 'quiet'}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              data-testid={`diagnostics-filter-${option}`}
            >
              <span data-numeric>
                {option === 'all'
                  ? `All ${entries.length}`
                  : `${SEVERITY_LABEL[option]} ${counts[option]}`}
              </span>
            </Button>
          ))}
        </fieldset>

        <Button
          variant="quiet"
          onClick={clear}
          disabled={entries.length === 0}
          className="ml-auto"
          data-testid="diagnostics-clear"
        >
          Clear
        </Button>
      </div>

      {shown.length === 0 ? (
        <p data-testid="diagnostics-empty" className="p-3 text-[12px] text-ink-muted">
          {entries.length === 0
            ? 'Nothing to report.'
            : `No ${SEVERITY_LABEL[filter as Severity].toLowerCase()} entries.`}
        </p>
      ) : (
        <ul data-testid="diagnostics-list" className="min-h-0 flex-1 overflow-auto">
          {shown.map((entry) => {
            const focusable = entry.error.objectId !== undefined;
            return (
              <li key={entry.id} className="border-hairline border-b">
                <button
                  type="button"
                  disabled={!focusable}
                  onClick={() => {
                    if (entry.error.objectId !== undefined) setSelection([entry.error.objectId]);
                  }}
                  data-testid="diagnostics-entry"
                  data-code={entry.error.code}
                  data-object={entry.error.objectId ?? ''}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent-weak focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 disabled:hover:bg-transparent"
                >
                  <span data-numeric className="shrink-0 text-[11px] text-ink-subtle">
                    {timeOf(entry.at)}
                  </span>
                  <span className={`w-14 shrink-0 text-[11px] ${SEVERITY_CLASS[entry.severity]}`}>
                    {SEVERITY_LABEL[entry.severity]}
                  </span>
                  <span className="w-20 shrink-0 truncate text-[11px] text-ink-muted">
                    {entry.source}
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] text-ink">
                    {entry.error.message}
                    {entry.error.hint !== undefined && (
                      <span className="text-ink-muted"> {entry.error.hint}</span>
                    )}
                  </span>
                  {entry.count > 1 && (
                    <span data-numeric className="shrink-0 text-[11px] text-ink-subtle">
                      x{entry.count}
                    </span>
                  )}
                  {focusable && <span className="shrink-0 text-[11px] text-accent">Select</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
