import { compose, identity, type Matrix, rotate, translate } from '@/engine/geometry/matrix';
import { type Rect, rectCentre, rectRight } from '@/engine/geometry/rect';
import { MARK_LENGTH, MARK_STROKE_WIDTH, type Mark } from '@/engine/imposition/cropMarks';
import type { ImpositionCell, ImpositionLayout } from '@/engine/imposition/solve';
import type { DesignSpec, SheetSpec } from '@/engine/imposition/specs';
import { type Points, points } from '@/engine/units/types';

/**
 * Tent-fold geometry.
 *
 * A tent card prints at double height and folds across the middle. Folding
 * over the TOP edge brings the upper half down behind the lower half, so the
 * lower half is the panel the reader sees standing up — and the upper half
 * must be rotated a half turn to read the right way round once folded.
 */

export type PanelRole = 'front' | 'back';

export type FoldPanel = {
  readonly role: PanelRole;
  readonly rect: Rect;
  /** Radians. Pi for the back panel of a tent card. */
  readonly rotation: number;
  /** Rotation about the panel's own centre, ready to push onto the stack. */
  readonly transform: Matrix;
};

function halfTurnAbout(rect: Rect): Matrix {
  const centre = rectCentre(rect);
  return compose(
    translate(points(-centre.x), points(-centre.y)),
    rotate(Math.PI),
    translate(points(centre.x), points(centre.y)),
  );
}

export function foldPanels(cell: ImpositionCell, design: DesignSpec): readonly FoldPanel[] {
  if (design.fold?.kind !== 'tent') {
    return [{ role: 'front', rect: cell.rect, rotation: 0, transform: identity() }];
  }

  const panelHeight = cell.rect.height / 2;

  const back: Rect = {
    x: cell.rect.x,
    y: cell.rect.y,
    width: cell.rect.width,
    height: panelHeight,
  };

  const front: Rect = {
    x: cell.rect.x,
    y: cell.rect.y + panelHeight,
    width: cell.rect.width,
    height: panelHeight,
  };

  // Back first: it is the upper half, and emitting in sheet order keeps the
  // PDF content stream reading top-to-bottom.
  return [
    { role: 'back', rect: back, rotation: Math.PI, transform: halfTurnAbout(back) },
    { role: 'front', rect: front, rotation: 0, transform: identity() },
  ];
}

/**
 * Dashed marks on each row's fold line, projected into the side margins.
 * Dashed so a finisher cannot mistake a fold for a cut — an error that
 * destroys the whole sheet.
 */
export function foldMarks(
  layout: ImpositionLayout,
  sheet: SheetSpec,
  design: DesignSpec,
): readonly Mark[] {
  if (design.fold?.kind !== 'tent') {
    return [];
  }

  const bleed: Points = design.bleed;
  const gridLeft = layout.gridBounds.x;
  const gridRight = rectRight(layout.gridBounds);

  const leftGap = Math.max(0, Math.min(MARK_LENGTH, gridLeft - bleed));
  const rightGap = Math.max(0, Math.min(MARK_LENGTH, sheet.width - (gridRight + bleed)));

  const marks: Mark[] = [];

  for (let row = 0; row < layout.rows; row += 1) {
    const top = layout.rowEdges[row];
    const bottom = layout.rowEdges[row + 1];
    if (top === undefined || bottom === undefined) continue;

    const foldY = top + (bottom - top) / 2;

    if (leftGap > 0) {
      marks.push({
        axis: 'horizontal',
        kind: 'fold',
        from: { x: gridLeft - bleed - leftGap, y: foldY },
        to: { x: gridLeft - bleed, y: foldY },
        strokeWidth: MARK_STROKE_WIDTH,
        dashed: true,
      });
    }

    if (rightGap > 0) {
      marks.push({
        axis: 'horizontal',
        kind: 'fold',
        from: { x: gridRight + bleed, y: foldY },
        to: { x: gridRight + bleed + rightGap, y: foldY },
        strokeWidth: MARK_STROKE_WIDTH,
        dashed: true,
      });
    }
  }

  return marks;
}

/** Fold line within a cell, for on-canvas guides. */
export function foldLineY(cell: ImpositionCell, design: DesignSpec): number | null {
  if (design.fold?.kind !== 'tent') return null;
  return cell.rect.y + cell.rect.height / 2;
}
