'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useDataStore } from '@/engine/store/useDataStore';
import { useStudioStore } from '@/engine/store/useStudioStore';

/**
 * Record navigation for Live Mode.
 *
 * Counts are shown with tabular numerals (CLAUDE.md §4.3): proportional
 * digits change width as the number changes, so the counter jitters while
 * holding the next key and the controls shift under the cursor.
 */
export function CycleBar() {
  const records = useDataStore((s) => s.records);
  const recordColumns = useDataStore((s) => s.recordColumns);
  const cursor = useStudioStore((s) => s.cursor);
  const setCursor = useStudioStore((s) => s.setCursor);
  const step = useStudioStore((s) => s.step);

  const [query, setQuery] = useState('');

  /** First text-ish column, used as the label people search by. */
  const labelColumn = useMemo(() => {
    const text = recordColumns.find((column) => column.type === 'text');
    return text?.name ?? recordColumns[0]?.name ?? null;
  }, [recordColumns]);

  const total = records.length;

  function search(value: string) {
    setQuery(value);
    if (value.trim() === '' || labelColumn === null) return;

    const needle = value.trim().toLowerCase();
    const found = records.findIndex((record) => {
      const cell = record[labelColumn];
      return cell !== null && cell !== undefined && String(cell).toLowerCase().includes(needle);
    });

    // No match leaves the cursor where it is rather than jumping to record 1,
    // which would lose the user's place on every keystroke that misses.
    if (found !== -1) setCursor(found, total);
  }

  if (total === 0) {
    return (
      <span data-testid="record-counter" className="text-[11px] text-ink-subtle">
        no records
      </span>
    );
  }

  const current = records[cursor];
  const label =
    labelColumn === null || current === undefined ? '' : String(current[labelColumn] ?? '');

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="quiet"
        onClick={() => setCursor(0, total)}
        disabled={cursor === 0}
        aria-label="First record"
      >
        |‹
      </Button>
      <Button
        variant="quiet"
        onClick={() => step(-1, total)}
        disabled={cursor === 0}
        aria-label="Previous record"
      >
        ‹
      </Button>

      <span
        data-numeric
        data-testid="record-counter"
        className="min-w-[68px] text-center text-[11px] text-ink-muted"
      >
        {cursor + 1} / {total}
      </span>

      <Button
        variant="quiet"
        onClick={() => step(1, total)}
        disabled={cursor >= total - 1}
        aria-label="Next record"
      >
        ›
      </Button>
      <Button
        variant="quiet"
        onClick={() => setCursor(total - 1, total)}
        disabled={cursor >= total - 1}
        aria-label="Last record"
      >
        ›|
      </Button>

      <input
        value={query}
        onChange={(event) => search(event.target.value)}
        placeholder={labelColumn === null ? 'search' : `find by ${labelColumn}`}
        aria-label="Find a record"
        data-testid="record-search"
        className="h-6 w-36 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[11px] text-ink placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
      />

      {label !== '' && (
        <span data-testid="record-label" className="truncate text-[11px] text-ink">
          {label}
        </span>
      )}
    </div>
  );
}
