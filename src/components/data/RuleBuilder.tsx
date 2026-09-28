'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  buildRuleQuery,
  RULE_OPS,
  type Rule,
  type RuleColumn,
  type RuleSet,
  readRuleQuery,
  ruleProblems,
} from '@/engine/db/rules';
import { useDataStore } from '@/engine/store/useDataStore';

/**
 * Rules for people who don't write SQL — and a way for those who do to see
 * what the rules mean.
 *
 * Each computed column is a list of "when this, then that" conditions. The
 * builder writes them as a CASE over the record source and shows the SQL it
 * wrote; the column can then drive text, visibility, colour, image, geometry
 * or the design a record prints with.
 *
 * Remounted whenever the record source changes (see the key in AppShell), so
 * its draft always starts from what the design actually uses.
 */

const CONTROL =
  'h-6 min-w-0 rounded-[2px] border border-border-control bg-panel-raised px-1 text-[12px] text-ink placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1';

const NO_VALUE: readonly Rule['op'][] = ['is empty', 'is not empty'];

export function RuleBuilder() {
  const recordSource = useDataStore((s) => s.recordSource);
  const recordColumns = useDataStore((s) => s.recordColumns);
  const setRecordSource = useDataStore((s) => s.setRecordSource);

  const read = readRuleQuery(recordSource);
  const [draft, setDraft] = useState<RuleSet>(() =>
    read.status === 'rules' ? read.rules : { base: recordSource, columns: [] },
  );

  // The base's own columns: the record source minus what the rules compute.
  const computed = new Set(draft.columns.map((column) => column.name.trim().toLowerCase()));
  const baseColumns = recordColumns
    .map((column) => column.name)
    .filter((name) => !(read.status === 'rules' && computed.has(name.toLowerCase())));

  const problems = ruleProblems(draft, baseColumns);
  const sql = buildRuleQuery(draft);

  function updateColumn(index: number, patch: Partial<RuleColumn>) {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)),
    }));
  }

  function updateRule(columnIndex: number, ruleIndex: number, patch: Partial<Rule>) {
    const column = draft.columns[columnIndex];
    if (column === undefined) return;
    updateColumn(columnIndex, {
      rules: column.rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)),
    });
  }

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-[12px]" data-testid="rule-builder">
      {read.status === 'edited' && (
        <p role="status" className="mb-2 text-ink-muted">
          The record source was edited by hand after the rules wrote it. New rules build on it as it
          stands.
        </p>
      )}

      {draft.columns.map((column, columnIndex) => (
        <fieldset
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are edited in place and only appended or removed; the name is user-editable and may repeat mid-edit
          key={columnIndex}
          className="mb-3 flex flex-col gap-1.5 border-hairline border-b pb-3"
        >
          <legend className="sr-only">Computed column {columnIndex + 1}</legend>
          <label className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-ink-muted">New column</span>
            <input
              value={column.name}
              onChange={(event) => updateColumn(columnIndex, { name: event.target.value })}
              placeholder="menu"
              aria-label="Computed column name"
              data-testid={`rule-name-${columnIndex}`}
              className={`${CONTROL} w-40 font-mono`}
            />
            <Button
              variant="quiet"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  columns: current.columns.filter((_, i) => i !== columnIndex),
                }))
              }
            >
              Remove column
            </Button>
          </label>

          {column.rules.map((rule, ruleIndex) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: conditions are ordered and edited in place; order is their meaning (first match wins)
              key={ruleIndex}
              className="flex flex-wrap items-center gap-1.5"
            >
              <span className="w-24 text-[11px] text-ink-muted">
                {ruleIndex === 0 ? 'When' : 'Else when'}
              </span>
              <select
                value={rule.column}
                onChange={(event) =>
                  updateRule(columnIndex, ruleIndex, { column: event.target.value })
                }
                aria-label="Column to test"
                data-testid={`rule-column-${columnIndex}-${ruleIndex}`}
                className={`${CONTROL} font-mono`}
              >
                <option value="">Choose…</option>
                {baseColumns.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={rule.op}
                onChange={(event) =>
                  updateRule(columnIndex, ruleIndex, { op: event.target.value as Rule['op'] })
                }
                aria-label="Comparison"
                data-testid={`rule-op-${columnIndex}-${ruleIndex}`}
                className={CONTROL}
              >
                {RULE_OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              {!NO_VALUE.includes(rule.op) && (
                <input
                  value={rule.value}
                  onChange={(event) =>
                    updateRule(columnIndex, ruleIndex, { value: event.target.value })
                  }
                  aria-label="Value to compare with"
                  data-testid={`rule-value-${columnIndex}-${ruleIndex}`}
                  className={`${CONTROL} w-32`}
                />
              )}
              <span className="text-[11px] text-ink-muted">then</span>
              <input
                value={rule.result}
                onChange={(event) =>
                  updateRule(columnIndex, ruleIndex, { result: event.target.value })
                }
                aria-label="Result when it matches"
                data-testid={`rule-then-${columnIndex}-${ruleIndex}`}
                className={`${CONTROL} w-32`}
              />
              <button
                type="button"
                aria-label="Remove condition"
                onClick={() =>
                  updateColumn(columnIndex, {
                    rules: column.rules.filter((_, i) => i !== ruleIndex),
                  })
                }
                className="h-6 w-6 text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                ×
              </button>
            </div>
          ))}

          <div className="flex items-center gap-1.5">
            <span className="w-24" />
            <Button
              variant="quiet"
              onClick={() =>
                updateColumn(columnIndex, {
                  rules: [...column.rules, { column: '', op: 'is', value: '', result: '' }],
                })
              }
              data-testid={`rule-add-${columnIndex}`}
            >
              Add condition
            </Button>
          </div>

          <label className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-ink-muted">Otherwise</span>
            <input
              value={column.otherwise}
              onChange={(event) => updateColumn(columnIndex, { otherwise: event.target.value })}
              aria-label="Result when nothing matches"
              data-testid={`rule-otherwise-${columnIndex}`}
              className={`${CONTROL} w-40`}
            />
          </label>
        </fieldset>
      ))}

      <div className="mb-3">
        <Button
          variant="quiet"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              columns: [...current.columns, { name: '', rules: [], otherwise: '' }],
            }))
          }
          data-testid="rule-add-column"
        >
          Add computed column
        </Button>
      </div>

      {problems.map((problem) => (
        <p key={problem} className="text-overflow">
          {problem}
        </p>
      ))}

      <h3 className="mt-2 mb-1 font-medium text-[11px] text-ink-muted">
        The SQL these rules write
      </h3>
      <pre
        data-testid="rule-sql"
        className="mb-2 overflow-auto rounded-[2px] border border-hairline bg-panel-raised p-2 font-mono text-[11px] text-ink"
      >
        {sql}
      </pre>

      <div>
        <Button
          disabled={
            draft.columns.length === 0 || problems.length > 0 || sql === recordSource.trim()
          }
          onClick={() => void setRecordSource(sql)}
          data-testid="rule-apply"
        >
          Use as record source
        </Button>
      </div>
    </div>
  );
}
