'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { layoutProblems, variantCounts } from '@/engine/db/recordSource';
import { designSpec, sheetPreset } from '@/engine/imposition/specs';
import {
  assetsForExport,
  downloadPdf,
  fontsForExport,
  serialiseForExport,
  startExport,
} from '@/engine/pdf/exportClient';
import { bindsImages } from '@/engine/scene/bindings';
import type { SceneNode } from '@/engine/scene/types';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { useDesignStore } from '@/engine/store/useDesignStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { useImpositionStore } from '@/engine/store/useImpositionStore';
import { useLibraryStore } from '@/engine/store/useLibraryStore';
import { useStudioStore } from '@/engine/store/useStudioStore';
import { points } from '@/engine/units/types';
import type { AppError } from '@/lib/errors';
import { isErr } from '@/lib/result';

type Run = {
  readonly op: 'export' | 'proof';
  readonly nodes: readonly SceneNode[];
  readonly rows: readonly Record<string, unknown>[];
  readonly artboard: { readonly width: number; readonly height: number };
  readonly filename: string;
  /** Mixed run: each record's `column` names its design (keyed lower-case). */
  readonly layouts?: {
    readonly column: string;
    readonly designs: readonly (readonly [string, readonly SceneNode[]])[];
  };
};

function fileFor(name: string): string {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `toke-${safe === '' ? 'design' : safe}.pdf`;
}

/**
 * Runs the export and shows what it is doing.
 *
 * The work happens in `pdf.worker.ts`; this only reports. A 500-card run takes
 * seconds, and a studio frozen for the duration would read as a crash.
 *
 * With several designs there are two more ways to print: each design as its
 * own file from its own record source, or one mixed run where a column of the
 * record source names the design for each record.
 */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const artboard = useCanvasStore((s) => s.artboard);
  const records = useDataStore((s) => s.records);
  const recordColumns = useDataStore((s) => s.recordColumns);
  const cursor = useStudioStore((s) => s.cursor);
  const designName = useDesignStore((s) => s.designName);
  const others = useDesignStore((s) => s.others);

  const preset = useImpositionStore((s) => s.preset);
  const orientation = useImpositionStore((s) => s.orientation);
  const margin = useImpositionStore((s) => s.margin);
  const bleed = useImpositionStore((s) => s.bleed);
  const cropMarks = useImpositionStore((s) => s.cropMarks);

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  /** '' prints this design for every record; a column name mixes designs. */
  const [layoutColumn, setLayoutColumn] = useState('');
  const cancelRef = useRef<(() => void) | null>(null);

  const counts = layoutColumn === '' ? [] : variantCounts(records, layoutColumn);
  const problems = layoutProblems(
    counts,
    others.map((design) => ({ name: design.name, ...design.artboard })),
    artboard,
  );

  /** Renders one run in the worker. Resolves true when a file was downloaded. */
  async function render(run: Run): Promise<boolean> {
    setProgress(0);
    const worker = new Worker(new URL('@/engine/pdf/pdf.worker.ts', import.meta.url), {
      type: 'module',
    });

    // Every design the run may print, for fonts and images alike.
    const all = [...run.nodes, ...(run.layouts?.designs.flatMap(([, design]) => design) ?? [])];
    // Resolved before the job is posted: the worker gets plain bytes and never
    // reaches into IndexedDB itself. A binding may pick any library image, so
    // the whole library ships then.
    const images = useLibraryStore.getState().images;
    const assets = await assetsForExport(all, bindsImages(all) ? images.values() : []);

    const handle = startExport(
      worker,
      {
        nodes: serialiseForExport(run.nodes),
        rows: run.rows,
        sheet: sheetPreset(preset, orientation),
        design: designSpec({
          width: points(run.artboard.width),
          height: points(run.artboard.height),
          bleed,
        }),
        margin,
        cropMarks,
        assets,
        images: [...images],
        fonts: fontsForExport(all),
        ...(run.layouts === undefined
          ? {}
          : {
              layouts: {
                column: run.layouts.column,
                designs: run.layouts.designs.map(
                  ([name, design]) => [name, serialiseForExport(design)] as const,
                ),
              },
            }),
      },
      setProgress,
      run.op,
    );
    cancelRef.current = handle.cancel;

    const result = await handle.result;
    worker.terminate();
    cancelRef.current = null;
    setProgress(null);

    if (isErr(result)) {
      setError(result.error);
      reportDiagnostic('export', 'error', result.error);
      return false;
    }
    downloadPdf(result.value.bytes, run.filename);
    return true;
  }

  async function exportThis(op: 'export' | 'proof') {
    setError(null);
    const mixed = layoutColumn !== '' && op === 'export';
    const done = await render({
      op,
      nodes,
      // A proof is one record — the one being previewed — so the worker is
      // handed that row alone rather than the whole run.
      rows: op === 'proof' ? records.slice(cursor, cursor + 1) : records,
      artboard,
      filename: op === 'proof' ? 'toke-proof.pdf' : 'toke.pdf',
      ...(mixed
        ? {
            layouts: {
              column: layoutColumn,
              designs: others.map(
                (design) => [design.name.trim().toLowerCase(), design.nodes] as const,
              ),
            },
          }
        : {}),
    });
    if (done) onClose();
  }

  /** One file per design, each printing its own record source. */
  async function exportEach() {
    setError(null);
    const first = await render({
      op: 'export',
      nodes,
      rows: records,
      artboard,
      filename: fileFor(designName),
    });
    if (!first) return;

    for (const design of others) {
      const rows = await useDataStore.getState().query(design.recordSource);
      if (isErr(rows)) {
        setError(rows.error);
        reportDiagnostic('export', 'error', rows.error);
        return;
      }
      const done = await render({
        op: 'export',
        nodes: design.nodes,
        rows: rows.value.rows,
        artboard: design.artboard,
        filename: fileFor(design.name),
      });
      if (!done) return;
    }
    onClose();
  }

  const running = progress !== null;

  return (
    <Modal open={open} onClose={onClose} title="Export PDF">
      <div className="flex flex-col gap-3">
        <p data-numeric className="text-[13px] text-ink-muted">
          {records.length} records · proof shows record {Math.min(cursor + 1, records.length)}
        </p>

        {others.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-muted">Design per record</span>
            <select
              value={layoutColumn}
              onChange={(event) => setLayoutColumn(event.target.value)}
              data-testid="export-layout-column"
              className="h-7 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
            >
              <option value="">{designName} for every record</option>
              {recordColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  The design named in {column.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {counts.length > 0 && (
          // The count a planner checks before printing a mixed run.
          <ul data-testid="export-variants" data-numeric className="text-[12px] text-ink">
            {counts.map(([value, count]) => (
              <li key={value}>
                {count} × {value === '' ? designName : value}
              </li>
            ))}
          </ul>
        )}

        {problems.map((problem) => (
          <p key={problem} role="alert" className="text-[12px] text-overflow">
            {problem}
          </p>
        ))}

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

        <div className="flex flex-wrap justify-end gap-1.5">
          {running ? (
            <Button variant="quiet" onClick={() => cancelRef.current?.()}>
              Cancel
            </Button>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Close
            </Button>
          )}
          <Button
            variant="quiet"
            onClick={() => void exportThis('proof')}
            disabled={running || records.length === 0}
            data-testid="run-proof"
          >
            Proof this record
          </Button>
          {others.length > 0 && (
            <Button
              variant="quiet"
              onClick={() => void exportEach()}
              disabled={running}
              data-testid="run-export-each"
            >
              Each design separately
            </Button>
          )}
          <Button
            onClick={() => void exportThis('export')}
            disabled={running || records.length === 0 || problems.length > 0}
            data-testid="run-export"
          >
            Export
          </Button>
        </div>
      </div>
    </Modal>
  );
}
