'use client';

import { useEffect, useRef, useState } from 'react';
import { useDataStore } from '@/engine/store/useDataStore';
import { useStudioStore } from '@/engine/store/useStudioStore';

/**
 * Speaks mode switches and record changes to a screen reader.
 *
 * Both are changes to what the canvas *shows* without anything moving in the
 * DOM, so a screen reader has no way to know they happened. Cycling to record
 * 47 of 142 is the single most repeated action in the product and is otherwise
 * completely silent.
 *
 * `polite`, never `assertive`: these announcements follow the user's own
 * action and interrupting them mid-sentence for a cursor step would make fast
 * cycling unusable.
 */
export function LiveAnnouncer() {
  const mode = useStudioStore((s) => s.mode);
  const cursor = useStudioStore((s) => s.cursor);
  const total = useDataStore((s) => s.records.length);
  const records = useDataStore((s) => s.records);
  const recordColumns = useDataStore((s) => s.recordColumns);

  const [message, setMessage] = useState('');
  // Keyed on mode and cursor only. Records arriving from an import re-runs
  // this effect without either having changed, and announcing "Token mode" on
  // an import would be telling the user about something they did not do.
  const spoken = useRef(`${mode}|${cursor}`);

  useEffect(() => {
    const key = `${mode}|${cursor}`;
    if (spoken.current === key) return;
    spoken.current = key;

    if (total === 0) {
      setMessage(mode === 'live' ? 'Live mode. No records.' : 'Token mode.');
      return;
    }

    const labelColumn = recordColumns.find((column) => column.type === 'text')?.name ?? null;
    const current = records[cursor];
    const label =
      labelColumn === null || current === undefined ? '' : String(current[labelColumn] ?? '');

    setMessage(
      mode === 'live'
        ? `Record ${cursor + 1} of ${total}${label === '' ? '' : `. ${label}`}`
        : 'Token mode. Showing the template.',
    );
  }, [mode, cursor, total, records, recordColumns]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-announcer"
      className="sr-only"
    >
      {message}
    </div>
  );
}
