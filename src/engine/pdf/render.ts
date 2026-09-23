import {
  clip,
  closePath,
  degrees,
  endPath,
  lineTo,
  moveTo,
  type PDFFont,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import type { SheetSpec } from '@/engine/imposition/specs';
import { embedFont, embedImage, flipY, type PdfContext } from '@/engine/pdf/document';
import { croppedAspect, fitBox, needsClip } from '@/engine/scene/image';
import type { Fill, SceneNode, Stroke, TextNode } from '@/engine/scene/types';
import { assertNever } from '@/engine/scene/types';
import { fontKey, getFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { appError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * SceneNode → pdf-lib draw calls.
 *
 * pdf-lib cannot import SVG or canvas output (CLAUDE.md §9), so this is the
 * hand-written renderer that makes the supported feature set of the canvas a
 * hard product constraint.
 *
 * TEXT is the part that has to be exactly right. Positions come from
 * engine/text/measure.ts — the same function canvas auto-fit uses — so a line
 * the editor says fits is placed from the same numbers here. Measuring
 * independently on this side is how a preview and a print diverge.
 */

export type RenderInput = {
  readonly context: PdfContext;
  readonly page: PDFPage;
  readonly sheet: SheetSpec;
  readonly nodes: readonly SceneNode[];
  /** Cell origin on the sheet, top-down. This is what places card 7 in cell 7. */
  readonly origin: { readonly x: number; readonly y: number };
  /**
   * Asset bytes keyed by content hash.
   *
   * The caller resolves these from the asset store BEFORE rendering: the PDF
   * worker gets plain bytes, never an IndexedDB handle.
   */
  readonly assets?: ReadonlyMap<string, Uint8Array>;
};

function parseColour(hex: string) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;

  return rgb(
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
  );
}

function fillOptions(fill: Fill) {
  return fill.kind === 'none' ? {} : { color: parseColour(fill.color) };
}

function strokeOptions(stroke: Stroke) {
  if (stroke.kind === 'none') return {};
  return {
    borderColor: parseColour(stroke.color),
    borderWidth: stroke.width,
    ...(stroke.dash === undefined ? {} : { borderDashArray: [...stroke.dash] }),
  };
}

function isPainted(fill: Fill, stroke: Stroke): boolean {
  return fill.kind !== 'none' || stroke.kind !== 'none';
}

const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * Rotation options for a pdf-lib draw call.
 *
 * The engine stores radians and rotates about the object's CENTRE; pdf-lib
 * takes degrees and rotates about the draw origin. Passing the angle through
 * without moving the pivot swings the object away from where the editor drew
 * it, by more the further it sits from its own corner.
 */
function rotationOptions(node: SceneNode) {
  if (node.rotation === 0) return {};
  return {
    rotate: degrees(-node.rotation * DEGREES_PER_RADIAN),
    // Pivot at the centre, expressed relative to the draw origin.
    pivotX: node.width / 2,
    pivotY: node.height / 2,
  } as const;
}

/** Ellipse drawn with pdf-lib's own primitive, which emits bezier curves. */
function drawEllipse(
  page: PDFPage,
  node: Extract<SceneNode, { kind: 'ellipse' }>,
  x: number,
  y: number,
) {
  page.drawEllipse({
    x: x + node.width / 2,
    y: y - node.height / 2,
    xScale: node.width / 2,
    yScale: node.height / 2,
    ...fillOptions(node.fill),
    ...strokeOptions(node.stroke),
    opacity: node.opacity,
  });
}

function drawText(
  page: PDFPage,
  node: TextNode,
  embedded: PDFFont,
  absoluteX: number,
  topY: number,
  sheet: SheetSpec,
): void {
  const font = getFont(node.fontFamily, node.fontWeight, node.italic);
  if (font === null) return;

  const measured = measureText({
    text: node.text,
    font,
    fontSize: node.fontSize,
    tracking: node.tracking,
    lineHeight: node.lineHeight,
  });

  measured.lines.forEach((line, index) => {
    if (line.text === '') return;

    // Horizontal alignment uses the MEASURED width, not pdf-lib's own
    // widthOfTextAtSize. Two measurement sources would drift, and a centred
    // name half a point off centre is visible on a place card.
    const offset =
      node.align === 'center'
        ? (node.width - line.width) / 2
        : node.align === 'right'
          ? node.width - line.width
          : 0;

    // The baseline sits `ascent` below the top of the box, then one line
    // height per subsequent line.
    const baselineTop = topY + measured.ascent + index * measured.lineHeight;

    page.drawText(line.text, {
      x: absoluteX + offset,
      y: flipY(sheet, baselineTop),
      size: node.fontSize,
      font: embedded,
      ...fillOptions(node.fill),
      opacity: node.opacity,
      ...(node.rotation === 0 ? {} : { rotate: degrees(-node.rotation * (180 / Math.PI)) }),
    });
  });
}

async function renderNode(input: RenderInput, node: SceneNode): Promise<Result<true>> {
  // Nothing invisible reaches the page; a hidden object still costs bytes and
  // some RIPs render zero-opacity fills as visible.
  if (!node.visible) return ok(true);

  const { page, sheet, origin } = input;
  const absoluteX = origin.x + node.x;
  const topY = origin.y + node.y;
  // pdf-lib measures rectangles from their BOTTOM-left corner.
  const bottomY = flipY(sheet, topY + node.height);

  switch (node.kind) {
    case 'rect': {
      if (node.width <= 0 || node.height <= 0) return ok(true);
      if (!isPainted(node.fill, node.stroke)) return ok(true);

      page.drawRectangle({
        x: absoluteX,
        y: bottomY,
        width: node.width,
        height: node.height,
        opacity: node.opacity,
        ...fillOptions(node.fill),
        ...strokeOptions(node.stroke),
        ...rotationOptions(node),
      });
      return ok(true);
    }

    case 'ellipse': {
      if (node.width <= 0 || node.height <= 0) return ok(true);
      if (!isPainted(node.fill, node.stroke)) return ok(true);
      drawEllipse(page, node, absoluteX, flipY(sheet, topY));
      return ok(true);
    }

    case 'line': {
      if (node.stroke.kind === 'none') return ok(true);
      page.drawLine({
        start: { x: absoluteX, y: flipY(sheet, topY) },
        end: { x: absoluteX + node.width, y: flipY(sheet, topY + node.height) },
        color: parseColour(node.stroke.color),
        thickness: node.stroke.width,
        opacity: node.opacity,
        ...(node.stroke.dash === undefined ? {} : { dashArray: [...node.stroke.dash] }),
      });
      return ok(true);
    }

    case 'path': {
      if (node.d === '') return ok(true);
      page.drawSvgPath(node.d, {
        x: absoluteX,
        y: flipY(sheet, topY),
        ...fillOptions(node.fill),
        ...(node.stroke.kind === 'none'
          ? {}
          : { borderColor: parseColour(node.stroke.color), borderWidth: node.stroke.width }),
        opacity: node.opacity,
      });
      return ok(true);
    }

    case 'text': {
      if (node.text === '') return ok(true);

      const font = getFont(node.fontFamily, node.fontWeight, node.italic);
      if (font === null) {
        return err(
          appError('PDF_FONT_MISSING', `No font loaded for "${node.fontFamily}".`, {
            objectId: node.id,
            hint: 'Load the face before exporting, or the PDF would silently substitute one.',
          }),
        );
      }

      const embedded = await embedFont(
        input.context,
        fontKey(node.fontFamily, node.fontWeight, node.italic),
        font,
      );
      if (isErr(embedded)) return err(embedded.error);

      drawText(page, node, embedded.value, absoluteX, topY, sheet);
      return ok(true);
    }

    case 'image': {
      if (node.width <= 0 || node.height <= 0) return ok(true);

      const bytes = input.assets?.get(node.assetId);
      if (bytes === undefined) {
        // Silently dropping the image would export a card with a hole in it
        // that nobody notices until the proof comes back from the press.
        return err(
          appError('PDF_ASSET_MISSING', `No bytes for asset "${node.assetId}".`, {
            objectId: node.id,
            hint: 'Resolve every referenced asset from the store before exporting.',
          }),
        );
      }

      const embedded = await embedImage(input.context, node.assetId, bytes);
      if (isErr(embedded)) return err(embedded.error);

      // The CROPPED aspect, not the file's: fitting the whole image and then
      // cropping would letterbox the wrong axis.
      const aspect = croppedAspect(
        { width: embedded.value.width, height: embedded.value.height },
        node.crop,
      );
      const placed = fitBox(node, aspect);

      // A crop is drawn by scaling the whole image up so the wanted region
      // fills the placed box, then clipping. pdf-lib has no source-rectangle
      // argument, so this is the only way to express it.
      const scale = { x: 1 / node.crop.width, y: 1 / node.crop.height };
      const drawn = {
        x: placed.x - node.crop.x * placed.width * scale.x,
        y: placed.y - node.crop.y * placed.height * scale.y,
        width: placed.width * scale.x,
        height: placed.height * scale.y,
      };

      const cropped = node.crop.width < 1 || node.crop.height < 1;
      const clipped = cropped || needsClip(node.fit, node, aspect);

      // A cover image overflows its frame by design; without a clip path it
      // prints over whatever sits beside it, which on an imposed sheet is the
      // neighbouring card.
      if (clipped) {
        page.pushOperators(
          pushGraphicsState(),
          moveTo(absoluteX, flipY(sheet, topY + node.height)),
          lineTo(absoluteX + node.width, flipY(sheet, topY + node.height)),
          lineTo(absoluteX + node.width, flipY(sheet, topY)),
          lineTo(absoluteX, flipY(sheet, topY)),
          closePath(),
          clip(),
          endPath(),
        );
      }

      page.drawImage(embedded.value.image, {
        x: absoluteX + drawn.x,
        y: flipY(sheet, topY + drawn.y + drawn.height),
        width: drawn.width,
        height: drawn.height,
        opacity: node.opacity,
        ...rotationOptions(node),
      });

      if (clipped) page.pushOperators(popGraphicsState());
      return ok(true);
    }

    case 'group': {
      // Children hold ABSOLUTE coordinates by design (engine/canvas/arrange),
      // so a group needs no transform stack — just render its children at the
      // same origin.
      for (const child of node.children) {
        const result = await renderNode(input, child);
        if (isErr(result)) return result;
      }
      return ok(true);
    }

    default:
      return assertNever(node, 'scene node kind');
  }
}

export async function renderNodes(input: RenderInput): Promise<Result<true>> {
  // Array order is paint order, bottom to top — the same convention as a PDF
  // content stream, so nothing needs reversing.
  for (const node of input.nodes) {
    const result = await renderNode(input, node);
    if (isErr(result)) return result;
  }
  return ok(true);
}
