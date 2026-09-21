'use client';

import { useEffect, useState } from 'react';
import { CsvImportDialog } from '@/components/data/CsvImportDialog';
import { DataGrid } from '@/components/data/DataGrid';
import { Button } from '@/components/ui/Button';
import { useDataStore } from '@/engine/store/useDataStore';

/**
 * Interim shell. The four-pane studio is assembled in P9.1; until then this
 * route exists so the data layer can be driven end to end.
 */
export default function StudioPage() {
  const status = useDataStore((s) => s.status);
  const error = useDataStore((s) => s.error);
  const table = useDataStore((s) => s.table);
  const open = useDataStore((s) => s.open);
  const addRow = useDataStore((s) => s.addRow);

  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void open();
  }, [open]);

  return (
    <main className="flex h-dvh flex-col bg-panel">
      <header className="flex shrink-0 items-center gap-3 border-hairline-strong border-b px-3 py-2">
        <h1 className="font-semibold text-[13px] tracking-tight">toke</h1>
        <span className="font-mono text-[11px] text-ink-muted">{table}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button onClick={() => setImporting(true)} data-testid="open-import">
            Import CSV
          </Button>
          <Button variant="quiet" onClick={() => void addRow()}>
            Add row
          </Button>
        </div>
      </header>

      {status === 'opening' && (
        <p className="p-4 text-[12px] text-ink-muted">Starting the database…</p>
      )}

      {error !== null && (
        <p role="alert" className="border-hairline border-b px-3 py-2 text-[12px] text-overflow">
          {error.message}
          {error.hint !== undefined && <span className="ml-1 text-ink-muted">{error.hint}</span>}
        </p>
      )}

      {status === 'ready' && (
        <div className="min-h-0 flex-1">
          <DataGrid />
        </div>
      )}

      <CsvImportDialog open={importing} onClose={() => setImporting(false)} />
    </main>
  );
}
