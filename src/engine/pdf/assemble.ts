import type { PDFPage } from 'pdf-lib';
import { rgb } from 'pdf-lib';
import { cropMarks as buildCropMarks, type Mark } from '@/engine/imposition/cropMarks';
import { foldMarks } from '@/engine/imposition/fold';
import { paginate } from '@/engine/imposition/paginate';
import { solveImposition } from '@/engine/imposition/solve';
import type { DesignSpec, SheetSpec } from '@/engine/imposition/specs';
import { addSheetPage, createPdfDocument, finish, flipY } from '@/engine/pdf/document';
import { renderNodes } from '@/engine/pdf/render';
import type { SceneNode, TextNode } from '@/engine/scene/types';
import { getFont } from '@/engine/text/fontLoader';
import { renderTextNode } from '@/engine/tokens/render';
import type { Points } from '@/engine/units/types';
import { points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * Imposition maths (Phase 1) meeting the renderer (Phase 8).
 *
 * For each sheet, for each cell, the design is resolved against that cell's
 * record and drawn at the cell origin. Marks go on last, in the margins.
 */

export type ExportReport = {
  readonly bytes: Uint8Array;
  readonly sheetCount: number;
  readonly nUp: number;
  readonly recordsRendered: number;
  readonly emptyCells: number;
};

export type ExportInput = {
  readonly nodes: readonly SceneNode[];
  readonly rows: readonly Record<string, unknown>[];
  readonly sheet: SheetSpec;
  readonly design: DesignSpec;
  readonly margin: Points;
  readonly cropMarks: boolean;
  /** Asset bytes by content hash, resolved from the store before rendering. */
  readonly assets?: ReadonlyMap<string, Uint8Array>;
  /** Called with 0–1 after each sheet, so a long export can show progress. */
  readonly onProgress?: (fraction: number, sheet: number) => void;
  /**
   * Checked between sheets. Returning true abandons the export and leaves the
   * partial document unsaved — a half-written PDF is worse than none.
   */
  readonly shouldCancel?: () => boolean;
};

/**
 * Resolves every token in the design against one record.
 *
 * Returns an error rather than falling back to the template: printing
 * "{{ nope }}" across 150 cards is the worst possible outcome, and it is
 * cheaper to refuse than to reprint.
 */
function resolveForRecord(
  nodes: readonly SceneNode[],
  row: Record<string, unknown>,
): Result<readonly SceneNode[]> {
  const resolved: SceneNode[] = [];

  for (const node of nodes) {
    if (node.kind === 'group') {
      const children = resolveForRecord(node.children, row);
      if (isErr(children)) return children;
      resolved.push({ ...node, children: children.value });
      continue;
    }

    if (node.kind !== 'text') {
      resolved.push(node);
      continue;
    }

    const text = node as TextNode;
    const shown = renderTextNode({
      node: text,
      font: getFont(text.fontFamily, text.fontWeight, text.italic),
      mode: 'live',
      row,
    });

    if (shown.error !== null) return err(shown.error);

    // The RESOLVED text and the auto-fitted size, so the page carries exactly
    // what the editor previewed.
    resolved.push({ ...text, text: shown.text, fontSize: points(shown.fontSize) });
  }

  return ok(resolved);
}

function drawMarks(page: PDFPage, sheet: SheetSpec, marks: readonly Mark[]): void {
  for (const mark of marks) {
    page.drawLine({
      start: { x: mark.from.x, y: flipY(sheet, mark.from.y) },
      end: { x: mark.to.x, y: flipY(sheet, mark.to.y) },
      thickness: mark.strokeWidth,
      color: rgb(0, 0, 0),
      ...(mark.dashed === true ? { dashArray: [2, 2] } : {}),
    });
  }
}

export async function exportSheets(input: ExportInput): Promise<Result<ExportReport>> {
  // A pageless PDF is not "nothing": pdf-lib writes an empty page tree that
  // readers — including pdf-lib's own loader — resolve to one blank page. That
  // is a sheet of paper and a press setup, so refuse rather than emit it.
  if (input.rows.length === 0) {
    return err(
      appError('EXPORT_NO_RECORDS', 'The record source returned no rows.', {
        hint: 'Widen the record source query, or import data before exporting.',
      }),
    );
  }

  const layout = solveImposition(input.sheet, input.design, input.margin);
  if (isErr(layout)) return err(layout.error);

  const pagination = paginate(input.rows.length, layout.value.nUp);
  const context = await createPdfDocument();

  const marks = input.cropMarks
    ? [
        ...buildCropMarks(layout.value, input.sheet, input.design.bleed),
        ...foldMarks(layout.value, input.sheet, input.design),
      ]
    : [];

  for (const [sheetIndex, plan] of pagination.sheets.entries()) {
    const page = addSheetPage(context, input.sheet, {
      trim: {
        x: points(layout.value.gridBounds.x),
        y: points(layout.value.gridBounds.y),
        width: points(layout.value.gridBounds.width),
        height: points(layout.value.gridBounds.height),
        bleed: input.design.bleed,
      },
    });

    for (const [cellIndex, recordIndex] of plan.recordIndices.entries()) {
      const cell = layout.value.cells[cellIndex];
      const row = input.rows[recordIndex];
      if (cell === undefined || row === undefined) continue;

      const resolved = resolveForRecord(input.nodes, row);
      if (isErr(resolved)) return err(resolved.error);

      const drawn = await renderNodes({
        context,
        page,
        sheet: input.sheet,
        nodes: resolved.value,
        origin: { x: cell.rect.x, y: cell.rect.y },
        ...(input.assets === undefined ? {} : { assets: input.assets }),
      });
      if (isErr(drawn)) return err(drawn.error);
    }

    // Marks last, so they sit above artwork rather than under a card that
    // bleeds to the sheet edge.
    drawMarks(page, input.sheet, marks);
    input.onProgress?.((sheetIndex + 1) / pagination.sheetCount, sheetIndex + 1);

    if (input.shouldCancel?.() === true) {
      return err(appError('EXPORT_CANCELLED', 'The export was cancelled.'));
    }
  }

  const bytes = await finish(context);
  if (isErr(bytes)) return err(bytes.error);

  return ok({
    bytes: bytes.value,
    sheetCount: pagination.sheetCount,
    nUp: layout.value.nUp,
    recordsRendered: input.rows.length,
    emptyCells: pagination.totalEmptyCells,
  });
}

/**
 * One record at trim size, for checking on screen.
 *
 * No imposition, no marks: a proof is for reading, and cut marks on a
 * single-card page would only confuse.
 */
export async function exportProof(input: {
  nodes: readonly SceneNode[];
  row: Record<string, unknown>;
  design: DesignSpec;
  assets?: ReadonlyMap<string, Uint8Array>;
}): Promise<Result<Uint8Array>> {
  const sheet: SheetSpec = {
    id: 'custom',
    label: 'Proof',
    width: input.design.trim.width,
    height: input.design.trim.height,
  };

  const context = await createPdfDocument();
  const page = addSheetPage(context, sheet, { trim: null });

  const resolved = resolveForRecord(input.nodes, input.row);
  if (isErr(resolved)) return err(resolved.error);

  const drawn = await renderNodes({
    context,
    page,
    sheet,
    nodes: resolved.value,
    origin: { x: 0, y: 0 },
    ...(input.assets === undefined ? {} : { assets: input.assets }),
  });
  if (isErr(drawn)) return err(drawn.error);

  return finish(context);
}
