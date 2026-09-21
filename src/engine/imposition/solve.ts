import { inflate, type Rect } from '@/engine/geometry/rect';
import {
  type DesignSpec,
  printedSize,
  type SheetSpec,
  validateLayout,
} from '@/engine/imposition/specs';
import type { Points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * Shared-cut imposition.
 *
 * Cards butt together on a single cut line: neighbouring bleeds overlap at the
 * seam and only the outer edges of the grid keep a full bleed. This is
 * standard commercial practice and maximises sheet yield — 10-up for an
 * 85 × 55mm card on A4, against 8-up with individual gutters.
 */

export type ImpositionCell = {
  /** Row-major position on the sheet, 0-based. */
  readonly index: number;
  readonly column: number;
  readonly row: number;
  /** The printed piece: trim size, or double height for a tent fold. */
  readonly rect: Rect;
  /** `rect` grown by the bleed on all four sides. Overlaps neighbours. */
  readonly bleed: Rect;
};

export type ImpositionLayout = {
  readonly columns: number;
  readonly rows: number;
  readonly nUp: number;
  /**
   * Cut-line positions, length `columns + 1` and `rows + 1`.
   *
   * Cells are built from these rather than each computing its own origin, so
   * two neighbours share literally the same number for their common cut line.
   * Adjacency is structural; it does not depend on floating-point addition
   * happening to agree.
   */
  readonly columnEdges: readonly number[];
  readonly rowEdges: readonly number[];
  readonly gridBounds: Rect;
  readonly cells: readonly ImpositionCell[];
};

function edgeArray(origin: number, step: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => origin + i * step);
}

export function solveImposition(
  sheet: SheetSpec,
  design: DesignSpec,
  margin: Points,
): Result<ImpositionLayout> {
  const valid = validateLayout(sheet, design, margin);
  if (isErr(valid)) {
    return err(valid.error);
  }

  const printed = printedSize(design);
  const usableWidth = sheet.width - margin * 2;
  const usableHeight = sheet.height - margin * 2;

  const columns = Math.floor(usableWidth / printed.width);
  const rows = Math.floor(usableHeight / printed.height);

  // validateLayout has already established the design fits at least 1-up, so
  // reaching this means the two disagree. Fail loudly rather than returning a
  // zero-cell grid that would silently export blank sheets.
  if (columns < 1 || rows < 1) {
    return err(
      appError('DESIGN_EXCEEDS_SHEET', `Design does not fit: ${columns} columns × ${rows} rows.`, {
        hint: 'Use a larger sheet, reduce the margin, or reduce the trim size.',
      }),
    );
  }

  const gridWidth = columns * printed.width;
  const gridHeight = rows * printed.height;

  // Centre on the sheet, not within the margin box: the margin is a minimum,
  // and leftover slack is shared equally so crop marks sit symmetrically.
  const originX = (sheet.width - gridWidth) / 2;
  const originY = (sheet.height - gridHeight) / 2;

  const columnEdges = edgeArray(originX, printed.width, columns);
  const rowEdges = edgeArray(originY, printed.height, rows);

  const cells: ImpositionCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = columnEdges[column];
      const right = columnEdges[column + 1];
      const top = rowEdges[row];
      const bottom = rowEdges[row + 1];

      if (left === undefined || right === undefined || top === undefined || bottom === undefined) {
        continue;
      }

      const rect: Rect = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };

      cells.push({
        index: row * columns + column,
        column,
        row,
        rect,
        bleed: inflate(rect, design.bleed),
      });
    }
  }

  return ok({
    columns,
    rows,
    nUp: columns * rows,
    columnEdges,
    rowEdges,
    gridBounds: { x: originX, y: originY, width: gridWidth, height: gridHeight },
    cells,
  });
}
