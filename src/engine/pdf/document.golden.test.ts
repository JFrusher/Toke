/**
 * @vitest-environment node
 *
 * Golden suite: writes real PDF bytes and parses them back.
 *
 * Assertions are on extracted geometry and structure, never on raw bytes —
 * pdf-lib output is not byte-stable across runs (timestamps, object ordering),
 * so a byte diff would fail for reasons that have nothing to do with the
 * rendering being correct.
 */
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { sheetPreset } from '@/engine/imposition/specs';
import { addSheetPage, createPdfDocument, finish } from '@/engine/pdf/document';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres } from '@/engine/units/types';
import { isOk } from '@/lib/result';

const mm = (n: number) => millimetresToPoints(millimetres(n));
const A4 = sheetPreset('a4', 'portrait');

async function build(configure: (context: Awaited<ReturnType<typeof createPdfDocument>>) => void) {
  const context = await createPdfDocument();
  configure(context);
  const bytes = await finish(context);
  if (!isOk(bytes)) throw new Error(bytes.error.message);
  return PDFDocument.load(bytes.value);
}

describe('page geometry', () => {
  it('sizes the page to the sheet', async () => {
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: null });
    });

    const page = pdf.getPage(0);
    expect(page.getWidth()).toBeCloseTo(595.276, 2);
    expect(page.getHeight()).toBeCloseTo(841.89, 2);
  });

  it('adds one page per call', async () => {
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: null });
      addSheetPage(context, A4, { trim: null });
      addSheetPage(context, A4, { trim: null });
    });

    expect(pdf.getPageCount()).toBe(3);
  });

  it('writes a MediaBox matching the sheet', async () => {
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: null });
    });

    const box = pdf.getPage(0).getMediaBox();
    expect(box.width).toBeCloseTo(595.276, 2);
    expect(box.height).toBeCloseTo(841.89, 2);
  });
});

describe('trim and bleed boxes', () => {
  const TRIM = {
    x: mm(10),
    y: mm(10),
    width: mm(190),
    height: mm(277),
    bleed: mm(3),
  };

  it('writes a TrimBox at the cut line', async () => {
    // A print shop reads TrimBox to know where to cut. Omitting it means the
    // shop guesses, and a guess on a 3mm bleed is a visibly wrong card.
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: TRIM });
    });

    const box = pdf.getPage(0).getTrimBox();
    expect(box.width).toBeCloseTo(TRIM.width, 3);
    expect(box.height).toBeCloseTo(TRIM.height, 3);
  });

  it('writes a BleedBox larger than the TrimBox by the bleed on each side', async () => {
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: TRIM });
    });

    const page = pdf.getPage(0);
    const trim = page.getTrimBox();
    const bleed = page.getBleedBox();

    expect(bleed.width - trim.width).toBeCloseTo(TRIM.bleed * 2, 3);
    expect(bleed.height - trim.height).toBeCloseTo(TRIM.bleed * 2, 3);
  });

  it('nests the boxes correctly — trim inside bleed inside media', async () => {
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: TRIM });
    });

    const page = pdf.getPage(0);
    const media = page.getMediaBox();
    const bleed = page.getBleedBox();
    const trim = page.getTrimBox();

    expect(bleed.width).toBeLessThanOrEqual(media.width + 1e-6);
    expect(trim.width).toBeLessThanOrEqual(bleed.width + 1e-6);
  });

  it('flips y for PDF coordinates', async () => {
    // Points in the engine run top-down from the artboard origin; PDF runs
    // bottom-up. Getting this wrong mirrors every page vertically, which
    // looks plausible on a symmetrical layout and wrong on everything else.
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: { ...TRIM, y: mm(10) } });
    });

    const page = pdf.getPage(0);
    const trim = page.getTrimBox();
    // Engine y=10mm from the top means PDF y = height - 10mm - trimHeight.
    const expected = A4.height - mm(10) - TRIM.height;
    expect(trim.y).toBeCloseTo(expected, 3);
  });

  it('omits trim and bleed boxes for a proof page', async () => {
    // A proof is for looking at on screen; cut marks and boxes would only
    // confuse the reader.
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: null });
    });

    const page = pdf.getPage(0);
    // pdf-lib falls back to MediaBox when no TrimBox is set.
    expect(page.getTrimBox().width).toBeCloseTo(page.getMediaBox().width, 3);
  });
});

describe('document metadata', () => {
  it('identifies toke as the creator', async () => {
    // Creator rather than Producer: pdf-lib overwrites Producer with its own
    // string on save and offers no way to keep ours, so asserting on it would
    // be asserting on pdf-lib.
    const pdf = await build((context) => {
      addSheetPage(context, A4, { trim: null });
    });
    expect(pdf.getCreator()).toContain('toke');
  });

  it('produces a loadable PDF', async () => {
    const context = await createPdfDocument();
    addSheetPage(context, A4, { trim: null });
    const bytes = await finish(context);

    if (!isOk(bytes)) throw new Error('expected bytes');
    // %PDF- magic.
    expect(Buffer.from(bytes.value.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});
