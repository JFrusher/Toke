'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { designSpec, sheetPreset } from '@/engine/imposition/specs';
import { downloadPdf, serialiseForExport, startExport } from '@/engine/pdf/exportClient';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { useImpositionStore } from '@/engine/store/useImpositionStore';
import { points } from '@/engine/units/types';
import type { AppError } from '@/lib/errors';
import { isErr } from '@/lib/result';

/**
 * Runs the export and shows what it is doing.
 *
 * The work happens in `pdf.worker.ts`; this only reports. A 500-card run takes
 * seconds, and a studio frozen for the duration would read as a crash.
 */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const artboard = useCanvasStore((s) => s.artboard);
  const records = useDataStore((s) => s.records);

  const preset = useImpositionStore((s) => s.preset);
  const orientation = useImpositionStore((s) => s.orientation);
  const margin = useImpositionStore((s) => s.margin);
  const bleed = useImpositionStore((s) => s.bleed);
  const cropMarks = useImpositionStore((s) => s.cropMarks);

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  async function run() {
    setError(null);
    setProgress(0);

    const worker = new Worker(new URL('@/engine/pdf/pdf.worker.ts', import.meta.url), {
      type: 'module',
    });

    const handle = startExport(
      worker,
      {
        nodes: serialiseForExport(nodes),
        rows: records,
        sheet: sheetPreset(preset, orientation),
        design: designSpec({
          width: points(artboard.width),
          height: points(artboard.height),
          bleed,
        }),
        margin,
        cropMarks,
        assets: [],
      },
      setProgress,
    );
    cancelRef.current = handle.cancel;

    const result = await handle.result;
    worker.terminate();
    cancelRef.current = null;
    setProgress(null);

    if (isErr(result)) {
      setError(result.error);
      return;
    }

    downloadPdf(result.value.bytes, 'toke.pdf');
    onClose();
  }

  const running = progress !== null;

  return (
    <Modal open={open} onClose={onClose} title="Export PDF">
      <div className="flex flex-col gap-3">
        <p data-numeric className="text-[13px] text-ink-muted">
          {records.length} records
        </p>

        {running && (
          <p data-testid="export-progress" data-numeric className="text-[13px] text-ink">
            Rendering… {Math.round(progress * 100)}%
          </p>
        )}

        {error !== null && (
          // Colour is never the only signal (CLAUDE.md §4.7): the message says
          // what failed and the hint says what to do.
          <p role="alert" data-testid="export-error" className="text-[13px] text-overflow">
            {error.message}
            {error.hint === undefined ? '' : ` ${error.hint}`}
          </p>
        )}

        <div className="flex justify-end gap-1.5">
          {running ? (
            <Button variant="quiet" onClick={() => cancelRef.current?.()}>
              Cancel
            </Button>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Close
            </Button>
          )}
          <Button onClick={run} disabled={running || records.length === 0} data-testid="run-export">
            Export
          </Button>
        </div>
      </div>
    </Modal>
  );
}
