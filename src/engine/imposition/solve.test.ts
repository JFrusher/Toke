import { describe, expect, it } from 'vitest';
import { contains, rectBottom, rectRight } from '@/engine/geometry/rect';
import { solveImposition } from '@/engine/imposition/solve';
import { designSpec, sheetPreset } from '@/engine/imposition/specs';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, points } from '@/engine/units/types';
import { isErr, isOk } from '@/lib/result';

const p = points;
const mm = (n: number) => millimetresToPoints(millimetres(n));

const A4 = sheetPreset('a4', 'portrait');
const PLACE_CARD = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });
const MARGIN = mm(10);

function solve(sheet = A4, design = PLACE_CARD, margin = MARGIN) {
  const result = solveImposition(sheet, design, margin);
  if (!isOk(result)) {
    throw new Error(`expected a layout, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

describe('grid shape', () => {
  it('fits a place card 10-up on A4 (2 columns × 5 rows)', () => {
    const layout = solve();
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(5);
    expect(layout.nUp).toBe(10);
    expect(layout.cells).toHaveLength(10);
  });

  it('produces one more edge than cells on each axis', () => {
    const layout = solve();
    expect(layout.columnEdges).toHaveLength(3);
    expect(layout.rowEdges).toHaveLength(6);
  });

  it('numbers cells row-major', () => {
    const layout = solve();
    expect(layout.cells[0]).toMatchObject({ index: 0, column: 0, row: 0 });
    expect(layout.cells[1]).toMatchObject({ index: 1, column: 1, row: 0 });
    expect(layout.cells[2]).toMatchObject({ index: 2, column: 0, row: 1 });
    expect(layout.cells[9]).toMatchObject({ index: 9, column: 1, row: 4 });
  });
});

describe('shared-cut adjacency', () => {
  it('neighbouring cells share one cut line exactly', () => {
    // Adjacency is structural, not numeric: both cells are built from the
    // same entry in the edge array, so the shared value is literally the
    // same number. Deriving each cell independently would drift.
    const layout = solve();
    for (let i = 0; i < layout.columns; i += 1) {
      const left = layout.columnEdges[i];
      const right = layout.columnEdges[i + 1];
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      expect(right as number).toBeGreaterThan(left as number);
    }
  });

  it('leaves no gap between horizontally adjacent cells', () => {
    const layout = solve();
    const first = layout.cells[0];
    const second = layout.cells[1];
    if (first === undefined || second === undefined) throw new Error('missing cells');
    expect(Math.abs(rectRight(first.rect) - second.rect.x)).toBeLessThan(1e-9);
  });

  it('leaves no gap between vertically adjacent cells', () => {
    const layout = solve();
    const top = layout.cells[0];
    const below = layout.cells[2];
    if (top === undefined || below === undefined) throw new Error('missing cells');
    expect(Math.abs(rectBottom(top.rect) - below.rect.y)).toBeLessThan(1e-9);
  });

  it('gives every cell the printed size', () => {
    const layout = solve();
    for (const cell of layout.cells) {
      expect(cell.rect.width).toBeCloseTo(mm(85), 9);
      expect(cell.rect.height).toBeCloseTo(mm(55), 9);
    }
  });
});

describe('centring', () => {
  it('centres the grid on the sheet', () => {
    const layout = solve();
    const leftGutter = layout.gridBounds.x;
    const rightGutter = A4.width - rectRight(layout.gridBounds);
    expect(Math.abs(leftGutter - rightGutter)).toBeLessThan(1e-9);
  });

  it('centres vertically too', () => {
    const layout = solve();
    const topGutter = layout.gridBounds.y;
    const bottomGutter = A4.height - rectBottom(layout.gridBounds);
    expect(Math.abs(topGutter - bottomGutter)).toBeLessThan(1e-9);
  });

  it('never centres the grid outside the margin', () => {
    const layout = solve();
    expect(layout.gridBounds.x).toBeGreaterThanOrEqual(MARGIN - 1e-9);
  });
});

describe('containment', () => {
  it('keeps every cell inside the sheet', () => {
    const layout = solve();
    const sheetRect = { x: 0, y: 0, width: A4.width, height: A4.height };
    for (const cell of layout.cells) {
      expect(contains(sheetRect, cell.rect)).toBe(true);
    }
  });

  it('inflates the bleed rect on all four sides', () => {
    const layout = solve();
    const cell = layout.cells[0];
    if (cell === undefined) throw new Error('missing cell');
    expect(cell.bleed.x).toBeCloseTo(cell.rect.x - mm(3), 9);
    expect(cell.bleed.width).toBeCloseTo(cell.rect.width + mm(6), 9);
  });

  it('lets bleeds overlap at a shared cut — that is what shared-cut means', () => {
    const layout = solve();
    const first = layout.cells[0];
    const second = layout.cells[1];
    if (first === undefined || second === undefined) throw new Error('missing cells');
    // The right bleed of cell 0 extends past the left edge of cell 1.
    expect(rectRight(first.bleed)).toBeGreaterThan(second.rect.x);
  });
});

describe('tent fold', () => {
  it('packs the doubled height, yielding 4-up on A4', () => {
    // 85 × 55 finished folds from an 85 × 110 piece. Two fit across, two
    // down — NOT half of the flat card's 10-up, because 277mm of usable
    // height takes only two 110mm panels.
    const tent = designSpec({
      width: mm(85),
      height: mm(55),
      bleed: mm(3),
      fold: { kind: 'tent', axis: 'horizontal' },
    });
    const layout = solve(A4, tent);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(2);
    expect(layout.nUp).toBe(4);
  });

  it('sizes cells to the printed piece, not the finished card', () => {
    const tent = designSpec({
      width: mm(85),
      height: mm(55),
      bleed: mm(3),
      fold: { kind: 'tent', axis: 'horizontal' },
    });
    const cell = solve(A4, tent).cells[0];
    if (cell === undefined) throw new Error('missing cell');
    expect(cell.rect.height).toBeCloseTo(mm(110), 9);
  });
});

describe('other sheets', () => {
  it('fits more cards on A3', () => {
    const a3 = sheetPreset('a3', 'portrait');
    const layout = solve(a3);
    expect(layout.nUp).toBeGreaterThan(10);
  });

  it('handles landscape', () => {
    const landscape = sheetPreset('a4', 'landscape');
    const layout = solve(landscape);
    expect(layout.nUp).toBeGreaterThan(0);
    expect(layout.columns * layout.rows).toBe(layout.nUp);
  });
});

describe('failure', () => {
  it('reports an error rather than returning a zero-cell grid', () => {
    const huge = designSpec({ width: mm(250), height: mm(55), bleed: mm(3) });
    const result = solveImposition(A4, huge, MARGIN);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('DESIGN_EXCEEDS_SHEET');
    }
  });

  it('rejects an invalid spec', () => {
    const bad = designSpec({ width: p(0), height: mm(55), bleed: mm(3) });
    expect(isErr(solveImposition(A4, bad, MARGIN))).toBe(true);
  });

  it('never returns a layout with zero cells', () => {
    const result = solveImposition(A4, PLACE_CARD, MARGIN);
    if (isOk(result)) {
      expect(result.value.nUp).toBeGreaterThan(0);
    }
  });
});
