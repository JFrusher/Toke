import { describe, expect, it } from 'vitest';
import { intersects } from '@/engine/geometry/rect';
import { cropMarks, segmentBounds } from '@/engine/imposition/cropMarks';
import { solveImposition } from '@/engine/imposition/solve';
import { designSpec, sheetPreset } from '@/engine/imposition/specs';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres } from '@/engine/units/types';
import { isOk } from '@/lib/result';

const mm = (n: number) => millimetresToPoints(millimetres(n));
const A4 = sheetPreset('a4', 'portrait');
const PLACE_CARD = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });

function layout() {
  const result = solveImposition(A4, PLACE_CARD, mm(10));
  if (!isOk(result)) throw new Error('expected a layout');
  return result.value;
}

describe('cropMarks', () => {
  it('emits two segments per cut line on both axes', () => {
    // 2x5 grid -> 3 vertical cut lines and 6 horizontal ones.
    // Each projects into the margin at both ends: (3 + 6) * 2 = 18.
    const marks = cropMarks(layout(), A4, PLACE_CARD.bleed);
    expect(marks).toHaveLength(18);
  });

  it('places marks in the sheet margin only, never between cards', () => {
    // The defining property of shared-cut imposition. A mark drawn between two
    // cards would print on the artwork of both.
    const l = layout();
    const marks = cropMarks(l, A4, PLACE_CARD.bleed);

    for (const mark of marks) {
      for (const cell of l.cells) {
        expect(intersects(segmentBounds(mark), cell.bleed)).toBe(false);
      }
    }
  });

  it('keeps every segment inside the sheet', () => {
    const marks = cropMarks(layout(), A4, PLACE_CARD.bleed);
    for (const mark of marks) {
      for (const point of [mark.from, mark.to]) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(A4.width);
        expect(point.y).toBeLessThanOrEqual(A4.height);
      }
    }
  });

  it('offsets each mark from the trim by the bleed distance', () => {
    const l = layout();
    const marks = cropMarks(l, A4, PLACE_CARD.bleed);
    const topMarks = marks.filter((m) => m.axis === 'vertical' && m.to.y <= l.gridBounds.y);

    expect(topMarks.length).toBeGreaterThan(0);
    for (const mark of topMarks) {
      expect(mark.to.y).toBeCloseTo(l.gridBounds.y - PLACE_CARD.bleed, 9);
    }
  });

  it('aligns vertical marks with the column cut lines', () => {
    const l = layout();
    const marks = cropMarks(l, A4, PLACE_CARD.bleed);
    const verticalXs = [
      ...new Set(marks.filter((m) => m.axis === 'vertical').map((m) => m.from.x)),
    ];

    expect(verticalXs.sort((a, b) => a - b)).toEqual([...l.columnEdges].sort((a, b) => a - b));
  });

  it('aligns horizontal marks with the row cut lines', () => {
    const l = layout();
    const marks = cropMarks(l, A4, PLACE_CARD.bleed);
    const horizontalYs = [
      ...new Set(marks.filter((m) => m.axis === 'horizontal').map((m) => m.from.y)),
    ];

    expect(horizontalYs.sort((a, b) => a - b)).toEqual([...l.rowEdges].sort((a, b) => a - b));
  });

  it('uses a 0.25pt hairline stroke', () => {
    for (const mark of cropMarks(layout(), A4, PLACE_CARD.bleed)) {
      expect(mark.strokeWidth).toBe(0.25);
    }
  });

  it('draws marks 5mm long unless the margin is too tight', () => {
    const marks = cropMarks(layout(), A4, PLACE_CARD.bleed);
    const vertical = marks.find((m) => m.axis === 'vertical');
    if (vertical === undefined) throw new Error('expected a vertical mark');
    expect(Math.abs(vertical.to.y - vertical.from.y)).toBeCloseTo(mm(5), 6);
  });

  it('shortens rather than overflowing when the margin cannot fit a full mark', () => {
    const tight = solveImposition(A4, PLACE_CARD, millimetresToPoints(millimetres(0)));
    if (!isOk(tight)) throw new Error('expected a layout');
    const marks = cropMarks(tight.value, A4, PLACE_CARD.bleed);

    for (const mark of marks) {
      for (const point of [mark.from, mark.to]) {
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
        expect(point.y).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});

describe('segmentBounds', () => {
  it('produces a zero-thickness rect for a vertical segment', () => {
    const bounds = segmentBounds({
      axis: 'vertical',
      from: { x: 10, y: 5 },
      to: { x: 10, y: 25 },
      strokeWidth: 0.25,
      kind: 'crop',
    });
    expect(bounds).toEqual({ x: 10, y: 5, width: 0, height: 20 });
  });
});
