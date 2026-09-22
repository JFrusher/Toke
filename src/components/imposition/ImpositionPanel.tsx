'use client';

import { useMemo } from 'react';
import { SheetPreview } from '@/components/imposition/SheetPreview';
import { paginate } from '@/engine/imposition/paginate';
import { solveImposition } from '@/engine/imposition/solve';
import { designSpec, SHEET_PRESETS, sheetPreset } from '@/engine/imposition/specs';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { useImpositionStore } from '@/engine/store/useImpositionStore';
import { useShellStore } from '@/engine/store/useShellStore';
import { formatNumber } from '@/engine/units/format';
import { parseLength } from '@/engine/units/parse';
import type { DisplayUnit, Points } from '@/engine/units/types';
import { points } from '@/engine/units/types';
import { isErr, isOk } from '@/lib/result';

/**
 * Sheet setup and the yield it produces.
 *
 * Every number shown is read off the solver rather than recomputed here, so
 * the panel cannot claim a yield the export will not deliver.
 */
export function ImpositionPanel() {
  const artboard = useCanvasStore((s) => s.artboard);
  const recordCount = useDataStore((s) => s.records.length);
  const unit = useShellStore((s) => s.displayUnit);

  const preset = useImpositionStore((s) => s.preset);
  const orientation = useImpositionStore((s) => s.orientation);
  const margin = useImpositionStore((s) => s.margin);
  const bleed = useImpositionStore((s) => s.bleed);
  const cropMarks = useImpositionStore((s) => s.cropMarks);
  const setPreset = useImpositionStore((s) => s.setPreset);
  const setOrientation = useImpositionStore((s) => s.setOrientation);
  const setMargin = useImpositionStore((s) => s.setMargin);
  const setBleed = useImpositionStore((s) => s.setBleed);
  const setCropMarks = useImpositionStore((s) => s.setCropMarks);

  const sheet = useMemo(() => sheetPreset(preset, orientation), [preset, orientation]);
  const design = useMemo(
    () => designSpec({ width: points(artboard.width), height: points(artboard.height), bleed }),
    [artboard.width, artboard.height, bleed],
  );
  const layout = useMemo(() => solveImposition(sheet, design, margin), [sheet, design, margin]);

  const nUp = isOk(layout) ? layout.value.nUp : 0;
  const pagination = paginate(recordCount, Math.max(nUp, 1));

  return (
    <div className="flex flex-col gap-3 p-3">
      <h2 className="font-medium text-[11px] text-ink-muted">Imposition</h2>

      <label className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-[11px] text-ink-muted">Sheet</span>
        <select
          value={preset}
          onChange={(event) => setPreset(event.target.value as typeof preset)}
          className="h-7 flex-1 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        >
          {SHEET_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">Sheet orientation</legend>
        <span className="w-14 shrink-0 text-[11px] text-ink-muted">Rotation</span>
        {(['portrait', 'landscape'] as const).map((option) => (
          <label key={option} className="flex items-center gap-1 text-[13px] text-ink">
            <input
              type="radio"
              name="orientation"
              checked={orientation === option}
              onChange={() => setOrientation(option)}
              className="accent-accent"
            />
            {option}
          </label>
        ))}
      </fieldset>

      <LengthField label="Margin" value={margin} unit={unit} onCommit={setMargin} />
      <LengthField label="Bleed" value={bleed} unit={unit} onCommit={setBleed} />

      <label className="flex items-center gap-1.5 text-[13px] text-ink">
        <input
          type="checkbox"
          checked={cropMarks}
          onChange={(event) => setCropMarks(event.target.checked)}
          className="accent-accent"
        />
        Crop marks
      </label>

      {isErr(layout) ? (
        // Colour alone never carries state (CLAUDE.md §4.7): the reason is
        // spelled out, and the hint names the fix.
        <p data-testid="imposition-error" className="text-[11px] text-overflow">
          {layout.error.message}
          {layout.error.hint === undefined ? '' : ` ${layout.error.hint}`}
        </p>
      ) : (
        <>
          <SheetPreview
            sheet={sheet}
            layout={layout.value}
            filledCells={Math.min(recordCount, layout.value.nUp)}
          />

          <dl data-testid="imposition-yield" className="grid grid-cols-2 gap-x-2 gap-y-1">
            <Stat label="Up" value={String(layout.value.nUp)} />
            <Stat label="Grid" value={`${layout.value.columns} x ${layout.value.rows}`} />
            <Stat label="Records" value={String(recordCount)} />
            <Stat label="Sheets" value={String(pagination.sheetCount)} />
            <Stat label="Waste" value={`${pagination.totalEmptyCells} cells`} />
            <Stat
              label="Trim"
              value={`${formatNumber(points(artboard.width), unit)} x ${formatNumber(points(artboard.height), unit)}`}
            />
          </dl>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd data-numeric className="text-[11px] text-ink">
        {value}
      </dd>
    </>
  );
}

/** Millimetre entry that commits on blur, converting to Points at the edge. */
function LengthField({
  label,
  value,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  unit: DisplayUnit;
  onCommit: (next: Points) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[11px] text-ink-muted">{label}</span>
      <input
        data-numeric
        data-testid={`imposition-${label.toLowerCase()}`}
        // Keyed on the unit so switching mm to inches re-renders the field
        // with the converted value rather than leaving the old number in place.
        key={unit}
        defaultValue={formatNumber(points(value), unit)}
        onBlur={(event) => {
          const parsed = parseLength(event.target.value, unit);
          if (isOk(parsed)) onCommit(parsed.value);
        }}
        className="h-7 w-20 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
      />
      <span className="text-[11px] text-ink-muted uppercase">{unit}</span>
    </label>
  );
}
