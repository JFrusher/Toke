'use client';

import type { ImpositionLayout } from '@/engine/imposition/solve';
import type { SheetSpec } from '@/engine/imposition/specs';

/**
 * Scale drawing of one sheet: the grid as it will be cut.
 *
 * Drawn from the SAME layout the PDF renders from, so a cell that looks wrong
 * here is wrong on the press too. Empty cells are shown hatched rather than
 * hidden — knowing eight cards' worth of stock is wasted is how a run gets
 * resized before it is printed.
 */
export function SheetPreview({
  sheet,
  layout,
  filledCells,
}: {
  sheet: SheetSpec;
  layout: ImpositionLayout;
  filledCells: number;
}) {
  const label = `${layout.nUp}-up on ${sheet.label}, ${layout.columns} across by ${layout.rows} down`;

  return (
    <svg
      viewBox={`0 0 ${sheet.width} ${sheet.height}`}
      role="img"
      aria-label={label}
      data-testid="sheet-preview"
      className="h-auto w-full border border-hairline-strong bg-paper"
    >
      <title>{label}</title>

      {layout.cells.map((cell) => {
        const filled = cell.index < filledCells;
        return (
          <rect
            key={cell.index}
            x={cell.rect.x}
            y={cell.rect.y}
            width={cell.rect.width}
            height={cell.rect.height}
            fill={filled ? 'var(--accent-weak)' : 'transparent'}
            stroke="var(--border-control)"
            strokeWidth={0.75}
            {...(filled ? {} : { strokeDasharray: '4 3' })}
          />
        );
      })}
    </svg>
  );
}
