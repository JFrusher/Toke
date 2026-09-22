'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { useImpositionStore } from '@/engine/store/useImpositionStore';
import { TEMPLATES, type Template } from '@/engine/templates/templates';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, points } from '@/engine/units/types';
import type { AppError } from '@/lib/errors';
import { isErr } from '@/lib/result';

/**
 * Starter designs for an empty studio.
 *
 * A template loads a working design AND its sample roster, so a new user
 * reaches a correct exported PDF without importing anything — which is the
 * acceptance criterion, and also the fastest way to find out whether the tool
 * does what they need.
 */
export function TemplateGallery({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loadScene = useCanvasStore((s) => s.loadScene);
  const runImport = useDataStore((s) => s.runImport);
  const setRecordSource = useDataStore((s) => s.setRecordSource);
  const setBleed = useImpositionStore((s) => s.setBleed);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  async function apply(template: Template) {
    setBusy(template.id);
    setError(null);

    // Data first: loading the scene before the roster exists would show every
    // bound token as unresolved for as long as the import takes.
    const imported = await runImport(template.sampleCsv, 'replace');
    if (isErr(imported)) {
      setError(imported.error);
      reportDiagnostic('templates', 'error', imported.error);
      setBusy(null);
      return;
    }

    await setRecordSource(template.recordSource);

    loadScene(template.nodes, {
      x: points(0),
      y: points(0),
      width: template.trim.width,
      // A tent card is printed at double height and folded, so the artboard is
      // the PRINTED size, not the finished one.
      height: template.tentFold ? points(template.trim.height * 2) : template.trim.height,
    });

    setBleed(millimetresToPoints(millimetres(3)));
    setBusy(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Start from a template">
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {TEMPLATES.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void apply(template)}
                data-testid={`template-${template.id}`}
                className="flex w-full flex-col gap-0.5 rounded-[2px] border border-border-control bg-panel-raised px-3 py-2 text-left transition-colors hover:bg-accent-weak focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:opacity-60"
              >
                <span className="font-medium text-[13px] text-ink">{template.name}</span>
                <span data-numeric className="text-[11px] text-ink-muted">
                  {template.description}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p data-numeric className="text-[11px] text-ink-subtle">
          Each template imports a 24-guest sample roster, replacing the current data.
        </p>

        {error !== null && (
          <p role="alert" data-testid="template-error" className="text-[12px] text-overflow">
            {error.message}
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
