'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { LayersPanel } from '@/components/canvas/LayersPanel';
import { CsvImportDialog } from '@/components/data/CsvImportDialog';
import { DataGrid } from '@/components/data/DataGrid';
import { TransformFields } from '@/components/inspector/TransformFields';
import { FileMenu } from '@/components/shell/FileMenu';
import { Button } from '@/components/ui/Button';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { points } from '@/engine/units/types';

// Fabric touches document/window at import time, so the canvas never renders
// on the server.
const StudioCanvas = dynamic(
  () => import('@/components/canvas/StudioCanvas').then((m) => m.StudioCanvas),
  { ssr: false, loading: () => <div className="h-full w-full bg-pasteboard" /> },
);

const NUDGE = 1;
const NUDGE_LARGE = 10;

const TOOL_KEYS: Record<string, 'select' | 'text' | 'rect' | 'ellipse' | 'line'> = {
  v: 'select',
  t: 'text',
  r: 'rect',
  e: 'ellipse',
  l: 'line',
};

/** True when the event came from somewhere the user is typing. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export default function StudioPage() {
  const dataStatus = useDataStore((s) => s.status);
  const dataError = useDataStore((s) => s.error);
  const openDatabase = useDataStore((s) => s.open);

  const [importing, setImporting] = useState(false);
  const [showData, setShowData] = useState(false);

  useEffect(() => {
    void openDatabase();
  }, [openDatabase]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const store = useCanvasStore.getState();

      // Never steal keys from a text field — typing "r" in a name should not
      // switch to the rectangle tool.
      if (isTextEntry(event.target)) return;

      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.deleteSelection();
        return;
      }

      if (event.key === 'Escape') {
        store.setSelection([]);
        return;
      }

      const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = nudges[event.key];
      if (delta !== undefined) {
        event.preventDefault();
        store.nudge(points(delta[0]), points(delta[1]));
        return;
      }

      if (!modifier) {
        const tool = TOOL_KEYS[event.key.toLowerCase()];
        if (tool !== undefined) store.setTool(tool);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className="flex h-dvh flex-col bg-panel">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-hairline-strong border-b px-3 py-2">
        <h1 className="font-semibold text-[13px] tracking-tight">toke</h1>
        <FileMenu />

        <div className="ml-auto flex items-center gap-1.5">
          <Button onClick={() => setShowData((open) => !open)} data-testid="toggle-data">
            {showData ? 'Hide data' : 'Show data'}
          </Button>
          <Button onClick={() => setImporting(true)} data-testid="open-import">
            Import CSV
          </Button>
        </div>
      </header>

      <CanvasToolbar />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-hairline-strong border-r bg-panel">
          <LayersPanel />
        </aside>

        <div className="min-w-0 flex-1">
          <StudioCanvas />
        </div>

        <aside className="w-60 shrink-0 overflow-auto border-hairline-strong border-l bg-panel">
          <TransformFields />
        </aside>
      </div>

      {showData && (
        <section className="h-64 shrink-0 border-hairline-strong border-t">
          {dataError !== null && (
            <p role="alert" className="px-3 py-2 text-[12px] text-overflow">
              {dataError.message}
            </p>
          )}
          {dataStatus === 'ready' ? (
            <DataGrid />
          ) : (
            <p className="p-3 text-[12px] text-ink-muted">Starting the database…</p>
          )}
        </section>
      )}

      <CsvImportDialog open={importing} onClose={() => setImporting(false)} />
    </main>
  );
}
