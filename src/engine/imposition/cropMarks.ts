import type { Point, Rect } from '@/engine/geometry/rect';
import { rectBottom, rectRight } from '@/engine/geometry/rect';
import type { ImpositionLayout } from '@/engine/imposition/solve';
import type { SheetSpec } from '@/engine/imposition/specs';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, type Points } from '@/engine/units/types';

/**
 * Crop and fold marks for a solved sheet.
 *
 * Under shared-cut imposition every interior cut line is shared by two cards,
 * so a mark drawn on it would print on both. Marks therefore live in the sheet
 * MARGIN only, projected outward from each cut line, offset from the grid by
 * the bleed distance so they never touch artwork.
 */

export type MarkAxis = 'vertical' | 'horizontal';
export type MarkKind = 'crop' | 'fold';

export type Mark = {
  readonly axis: MarkAxis;
  readonly kind: MarkKind;
  readonly from: Point;
  readonly to: Point;
  readonly strokeWidth: number;
  readonly dashed?: boolean;
};

/** Printers' convention: a hairline that survives imaging without bulking. */
export const MARK_STROKE_WIDTH = 0.25;

export const MARK_LENGTH: Points = millimetresToPoints(millimetres(5));

/** Zero-thickness bounding rect, for overlap checks. */
export function segmentBounds(mark: Mark): Rect {
  const x = Math.min(mark.from.x, mark.to.x);
  const y = Math.min(mark.from.y, mark.to.y);
  return {
    x,
    y,
    width: Math.abs(mark.to.x - mark.from.x),
    height: Math.abs(mark.to.y - mark.from.y),
  };
}

/**
 * Length available between the grid (plus its bleed) and the sheet edge.
 * Shortened rather than allowed to overflow, so a zero-margin sheet still
 * produces valid geometry instead of marks hanging off the page.
 */
function availableLength(gap: number): number {
  return Math.max(0, Math.min(MARK_LENGTH, gap));
}

export function cropMarks(
  layout: ImpositionLayout,
  sheet: SheetSpec,
  bleed: Points,
): readonly Mark[] {
  const marks: Mark[] = [];

  const gridTop = layout.gridBounds.y;
  const gridBottom = rectBottom(layout.gridBounds);
  const gridLeft = layout.gridBounds.x;
  const gridRight = rectRight(layout.gridBounds);

  const topGap = availableLength(gridTop - bleed);
  const bottomGap = availableLength(sheet.height - (gridBottom + bleed));
  const leftGap = availableLength(gridLeft - bleed);
  const rightGap = availableLength(sheet.width - (gridRight + bleed));

  // Vertical cut lines project up and down into the top and bottom margins.
  for (const x of layout.columnEdges) {
    if (topGap > 0) {
      marks.push({
        axis: 'vertical',
        kind: 'crop',
        from: { x, y: gridTop - bleed - topGap },
        to: { x, y: gridTop - bleed },
        strokeWidth: MARK_STROKE_WIDTH,
      });
    }
    if (bottomGap > 0) {
      marks.push({
        axis: 'vertical',
        kind: 'crop',
        from: { x, y: gridBottom + bleed },
        to: { x, y: gridBottom + bleed + bottomGap },
        strokeWidth: MARK_STROKE_WIDTH,
      });
    }
  }

  // Horizontal cut lines project left and right into the side margins.
  for (const y of layout.rowEdges) {
    if (leftGap > 0) {
      marks.push({
        axis: 'horizontal',
        kind: 'crop',
        from: { x: gridLeft - bleed - leftGap, y },
        to: { x: gridLeft - bleed, y },
        strokeWidth: MARK_STROKE_WIDTH,
      });
    }
    if (rightGap > 0) {
      marks.push({
        axis: 'horizontal',
        kind: 'crop',
        from: { x: gridRight + bleed, y },
        to: { x: gridRight + bleed + rightGap, y },
        strokeWidth: MARK_STROKE_WIDTH,
      });
    }
  }

  return marks;
}
