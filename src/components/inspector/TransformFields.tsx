'use client';

import { useEffect, useState } from 'react';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useShellStore } from '@/engine/store/useShellStore';
import { formatNumber } from '@/engine/units/format';
import { parseLength } from '@/engine/units/parse';
import type { DisplayUnit } from '@/engine/units/types';
import { points } from '@/engine/units/types';
import { cn } from '@/lib/cn';
import { isOk } from '@/lib/result';

const RADIANS_PER_DEGREE = Math.PI / 180;

/**
 * Numeric field over a Points value.
 *
 * Holds a local draft while focused so typing "8" on the way to "85" does not
 * resize the object to 8mm on every keystroke, and re-syncs from the store
 * whenever the value changes from elsewhere (a canvas drag).
 */
function NumberField({
  label,
  value,
  suffix,
  unit,
  onCommit,
  disabled,
}: {
  label: string;
  value: number | null;
  suffix: string;
  unit: DisplayUnit;
  onCommit: (next: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = value === null ? '—' : formatNumber(points(value), unit);

  useEffect(() => {
    setDraft(null);
  }, []);

  function commit(raw: string) {
    setDraft(null);
    const parsed = parseLength(raw, unit);
    if (isOk(parsed)) onCommit(parsed.value);
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="w-4 shrink-0 text-[11px] text-ink-muted">{label}</span>
      <span className="relative flex-1">
        <input
          data-numeric
          data-testid={`field-${label.toLowerCase()}`}
          disabled={disabled}
          value={draft ?? display}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => setDraft(event.target.value === '—' ? '' : event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(event.currentTarget.value);
            if (event.key === 'Escape') setDraft(null);
          }}
          className={cn(
            'h-6 w-full rounded-[2px] border border-border-control bg-panel-raised',
            'px-1.5 pr-6 text-[12px] text-ink',
            'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1',
            'disabled:bg-panel disabled:text-ink-disabled',
          )}
        />
        <span className="pointer-events-none absolute top-1 right-1.5 text-[11px] text-ink-subtle">
          {suffix}
        </span>
      </span>
    </label>
  );
}

export function TransformFields() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const replaceNodes = useCanvasStore((s) => s.replaceNodes);
  const unit = useShellStore((s) => s.displayUnit);
  const live = useCanvasStore((s) => s.liveTransform);

  const selected = nodes
    .filter((node) => selection.includes(node.id))
    // VER-5: while an object is being dragged or resized the fields read its
    // live geometry, so they track the gesture instead of jumping at the end.
    // The node itself is untouched until the gesture commits.
    .map((node) =>
      live !== null && live.id === node.id
        ? {
            ...node,
            x: points(live.x),
            y: points(live.y),
            width: points(live.width),
            height: points(live.height),
          }
        : node,
    );

  /** Mixed values read as an em dash rather than showing the first object's
   *  number, which would look editable and be wrong. */
  function shared(read: (node: (typeof selected)[number]) => number): number | null {
    if (selected.length === 0) return null;
    const first = read(selected[0] as (typeof selected)[number]);
    return selected.every((node) => Math.abs(read(node) - first) < 1e-9) ? first : null;
  }

  function apply(
    update: (node: (typeof selected)[number]) => (typeof selected)[number],
    label: string,
  ) {
    const ids = new Set(selection);
    replaceNodes(
      nodes.map((node) => (ids.has(node.id) ? update(node) : node)),
      label,
    );
  }

  const disabled = selected.length === 0;

  return (
    <section className="flex flex-col gap-2 border-hairline border-b p-3">
      <h2 className="font-medium text-[11px] text-ink-muted">Transform</h2>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <NumberField
          label="X"
          suffix={unit}
          unit={unit}
          disabled={disabled}
          value={shared((n) => n.x)}
          onCommit={(next) => apply((node) => ({ ...node, x: points(next) }), 'Set X')}
        />
        <NumberField
          label="Y"
          suffix={unit}
          unit={unit}
          disabled={disabled}
          value={shared((n) => n.y)}
          onCommit={(next) => apply((node) => ({ ...node, y: points(next) }), 'Set Y')}
        />
        <NumberField
          label="W"
          suffix={unit}
          unit={unit}
          disabled={disabled}
          value={shared((n) => n.width)}
          onCommit={(next) => apply((node) => ({ ...node, width: points(next) }), 'Set width')}
        />
        <NumberField
          label="H"
          suffix={unit}
          unit={unit}
          disabled={disabled}
          value={shared((n) => n.height)}
          onCommit={(next) => apply((node) => ({ ...node, height: points(next) }), 'Set height')}
        />
      </div>

      <label className="flex items-center gap-1.5">
        <span className="w-4 shrink-0 text-[11px] text-ink-muted">R</span>
        <span className="relative flex-1">
          <input
            data-numeric
            data-testid="field-rotation"
            disabled={disabled}
            defaultValue={
              selected.length === 0
                ? '—'
                : String(
                    Math.round(((selected[0]?.rotation ?? 0) / RADIANS_PER_DEGREE) * 100) / 100,
                  )
            }
            key={selected.map((n) => `${n.id}:${n.rotation}`).join(',')}
            onBlur={(event) => {
              const degrees = Number.parseFloat(event.target.value);
              if (Number.isFinite(degrees)) {
                apply((node) => ({ ...node, rotation: degrees * RADIANS_PER_DEGREE }), 'Rotate');
              }
            }}
            className="h-6 w-full rounded-[2px] border border-border-control bg-panel-raised px-1.5 pr-6 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:bg-panel disabled:text-ink-disabled"
          />
          <span className="pointer-events-none absolute top-1 right-1.5 text-[11px] text-ink-subtle">
            °
          </span>
        </span>
      </label>
    </section>
  );
}
