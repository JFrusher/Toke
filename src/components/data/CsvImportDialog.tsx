// biome-ignore-all lint/suspicious/noArrayIndexKey: the preview table renders a fixed slice of parsed rows that is never reordered, filtered or mutated, and holds no per-row state.

'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { parseCsv, proposeMapping } from '@/engine/db/csv';
import type { ImportMode } from '@/engine/db/import';
import { useDataStore } from '@/engine/store/useDataStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { isErr, isOk } from '@/lib/result';

const PREVIEW_ROWS = 8;

export function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const columns = useDataStore((s) => s.columns);
  const runImport = useDataStore((s) => s.runImport);

  const [text, setText] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const [mode, setMode] = useState<ImportMode>('replace');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = text === null ? null : parseCsv(text);
  const csv = parsed !== null && isOk(parsed) ? parsed.value : null;
  const parseError = parsed !== null && isErr(parsed) ? parsed.error : null;
  const mapping = csv === null ? [] : proposeMapping(csv.columns, columns);

  // Reported from an effect, not from the render that derives it: a store
  // write during render is a React violation, and keying on the message
  // rather than the object stops parseCsv's fresh error inflating the count.
  const parseMessage = parseError?.message ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the message, so re-parsing the same text reports once rather than per render
  useEffect(() => {
    if (parseError !== null) reportDiagnostic('import', 'error', parseError);
  }, [parseMessage]);

  function reset() {
    setText(null);
    setFilename('');
    setProblem(null);
    setBusy(false);
  }

  async function onFile(file: File | undefined) {
    if (file === undefined) return;
    setProblem(null);
    setFilename(file.name);
    setText(await file.text());
  }

  async function confirm() {
    if (text === null) return;
    setBusy(true);

    try {
      const result = await runImport(text, mode);
      if (isErr(result)) {
        setProblem(result.error.message);
        reportDiagnostic('import', 'error', result.error);
        return;
      }
      reset();
      onClose();
    } catch (error) {
      // Without this, a rejection leaves `busy` true and the dialog open with
      // no message — the user is stuck in a modal that never resolves and has
      // no idea why.
      const message = error instanceof Error ? error.message : 'The import failed.';
      setProblem(message);
      reportDiagnostic('import', 'error', { code: 'CSV_IMPORT_FAILED', message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import CSV"
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-[11px] text-ink-muted">File</span>
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="csv-file"
            onChange={(event) => void onFile(event.target.files?.[0])}
            className="rounded-[2px] border border-border-control bg-panel-raised px-2 py-1.5 text-[12px] text-ink file:mr-2 file:rounded-[2px] file:border-0 file:bg-accent-weak file:px-2 file:py-1 file:text-[11px] file:text-accent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
          />
        </label>

        {parseError !== null && (
          <p role="alert" className="text-[12px] text-overflow">
            {parseError.message}
            {parseError.hint !== undefined && (
              <span className="block text-ink-muted">{parseError.hint}</span>
            )}
          </p>
        )}

        {csv !== null && (
          <>
            <p className="text-[12px] text-ink-muted" data-testid="csv-summary">
              <span data-numeric className="text-ink">
                {csv.rowCount}
              </span>{' '}
              rows · <span data-numeric>{csv.columns.length}</span> columns · delimiter{' '}
              <code className="font-mono">{csv.delimiter === '\t' ? 'tab' : csv.delimiter}</code>
            </p>

            {csv.ragged.length > 0 && (
              <p role="alert" className="text-[12px] text-overflow">
                {csv.ragged.length} row(s) have the wrong number of columns — first at row{' '}
                <span data-numeric>{csv.ragged[0]?.row}</span>. They will import with missing
                values.
              </p>
            )}

            <div className="overflow-x-auto border border-hairline">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-panel">
                    {mapping.map((column) => (
                      <th
                        key={column.source}
                        className="border-hairline border-b px-2 py-1 text-left font-medium"
                      >
                        <span className="block text-ink">{column.source}</span>
                        <span
                          className={
                            column.action === 'ignore'
                              ? 'block text-ink-subtle'
                              : 'block text-ink-muted'
                          }
                        >
                          {column.action === 'ignore'
                            ? 'ignored'
                            : column.action === 'create'
                              ? `new · ${column.type}`
                              : `${column.target} · ${column.type}`}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csv.rows.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {mapping.map((column, columnIndex) => (
                        <td
                          key={column.source}
                          className="truncate border-hairline border-b px-2 py-1 text-ink-muted"
                        >
                          {row[columnIndex] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="font-medium text-[11px] text-ink-muted">On import</legend>
              {(
                [
                  ['replace', 'Replace all existing records'],
                  ['append', 'Add to existing records'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="radio"
                    name="import-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="accent-accent"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </>
        )}

        {problem !== null && (
          <p role="alert" className="text-[12px] text-overflow">
            {problem}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-hairline border-t pt-3">
          <span className="mr-auto truncate text-[11px] text-ink-subtle">{filename}</span>
          <Button
            variant="quiet"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={csv === null || busy}
            onClick={() => void confirm()}
            data-testid="csv-confirm"
          >
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
