/**
 * @vitest-environment node
 */
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { designSpec, sheetPreset } from '@/engine/imposition/specs';
import { exportProof, exportSheets } from '@/engine/pdf/assemble';
import { rectNode, textNode } from '@/engine/scene/factories';
import type { SceneNode } from '@/engine/scene/types';
import { fontBytes, PLEX_SANS_REGULAR } from '@/engine/text/fixtures';
import { clearFonts, loadFont, registerFont } from '@/engine/text/fontLoader';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, points } from '@/engine/units/types';
import { isErr, isOk } from '@/lib/result';

const p = points;
const mm = (n: number) => millimetresToPoints(millimetres(n));

clearFonts();
const loaded = loadFont(fontBytes(PLEX_SANS_REGULAR), { family: 'IBM Plex Sans' });
if (!isOk(loaded)) throw new Error('fixture font failed to load');
registerFont(loaded.value);

const A4 = sheetPreset('a4', 'portrait');
const PLACE_CARD = designSpec({ width: mm(85), height: mm(55), bleed: mm(3) });

const NODES: SceneNode[] = [
  rectNode({
    id: 'bg',
    x: p(0),
    y: p(0),
    width: mm(85),
    height: mm(55),
    fill: { kind: 'solid', color: '#faf8f4' },
  }),
  textNode({
    id: 'name',
    x: mm(6),
    y: mm(20),
    width: mm(73),
    height: mm(12),
    text: '{{ first_name }} {{ last_name }}',
    fontSize: p(18),
    align: 'center',
  }),
];

function guests(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    first_name: `First${index}`,
    last_name: `Last${index}`,
  }));
}

async function run(
  recordCount: number,
  overrides: Partial<Parameters<typeof exportSheets>[0]> = {},
) {
  const result = await exportSheets({
    nodes: NODES,
    rows: guests(recordCount),
    sheet: A4,
    design: PLACE_CARD,
    margin: mm(10),
    cropMarks: true,
    ...overrides,
  });

  if (!isOk(result)) throw new Error(result.error.message);
  return { bytes: result.value.bytes, report: result.value };
}

describe('pagination', () => {
  it('produces 15 pages for 142 records at 10-up', async () => {
    // The plan's worked example, end to end: Phase 1 imposition maths meeting
    // the Phase 8 renderer and producing a real file.
    const { bytes, report } = await run(142);
    const pdf = await PDFDocument.load(bytes);

    expect(report.sheetCount).toBe(15);
    expect(pdf.getPageCount()).toBe(15);
    expect(report.nUp).toBe(10);
  });

  it('produces exactly 15 pages for 150 records, with none empty', async () => {
    const { report } = await run(150);
    expect(report.sheetCount).toBe(15);
    expect(report.emptyCells).toBe(0);
  });

  it('reports the empty cells on the final sheet', async () => {
    const { report } = await run(142);
    expect(report.emptyCells).toBe(8);
  });

  it('refuses an export with zero records', async () => {
    // A blank page sent to a printer costs real money and paper, and a PDF
    // with no pages is NOT nothing — pdf-lib reads one back as a blank page.
    const result = await exportSheets({
      nodes: NODES,
      rows: [],
      sheet: A4,
      design: PLACE_CARD,
      margin: mm(10),
      cropMarks: true,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('EXPORT_NO_RECORDS');
  });

  it('puts a single record on one sheet', async () => {
    const { report } = await run(1);
    expect(report.sheetCount).toBe(1);
    expect(report.emptyCells).toBe(9);
  });
});

describe('page geometry', () => {
  it('sizes every page to the sheet', async () => {
    const { bytes } = await run(12);
    const pdf = await PDFDocument.load(bytes);

    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(A4.width, 2);
      expect(page.getHeight()).toBeCloseTo(A4.height, 2);
    }
  });

  it('writes trim and bleed boxes on every sheet', async () => {
    const { bytes } = await run(12);
    const pdf = await PDFDocument.load(bytes);

    for (const page of pdf.getPages()) {
      const trim = page.getTrimBox();
      const bleed = page.getBleedBox();
      expect(bleed.width).toBeGreaterThan(trim.width);
    }
  });
});

describe('record placement', () => {
  it('resolves each record into its own cell', async () => {
    const { bytes } = await run(3);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('reports how many records were rendered', async () => {
    const { report } = await run(23);
    expect(report.recordsRendered).toBe(23);
  });

  it('carries a token failure out rather than printing the template', async () => {
    // Printing "{{ nope }}" on 150 cards is the worst possible outcome; the
    // export refuses instead.
    const result = await exportSheets({
      nodes: [{ ...NODES[1], text: '{{ nope }}' } as SceneNode],
      rows: guests(3),
      sheet: A4,
      design: PLACE_CARD,
      margin: mm(10),
      cropMarks: true,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('TOKEN_UNKNOWN_COLUMN');
  });
});

describe('crop marks', () => {
  it('draws marks when asked', async () => {
    const withMarks = await run(1);
    const without = await run(1, { cropMarks: false });

    // Marks are real content, so the file with them is larger.
    expect(withMarks.bytes.byteLength).toBeGreaterThan(without.bytes.byteLength);
  });
});

describe('proof export', () => {
  it('produces one page at trim size', async () => {
    const result = await exportProof({
      nodes: NODES,
      row: { first_name: 'Ada', last_name: 'Lovelace' },
      design: PLACE_CARD,
    });

    if (!isOk(result)) throw new Error(result.error.message);
    const pdf = await PDFDocument.load(result.value);

    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(mm(85), 2);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(mm(55), 2);
  });

  it('is fast enough to feel instant', async () => {
    const started = Date.now();
    await exportProof({
      nodes: NODES,
      row: { first_name: 'Ada', last_name: 'Lovelace' },
      design: PLACE_CARD,
    });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('font subsetting', () => {
  it('embeds one subset however many records use the face', async () => {
    const few = await run(1);
    const many = await run(100);

    // 100 records of similar names add glyph coverage, not another copy of
    // the font. Without subsetting this would grow by ~218KB per face.
    expect(many.bytes.byteLength).toBeLessThan(few.bytes.byteLength + 200_000);
  });

  it('stays far smaller than an unsubsetted face would be', async () => {
    const { bytes } = await run(10);
    // A full Plex face is ~218KB; a subset of the few dozen glyphs these
    // names use must be a fraction of that.
    expect(bytes.byteLength).toBeLessThan(150_000);
  });
});

describe('scale', () => {
  it('exports 500 records inside the budget', async () => {
    const started = Date.now();
    const { report } = await run(500);
    const elapsed = Date.now() - started;

    expect(report.sheetCount).toBe(50);
    expect(elapsed).toBeLessThan(30_000);
  });

  it('stays inside the memory half of the budget', async () => {
    // INC-26. The plan's budget is 500 records under 30s AND under 1GB, and
    // only the time half was ever asserted. The whole document is held in
    // memory until finish(), so this is the number that would grow with a run.
    //
    // Peak is sampled while the export runs rather than read once at the end:
    // by then the intermediate objects may already have been collected.
    let peak = process.memoryUsage().heapUsed;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 5);

    try {
      const { bytes } = await run(500);
      peak = Math.max(peak, process.memoryUsage().heapUsed);

      const megabytes = peak / 1024 / 1024;
      expect(megabytes).toBeLessThan(1024);
      // And the file itself: 500 cards sharing one font subset is small.
      expect(bytes.byteLength).toBeLessThan(5 * 1024 * 1024);
    } finally {
      clearInterval(sampler);
    }
  });
});

describe('progress and cancellation', () => {
  it('reports progress once per sheet, ending at 1', async () => {
    const seen: number[] = [];
    await exportSheets({
      nodes: NODES,
      rows: guests(35),
      sheet: A4,
      design: PLACE_CARD,
      margin: mm(10),
      cropMarks: true,
      onProgress: (fraction) => seen.push(fraction),
    });

    expect(seen).toHaveLength(4);
    expect(seen.at(-1)).toBeCloseTo(1, 6);
  });

  it('abandons the export rather than returning a partial document', async () => {
    // A half-written PDF looks valid and prints short. Erroring is the only
    // safe answer.
    let sheets = 0;
    const result = await exportSheets({
      nodes: NODES,
      rows: guests(100),
      sheet: A4,
      design: PLACE_CARD,
      margin: mm(10),
      cropMarks: true,
      shouldCancel: () => {
        sheets += 1;
        return sheets >= 2;
      },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('EXPORT_CANCELLED');
  });
});
