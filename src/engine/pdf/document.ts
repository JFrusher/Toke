import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SheetSpec } from '@/engine/imposition/specs';
import type { LoadedFont } from '@/engine/text/fontLoader';
import type { Points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * PDF document setup: pages, boxes and embedded fonts.
 *
 * pdf-lib is used as a low-level writer, not a renderer (CLAUDE.md §9). It
 * cannot import SVG or canvas output, so every SceneNode is translated into
 * explicit draw calls by the renderers in this directory.
 *
 * COORDINATES: the engine works top-down from the artboard origin; PDF works
 * bottom-up from the page origin. Every y is flipped exactly once, here at the
 * boundary. Flipping in two places, or none, mirrors the page — which looks
 * plausible on a symmetrical layout and wrong on everything else.
 */

export type PdfContext = {
  readonly doc: PDFDocument;
  readonly pages: PDFPage[];
  /** Embedded faces, keyed as `family|weight|italic`. One subset per face. */
  readonly fonts: Map<string, PDFFont>;
};

export type TrimSpec = {
  /** Distance from the artboard origin, top-down. */
  readonly x: Points;
  readonly y: Points;
  readonly width: Points;
  readonly height: Points;
  readonly bleed: Points;
};

export async function createPdfDocument(): Promise<PdfContext> {
  const doc = await PDFDocument.create();
  // Required before embedding any custom font; pdf-lib ships no subsetter.
  doc.registerFontkit(fontkit);
  // Creator, not Producer: pdf-lib overwrites Producer with its own string
  // when serialising, and updateMetadata:false does not prevent it. Creator
  // survives and carries the same information for a shop debugging a file.
  doc.setCreator('toke');

  return { doc, pages: [], fonts: new Map() };
}

/** Converts an engine y (top-down) into a PDF y (bottom-up). */
export function flipY(sheet: SheetSpec, y: number, height = 0): number {
  return sheet.height - y - height;
}

export function addSheetPage(
  context: PdfContext,
  sheet: SheetSpec,
  options: { trim: TrimSpec | null },
): PDFPage {
  const page = context.doc.addPage([sheet.width, sheet.height]);

  if (options.trim !== null) {
    const { x, y, width, height, bleed } = options.trim;
    const bottom = flipY(sheet, y, height);

    // A print shop reads TrimBox to know where to cut and BleedBox to know how
    // much artwork to expect beyond it. Omitting them makes the shop guess.
    page.setTrimBox(x, bottom, width, height);
    page.setBleedBox(x - bleed, bottom - bleed, width + bleed * 2, height + bleed * 2);
  }

  context.pages.push(page);
  return page;
}

/**
 * Embeds a face once per document and caches it.
 *
 * `subset: true` keeps only the glyphs actually drawn. A full Plex face is
 * ~218KB; a 150-card run using forty distinct letters has no business
 * carrying all of it, three times over.
 */
export async function embedFont(
  context: PdfContext,
  key: string,
  font: LoadedFont,
): Promise<Result<PDFFont>> {
  const cached = context.fonts.get(key);
  if (cached !== undefined) return ok(cached);

  try {
    const embedded = await context.doc.embedFont(font.bytes, { subset: true });
    context.fonts.set(key, embedded);
    return ok(embedded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(
      appError('PDF_FONT_EMBED_FAILED', `Could not embed "${font.family}": ${message}`, {
        hint: 'The font may be a format PDF cannot carry, such as WOFF.',
      }),
    );
  }
}

export async function finish(context: PdfContext): Promise<Result<Uint8Array>> {
  try {
    // No save options: pdf-lib 1.17.1 has no updateMetadata flag, and writes
    // its own Producer regardless. This is why the golden suite asserts on
    // extracted geometry rather than on bytes — the output is not stable.
    return ok(await context.doc.save());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(appError('PDF_WRITE_FAILED', `Could not write the PDF: ${message}`));
  }
}
