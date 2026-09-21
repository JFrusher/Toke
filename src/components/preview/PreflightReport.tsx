'use client';

import { useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { type Finding, preflight, summarise } from '@/engine/preflight/preflight';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { useStudioStore } from '@/engine/store/useStudioStore';

const KIND_LABEL: Record<Finding['kind'], string> = {
  overflow: 'Overflow',
  unresolved: 'Unresolved',
  empty: 'Empty',
};

/**
 * Pre-export scan of every record.
 *
 * Warns, never blocks. A planner who knows one surname is tight and accepts
 * it should not be prevented from printing — the job of this panel is to make
 * sure that acceptance is informed rather than accidental.
 */
export function PreflightReport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const setSelection = useCanvasStore((s) => s.setSelection);
  const records = useDataStore((s) => s.records);
  const setMode = useStudioStore((s) => s.setMode);
  const setCursor = useStudioStore((s) => s.setCursor);

  const report = useMemo(
    () => (open ? preflight({ nodes, rows: records as readonly Record<string, unknown>[] }) : null),
    [open, nodes, records],
  );

  const summary = report === null ? null : summarise(report);

  /** Take the user to the problem rather than describing where it is. */
  function jumpTo(finding: Finding) {
    setSelection([finding.nodeId]);
    if (finding.recordIndex >= 0) {
      setMode('live');
      setCursor(finding.recordIndex, records.length);
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Pre-flight">
      {report === null || summary === null ? null : (
        <div className="flex flex-col gap-3">
          <p
            data-testid="preflight-summary"
            data-clean={report.clean}
            data-findings={report.findings.length}
            className={
              report.clean
                ? 'rounded-[2px] border border-hairline-strong bg-accent-weak px-2.5 py-2 font-semibold text-[12px] text-ok'
                : 'rounded-[2px] border border-hairline-strong px-2.5 py-2 font-semibold text-[12px] text-overflow'
            }
          >
            {report.clean ? (
              <>
                <span data-numeric>{report.recordCount}</span> records, no issues.
              </>
            ) : (
              <>
                <span data-numeric>{summary.affectedRecords}</span> of{' '}
                <span data-numeric>{report.recordCount}</span> records need attention —{' '}
                <span data-numeric>{summary.overflow}</span> overflow,{' '}
                <span data-numeric>{summary.unresolved}</span> unresolved,{' '}
                <span data-numeric>{summary.empty}</span> empty.
              </>
            )}
          </p>

          {report.findings.length > 0 && (
            <ul className="max-h-72 overflow-auto border border-hairline">
              {report.findings.map((finding) => (
                <li
                  key={`${finding.kind}-${finding.nodeId}-${finding.recordIndex}`}
                  className="border-hairline border-b last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => jumpTo(finding)}
                    data-testid="preflight-finding"
                    className="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left hover:bg-accent-weak focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
                  >
                    <span className="flex items-center gap-1.5 text-[11px]">
                      {/* Kind is spelled out as well as coloured — CLAUDE.md
                          §4.7 forbids signalling state by colour alone. */}
                      <span
                        className={
                          finding.kind === 'overflow' ? 'text-overflow' : 'text-conditional'
                        }
                      >
                        {KIND_LABEL[finding.kind]}
                      </span>
                      <span className="text-ink-muted">{finding.nodeName}</span>
                      {finding.recordIndex >= 0 && (
                        <span data-numeric className="text-ink-subtle">
                          record {finding.recordIndex + 1}
                        </span>
                      )}
                    </span>
                    <span className="text-[12px] text-ink">{finding.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-ink-subtle">
            Findings do not block export. Select one to jump to it.
          </p>
        </div>
      )}
    </Modal>
  );
}
