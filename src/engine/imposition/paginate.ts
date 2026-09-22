/**
 * Distribute a record run across sheets at a given N-up.
 *
 * Record order is the record-source query's order and must stay contiguous:
 * place cards are usually sorted so they can be handed out or laid down in
 * sequence, and shuffling them across sheets would defeat that.
 */

export type SheetPlan = {
  /** 1-based, for display. */
  readonly sheetNumber: number;
  /** Record indices in cell order, row-major. */
  readonly recordIndices: readonly number[];
  /** Cells on this sheet with no record — only ever on the final sheet. */
  readonly emptyCellIndices: readonly number[];
};

export type Pagination = {
  readonly sheetCount: number;
  readonly totalEmptyCells: number;
  readonly sheets: readonly SheetPlan[];
};

export function paginate(recordCount: number, nUp: number): Pagination {
  // Programmer error, not user input: P1.3 refuses to produce a zero-cell
  // layout, and a negative count cannot come from a query result.
  if (!Number.isInteger(nUp) || nUp < 1) {
    throw new Error(`nUp must be a positive integer, got ${nUp}`);
  }
  if (!Number.isInteger(recordCount) || recordCount < 0) {
    throw new Error(`recordCount must be a non-negative integer, got ${recordCount}`);
  }

  // Zero records means zero sheets. Emitting one blank sheet would send an
  // empty page to the printer.
  if (recordCount === 0) {
    return { sheetCount: 0, totalEmptyCells: 0, sheets: [] };
  }

  const sheetCount = Math.ceil(recordCount / nUp);
  const sheets: SheetPlan[] = [];

  for (let sheet = 0; sheet < sheetCount; sheet += 1) {
    const start = sheet * nUp;
    const end = Math.min(start + nUp, recordCount);

    const recordIndices: number[] = [];
    for (let i = start; i < end; i += 1) {
      recordIndices.push(i);
    }

    const emptyCellIndices: number[] = [];
    for (let cell = recordIndices.length; cell < nUp; cell += 1) {
      emptyCellIndices.push(cell);
    }

    sheets.push({ sheetNumber: sheet + 1, recordIndices, emptyCellIndices });
  }

  return {
    sheetCount,
    totalEmptyCells: sheetCount * nUp - recordCount,
    sheets,
  };
}
