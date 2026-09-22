import { describe, expect, it } from 'vitest';
import { applyToPoint } from '@/engine/geometry/matrix';
import { rectBottom, rectCentre, rectRight } from '@/engine/geometry/rect';
import { foldMarks, foldPanels } from '@/engine/imposition/fold';
import { solveImposition } from '@/engine/imposition/solve';
import { designSpec, sheetPreset } from '@/engine/imposition/specs';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres } from '@/engine/units/types';
import { isOk } from '@/lib/result';

const mm = (n: number) => millimetresToPoints(millimetres(n));
const A4 = sheetPreset('a4', 'portrait');

const TENT = designSpec({
  width: mm(85),
  height: mm(55),
  bleed: mm(3),
  fold: { kind: 'tent', axis: 'horizontal' },
});
const FLAT = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });

function tentLayout() {
  const result = solveImposition(A4, TENT, mm(10));
  if (!isOk(result)) throw new Error('expected a layout');
  return result.value;
}

describe('foldPanels', () => {
  it('returns a single panel for a flat design', () => {
    const result = solveImposition(A4, FLAT, mm(10));
    if (!isOk(result)) throw new Error('expected a layout');
    const cell = result.value.cells[0];
    if (cell === undefined) throw new Error('missing cell');

    const panels = foldPanels(cell, FLAT);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.role).toBe('front');
    expect(panels[0]?.rotation).toBe(0);
  });

  it('splits a tent cell into front and back halves', () => {
    const cell = tentLayout().cells[0];
    if (cell === undefined) throw new Error('missing cell');

    const panels = foldPanels(cell, TENT);
    expect(panels).toHaveLength(2);
    expect(panels.map((p) => p.role)).toEqual(['back', 'front']);
  });

  it('gives each panel the finished trim height', () => {
    const cell = tentLayout().cells[0];
    if (cell === undefined) throw new Error('missing cell');

    for (const panel of foldPanels(cell, TENT)) {
      expect(panel.rect.height).toBeCloseTo(mm(55), 9);
      expect(panel.rect.width).toBeCloseTo(mm(85), 9);
    }
  });

  it('stacks the panels with no gap, filling the cell exactly', () => {
    const cell = tentLayout().cells[0];
    if (cell === undefined) throw new Error('missing cell');

    const [back, front] = foldPanels(cell, TENT);
    if (back === undefined || front === undefined) throw new Error('missing panels');

    expect(back.rect.y).toBeCloseTo(cell.rect.y, 9);
    expect(rectBottom(back.rect)).toBeCloseTo(front.rect.y, 9);
    expect(rectBottom(front.rect)).toBeCloseTo(rectBottom(cell.rect), 9);
  });

  it('puts the front panel at the bottom, upright', () => {
    // Folding over the top edge brings the upper half down behind the lower
    // half, so the lower half is what the reader sees standing up.
    const cell = tentLayout().cells[0];
    if (cell === undefined) throw new Error('missing cell');

    const front = foldPanels(cell, TENT).find((p) => p.role === 'front');
    if (front === undefined) throw new Error('missing front panel');

    expect(front.rotation).toBe(0);
    expect(front.rect.y).toBeGreaterThan(cell.rect.y);
  });

  it('rotates the back panel a half turn about its own centre', () => {
    const cell = tentLayout().cells[0];
    if (cell === undefined) throw new Error('missing cell');

    const back = foldPanels(cell, TENT).find((p) => p.role === 'back');
    if (back === undefined) throw new Error('missing back panel');

    expect(back.rotation).toBeCloseTo(Math.PI, 12);

    // The transform must map the panel onto itself: a half turn about the
    // centre sends each corner to the opposite corner.
    const centre = rectCentre(back.rect);
    const topLeft = applyToPoint(back.transform, { x: back.rect.x, y: back.rect.y });
    expect(topLeft.x).toBeCloseTo(rectRight(back.rect), 9);
    expect(topLeft.y).toBeCloseTo(rectBottom(back.rect), 9);
    expect(applyToPoint(back.transform, centre).x).toBeCloseTo(centre.x, 9);
    expect(applyToPoint(back.transform, centre).y).toBeCloseTo(centre.y, 9);
  });
});

describe('foldMarks', () => {
  it('emits no marks for a flat design', () => {
    const result = solveImposition(A4, FLAT, mm(10));
    if (!isOk(result)) throw new Error('expected a layout');
    expect(foldMarks(result.value, A4, FLAT)).toHaveLength(0);
  });

  it('emits two marks per row of a tent layout, one into each margin', () => {
    const l = tentLayout();
    expect(foldMarks(l, A4, TENT)).toHaveLength(l.rows * 2);
  });

  it('places fold marks on the horizontal centre line of each cell', () => {
    const l = tentLayout();
    const marks = foldMarks(l, A4, TENT);
    const cell = l.cells[0];
    if (cell === undefined) throw new Error('missing cell');

    const expectedY = cell.rect.y + cell.rect.height / 2;
    expect(marks.some((m) => Math.abs(m.from.y - expectedY) < 1e-9)).toBe(true);
  });

  it('marks the fold as dashed so it is not mistaken for a cut', () => {
    for (const mark of foldMarks(tentLayout(), A4, TENT)) {
      expect(mark.kind).toBe('fold');
      expect(mark.dashed).toBe(true);
    }
  });

  it('keeps fold marks in the margin, clear of the artwork', () => {
    const l = tentLayout();
    for (const mark of foldMarks(l, A4, TENT)) {
      const insideGrid = mark.from.x > l.gridBounds.x && mark.from.x < rectRight(l.gridBounds);
      expect(insideGrid).toBe(false);
    }
  });
});
