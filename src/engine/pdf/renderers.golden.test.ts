/**
 * @vitest-environment node
 */
import { decompressSync } from 'fflate';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { sheetPreset } from '@/engine/imposition/specs';
import { addSheetPage, createPdfDocument, finish } from '@/engine/pdf/document';
import { renderNodes } from '@/engine/pdf/render';
import { ellipseNode, groupNode, lineNode, rectNode, textNode } from '@/engine/scene/factories';
import type { SceneNode } from '@/engine/scene/types';
import { fontBytes, PLEX_SANS_REGULAR } from '@/engine/text/fixtures';
import { clearFonts, loadFont, registerFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { points } from '@/engine/units/types';
import { isOk } from '@/lib/result';

const p = points;
const A4 = sheetPreset('a4', 'portrait');

clearFonts();
const loaded = loadFont(fontBytes(PLEX_SANS_REGULAR), { family: 'IBM Plex Sans' });
if (!isOk(loaded)) throw new Error('fixture font failed to load');
registerFont(loaded.value);
const FONT = loaded.value;

/**
 * Renders nodes and returns the page's decoded content-stream operators.
 *
 * Content streams are flate-compressed in the saved file, so the bytes have to
 * be inflated before any operator is visible. Reading the raw file as text
 * finds nothing and every assertion passes or fails for the wrong reason.
 */
async function contentStream(nodes: readonly SceneNode[]): Promise<string> {
  const context = await createPdfDocument();
  const page = addSheetPage(context, A4, { trim: null });

  const rendered = await renderNodes({ context, page, sheet: A4, nodes, origin: { x: 0, y: 0 } });
  if (!isOk(rendered)) throw new Error(rendered.error.message);

  const bytes = await finish(context);
  if (!isOk(bytes)) throw new Error(bytes.error.message);

  return decodeContents(bytes.value);
}

async function decodeContents(pdfBytes: Uint8Array, pageIndex = 0): Promise<string> {
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.getPage(pageIndex);

  const contents = page.node.Contents();
  if (contents === undefined) return '';

  const streams: PDFRawStream[] =
    contents instanceof PDFArray
      ? contents
          .asArray()
          .map((ref) => pdf.context.lookup(ref))
          .filter((value): value is PDFRawStream => value instanceof PDFRawStream)
      : contents instanceof PDFRawStream
        ? [contents]
        : [];

  return streams
    .map((stream) => {
      const raw = stream.getContents();
      const filter = stream.dict.get(PDFName.of('Filter'));
      const isFlate = filter !== undefined && String(filter).includes('FlateDecode');

      // decompressSync, not inflateSync: pdf-lib writes ZLIB-wrapped deflate
      // (leading 0x78), and fflate's inflateSync expects RAW deflate and dies
      // with "unexpected EOF" on the header.
      return Buffer.from(isFlate ? decompressSync(raw) : raw).toString('latin1');
    })
    .join('\n');
}

function box(width = 100, height = 50) {
  return { x: p(10), y: p(20), width: p(width), height: p(height) };
}

describe('shapes', () => {
  it('draws a rectangle', async () => {
    const stream = await contentStream([
      rectNode({ id: 'r', ...box(), fill: { kind: 'solid', color: '#1a1815' } }),
    ]);
    // `re` is the PDF rectangle operator.
    // pdf-lib builds rectangles from a path (m/l/h), NOT the `re` operator.
    // Assert the geometry instead: translated to its flipped origin, filled.
    const bottom = A4.height - 20 - 50;
    expect(stream).toContain(`1 0 0 1 10 ${bottom} cm`);
    expect(stream).toMatch(/^f$/m);
  });

  it('draws an ellipse as bezier curves', async () => {
    const stream = await contentStream([
      ellipseNode({ id: 'e', ...box(), fill: { kind: 'solid', color: '#1f3a5f' } }),
    ]);
    // `c` is the cubic bezier operator; an ellipse has no primitive in PDF.
    expect(stream).toMatch(/\bc\b/);
  });

  it('draws a line', async () => {
    const stream = await contentStream([lineNode({ id: 'l', ...box(100, 0) })]);
    expect(stream).toMatch(/\bl\b/);
  });

  it('skips a zero-size shape rather than emitting a degenerate operator', async () => {
    // A zero-width rect is a valid but meaningless operator that some RIPs
    // treat as a hairline.
    const stream = await contentStream([
      rectNode({ id: 'r', x: p(0), y: p(0), width: p(0), height: p(0) }),
    ]);
    expect(stream).not.toMatch(/^f$/m);
  });

  it('skips an invisible node', async () => {
    const stream = await contentStream([
      rectNode({ id: 'r', ...box(), visible: false, fill: { kind: 'solid', color: '#000' } }),
    ]);
    expect(stream).not.toMatch(/^f$/m);
  });

  it('emits no fill operator when fill is none', async () => {
    const stream = await contentStream([rectNode({ id: 'r', ...box() })]);
    // `f` fills, `S` strokes. Neither should appear for an unpainted rect.
    expect(stream).not.toMatch(/^f$/m);
    expect(stream).not.toMatch(/^S$/m);
  });
});

describe('text positioning', () => {
  // The highest-risk assertion in the project. Canvas auto-fit trusts
  // measure.ts; if the PDF places text by a different rule, every card in a
  // run is wrong and nobody finds out until they are printed.
  const TEXT = textNode({
    id: 't',
    x: p(10),
    y: p(20),
    width: p(400),
    height: p(24),
    text: 'Ada Lovelace',
    fontSize: p(18),
  });

  it('emits a text-showing operator', async () => {
    const stream = await contentStream([TEXT]);
    expect(stream).toMatch(/\bTj\b|\bTJ\b/);
  });

  it('positions the baseline from measure.ts ascent, not from the box top', async () => {
    const stream = await contentStream([TEXT]);

    const measured = measureText({
      text: TEXT.text,
      font: FONT,
      fontSize: TEXT.fontSize,
      tracking: TEXT.tracking,
      lineHeight: TEXT.lineHeight,
    });

    // Engine y is top-down; the baseline sits `ascent` below the box top, and
    // PDF y is measured up from the page bottom.
    const expected = A4.height - TEXT.y - measured.ascent;
    const matches = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];

    expect(matches.length).toBeGreaterThan(0);
    const y = Number(matches[0]?.[2]);
    expect(y).toBeCloseTo(expected, 1);
  });

  it('starts a left-aligned line at the box left edge', async () => {
    const stream = await contentStream([TEXT]);
    const matches = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];
    expect(Number(matches[0]?.[1])).toBeCloseTo(TEXT.x, 1);
  });

  it('centres a centred line using the measured width', async () => {
    const centred = { ...TEXT, align: 'center' as const };
    const stream = await contentStream([centred]);

    const measured = measureText({
      text: centred.text,
      font: FONT,
      fontSize: centred.fontSize,
      tracking: centred.tracking,
      lineHeight: centred.lineHeight,
    });
    const expected = centred.x + (centred.width - measured.width) / 2;

    const matches = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];
    expect(Number(matches[0]?.[1])).toBeCloseTo(expected, 1);
  });

  it('right-aligns using the measured width', async () => {
    const right = { ...TEXT, align: 'right' as const };
    const stream = await contentStream([right]);

    const measured = measureText({
      text: right.text,
      font: FONT,
      fontSize: right.fontSize,
      tracking: right.tracking,
      lineHeight: right.lineHeight,
    });
    const expected = right.x + right.width - measured.width;

    const matches = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];
    expect(Number(matches[0]?.[1])).toBeCloseTo(expected, 1);
  });

  it('spaces multiple lines by the measured line height', async () => {
    const multi = { ...TEXT, text: 'Ada\nLovelace' };
    const stream = await contentStream([multi]);

    const matches = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];
    expect(matches).toHaveLength(2);

    const first = Number(matches[0]?.[2]);
    const second = Number(matches[1]?.[2]);
    // Second line sits one line-height LOWER, which is a smaller PDF y.
    expect(first - second).toBeCloseTo(multi.fontSize * multi.lineHeight, 3);
  });

  it('emits no text operator for an empty string', async () => {
    const stream = await contentStream([{ ...TEXT, text: '' }]);
    expect(stream).not.toMatch(/\bTj\b/);
  });
});

describe('text fits the box it was measured against', () => {
  it('a line that measure.ts says fits stays inside the trim', async () => {
    // The headline correctness claim of the product, asserted directly.
    const width = 120;
    const node = textNode({
      id: 't',
      x: p(0),
      y: p(0),
      width: p(width),
      height: p(30),
      text: 'Ada Lovelace',
      fontSize: p(18),
    });

    const measured = measureText({
      text: node.text,
      font: FONT,
      fontSize: node.fontSize,
      tracking: node.tracking,
      lineHeight: node.lineHeight,
    });

    expect(measured.width).toBeLessThanOrEqual(width);

    const stream = await contentStream([node]);
    const matches = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];
    const startX = Number(matches[0]?.[1]);

    // Start plus measured width must not cross the right edge of the box.
    expect(startX + measured.width).toBeLessThanOrEqual(node.x + width + 1e-6);
  });
});

describe('graphics state', () => {
  it('balances every save with a restore', async () => {
    // An unbalanced q/Q leaks a transform into everything drawn afterwards,
    // which on an imposed sheet means every later card is displaced.
    const stream = await contentStream([
      rectNode({ id: 'r', ...box(), fill: { kind: 'solid', color: '#000' } }),
      textNode({ id: 't', ...box(), text: 'Ada', fontSize: p(12) }),
      ellipseNode({ id: 'e', ...box(), fill: { kind: 'solid', color: '#000' } }),
    ]);

    const saves = (stream.match(/(^|\s)q(\s|$)/g) ?? []).length;
    const restores = (stream.match(/(^|\s)Q(\s|$)/g) ?? []).length;
    expect(saves).toBe(restores);
  });

  it('renders group children', async () => {
    const stream = await contentStream([
      groupNode({
        id: 'g',
        ...box(),
        children: [rectNode({ id: 'inner', ...box(), fill: { kind: 'solid', color: '#000' } })],
      }),
    ]);
    // The child is painted even though the group itself draws nothing.
    expect(stream).toMatch(/^f$/m);
  });
});

describe('origin offset', () => {
  it('translates every node by the cell origin', async () => {
    // Imposition places the same design at each cell; the offset is what puts
    // card 7 in cell 7 rather than all ten on top of each other.
    const context = await createPdfDocument();
    const page = addSheetPage(context, A4, { trim: null });
    const node = textNode({
      id: 't',
      x: p(0),
      y: p(0),
      width: p(200),
      height: p(24),
      text: 'Ada',
      fontSize: p(18),
    });

    const rendered = await renderNodes({
      context,
      page,
      sheet: A4,
      nodes: [node],
      origin: { x: 100, y: 200 },
    });
    if (!isOk(rendered)) throw new Error(rendered.error.message);

    const bytes = await finish(context);
    if (!isOk(bytes)) throw new Error('expected bytes');
    // Decoded, not raw: the stream is compressed and a raw read finds nothing.
    const stream = await decodeContents(bytes.value);

    const matches = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];
    expect(Number(matches[0]?.[1])).toBeCloseTo(100, 1);
  });
});
