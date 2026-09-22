'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { LayersPanel } from '@/components/canvas/LayersPanel';
import { CsvImportDialog } from '@/components/data/CsvImportDialog';
import { DataGrid } from '@/components/data/DataGrid';
import { ExportDialog } from '@/components/imposition/ExportDialog';
import { ImpositionPanel } from '@/components/imposition/ImpositionPanel';
import { TokenBindingPanel } from '@/components/inspector/TokenBindingPanel';
import { TransformFields } from '@/components/inspector/TransformFields';
import { PreflightReport } from '@/components/preview/PreflightReport';
import { DiagnosticsPanel } from '@/components/shell/DiagnosticsPanel';
import { FileMenu } from '@/components/shell/FileMenu';
import { ResizeHandle } from '@/components/shell/ResizeHandle';
import { Button } from '@/components/ui/Button';
import { installDiagnosticsBridge } from '@/engine/store/diagnosticsBridge';
import { useDataStore } from '@/engine/store/useDataStore';
import { useDiagnosticsStore } from '@/engine/store/useDiagnosticsStore';
import { type BottomTab, LIMITS, useShellStore } from '@/engine/store/useShellStore';

// Fabric touches document/window at import time, so the canvas never renders
// on the server.
const StudioCanvas = dynamic(
  () => import('@/components/canvas/StudioCanvas').then((m) => m.StudioCanvas),
  { ssr: false, loading: () => <div className="h-full w-full bg-pasteboard" /> },
);

const TABS: readonly { id: BottomTab; label: string }[] = [
  { id: 'data', label: 'Data' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

/**
 * The four-pane studio: header, toolbar, sidebars around the canvas, and a
 * dock along the bottom.
 *
 * Panel sizes are flex bases in pixels rather than percentages, so the canvas
 * absorbs a window resize and the panels stay where they were put.
 */
export function AppShell() {
  const dataStatus = useDataStore((s) => s.status);
  const dataError = useDataStore((s) => s.error);

  const leftWidth = useShellStore((s) => s.leftWidth);
  const rightWidth = useShellStore((s) => s.rightWidth);
  const bottomHeight = useShellStore((s) => s.bottomHeight);
  const leftOpen = useShellStore((s) => s.leftOpen);
  const rightOpen = useShellStore((s) => s.rightOpen);
  const bottomOpen = useShellStore((s) => s.bottomOpen);
  const bottomTab = useShellStore((s) => s.bottomTab);
  const setBottomTab = useShellStore((s) => s.setBottomTab);
  const setLeftWidth = useShellStore((s) => s.setLeftWidth);
  const setRightWidth = useShellStore((s) => s.setRightWidth);
  const setBottomHeight = useShellStore((s) => s.setBottomHeight);
  const toggleLeft = useShellStore((s) => s.toggleLeft);
  const toggleRight = useShellStore((s) => s.toggleRight);
  const toggleBottom = useShellStore((s) => s.toggleBottom);
  const hydrate = useShellStore((s) => s.hydrate);

  const errorCount = useDiagnosticsStore(
    (s) => s.entries.filter((entry) => entry.severity === 'error').length,
  );

  const [importing, setImporting] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // After mount, not during render: the server has no localStorage, and a
  // first paint at the saved width followed by React's own would be the layout
  // shift this task exists to avoid.
  useEffect(() => {
    hydrate();
    installDiagnosticsBridge();
  }, [hydrate]);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-panel">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-hairline-strong border-b px-3 py-2">
        <h1 className="font-semibold text-[13px] tracking-tight">toke</h1>
        <FileMenu />

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            onClick={toggleLeft}
            aria-pressed={leftOpen}
            data-testid="toggle-left"
            variant="quiet"
          >
            Layers
          </Button>
          <Button
            onClick={toggleRight}
            aria-pressed={rightOpen}
            data-testid="toggle-right"
            variant="quiet"
          >
            Inspector
          </Button>
          <Button
            onClick={toggleBottom}
            aria-pressed={bottomOpen}
            data-testid="toggle-data"
            variant="quiet"
          >
            Data
          </Button>
          <Button
            onClick={() => setBottomTab('diagnostics')}
            data-testid="open-diagnostics"
            variant="quiet"
          >
            {/* The count is the point: a badge with no number says only that
                something happened, which is the least useful thing to say. */}
            <span data-numeric>Issues {errorCount}</span>
          </Button>
          <Button onClick={() => setImporting(true)} data-testid="open-import">
            Import CSV
          </Button>
          <Button onClick={() => setExporting(true)} data-testid="open-export">
            Export PDF
          </Button>
        </div>
      </header>

      <CanvasToolbar onPreflight={() => setPreflighting(true)} />

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <>
            <aside
              style={{ width: leftWidth }}
              aria-label="Layers"
              className="flex shrink-0 flex-col overflow-auto bg-panel"
            >
              <LayersPanel />
            </aside>
            <ResizeHandle
              orientation="horizontal"
              value={leftWidth}
              min={LIMITS.left.min}
              max={LIMITS.left.max}
              onChange={setLeftWidth}
              label="Layers width"
            />
          </>
        )}

        <div className="min-w-0 flex-1">
          <StudioCanvas />
        </div>

        {rightOpen && (
          <>
            <ResizeHandle
              orientation="horizontal"
              value={rightWidth}
              min={LIMITS.right.min}
              max={LIMITS.right.max}
              onChange={setRightWidth}
              label="Inspector width"
              invert
            />
            <aside
              style={{ width: rightWidth }}
              aria-label="Inspector"
              className="shrink-0 overflow-auto bg-panel"
            >
              <TransformFields />
              <TokenBindingPanel />
              <ImpositionPanel />
            </aside>
          </>
        )}
      </div>

      {bottomOpen && (
        <>
          <ResizeHandle
            orientation="vertical"
            value={bottomHeight}
            min={LIMITS.bottom.min}
            max={LIMITS.bottom.max}
            onChange={setBottomHeight}
            label="Dock height"
          />
          <section
            style={{ height: bottomHeight }}
            aria-label="Dock"
            data-testid="bottom-dock"
            className="flex shrink-0 flex-col overflow-hidden border-hairline-strong border-t"
          >
            <div role="tablist" aria-label="Dock" className="flex shrink-0 gap-px bg-panel">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`dock-tab-${tab.id}`}
                  aria-selected={bottomTab === tab.id}
                  aria-controls={`dock-panel-${tab.id}`}
                  tabIndex={bottomTab === tab.id ? 0 : -1}
                  onClick={() => setBottomTab(tab.id)}
                  onKeyDown={(event) => {
                    const step =
                      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                    if (step === 0) return;
                    event.preventDefault();
                    const index = TABS.findIndex((entry) => entry.id === bottomTab);
                    const next = TABS[(index + step + TABS.length) % TABS.length];
                    if (next !== undefined) {
                      setBottomTab(next.id);
                      document.getElementById(`dock-tab-${next.id}`)?.focus();
                    }
                  }}
                  data-testid={`dock-tab-${tab.id}`}
                  className={`h-7 px-3 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 ${
                    bottomTab === tab.id
                      ? 'border-accent border-b-2 bg-panel-raised text-ink'
                      : 'border-transparent border-b-2 text-ink-muted hover:text-ink'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              role="tabpanel"
              id={`dock-panel-${bottomTab}`}
              aria-labelledby={`dock-tab-${bottomTab}`}
              className="min-h-0 flex-1 overflow-hidden"
            >
              {bottomTab === 'diagnostics' ? (
                <DiagnosticsPanel />
              ) : (
                <>
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
                </>
              )}
            </div>
          </section>
        </>
      )}

      <CsvImportDialog open={importing} onClose={() => setImporting(false)} />
      <PreflightReport open={preflighting} onClose={() => setPreflighting(false)} />
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </main>
  );
}
