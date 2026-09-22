import { describe, expect, it } from 'vitest';
import { paginate } from '@/engine/imposition/paginate';

describe('paginate', () => {
  it('fills whole sheets when the count divides evenly', () => {
    const result = paginate(150, 10);
    expect(result.sheetCount).toBe(15);
    expect(result.sheets).toHaveLength(15);
    for (const sheet of result.sheets) {
      expect(sheet.recordIndices).toHaveLength(10);
      expect(sheet.emptyCellIndices).toHaveLength(0);
    }
  });

  it('reports the partial final sheet — 142 records at 10-up', () => {
    const result = paginate(142, 10);
    expect(result.sheetCount).toBe(15);

    const last = result.sheets[14];
    if (last === undefined) throw new Error('missing final sheet');
    expect(last.recordIndices).toEqual([140, 141]);
    expect(last.emptyCellIndices).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps record order stable and contiguous across sheets', () => {
    const result = paginate(142, 10);
    const flattened = result.sheets.flatMap((s) => s.recordIndices);
    expect(flattened).toHaveLength(142);
    expect(flattened[0]).toBe(0);
    expect(flattened[141]).toBe(141);
    for (let i = 1; i < flattened.length; i += 1) {
      expect(flattened[i]).toBe((flattened[i - 1] as number) + 1);
    }
  });

  it('assigns records to cells row-major within a sheet', () => {
    const result = paginate(12, 10);
    expect(result.sheets[0]?.recordIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.sheets[1]?.recordIndices).toEqual([10, 11]);
  });

  it('returns zero sheets for zero records, not one blank sheet', () => {
    const result = paginate(0, 10);
    expect(result.sheetCount).toBe(0);
    expect(result.sheets).toEqual([]);
  });

  it('puts a single record on one sheet with the rest empty', () => {
    const result = paginate(1, 10);
    expect(result.sheetCount).toBe(1);
    expect(result.sheets[0]?.recordIndices).toEqual([0]);
    expect(result.sheets[0]?.emptyCellIndices).toHaveLength(9);
  });

  it('handles 1-up', () => {
    const result = paginate(3, 1);
    expect(result.sheetCount).toBe(3);
    expect(result.sheets.map((s) => s.recordIndices)).toEqual([[0], [1], [2]]);
  });

  it('reports the total empty cells across the run', () => {
    expect(paginate(142, 10).totalEmptyCells).toBe(8);
    expect(paginate(150, 10).totalEmptyCells).toBe(0);
  });

  it('numbers sheets from 1 for display', () => {
    const result = paginate(25, 10);
    expect(result.sheets.map((s) => s.sheetNumber)).toEqual([1, 2, 3]);
  });

  it('throws on a non-positive nUp rather than looping forever', () => {
    // A zero-cell layout is impossible by construction (P1.3 errors first),
    // so reaching here is a programmer error, not user input.
    expect(() => paginate(10, 0)).toThrow();
  });

  it('rejects a negative record count', () => {
    expect(() => paginate(-1, 10)).toThrow();
  });
});
