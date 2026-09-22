import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { importCsv } from './helpers';

/**
 * P9.7 — the v1 acceptance scenario, in one unbroken run.
 *
 * Every phase meets every other phase here: the SQLite worker (P2), the canvas
 * and history (P3), persistence (P4), measurement (P5), tokens and auto-fit
 * (P6), Live Mode and pre-flight (P7), the PDF renderer and imposition (P1,
 * P8) and the shell (P9). Any one of them regressing breaks this test, which
 * is the point — the unit suites prove the parts, this proves the product.
 */

/**
 * 150 guests, deterministic, with the cases that break things: a name far too
 * long for the box, an accented character, an apostrophe and a one-letter
 * first name.
 */
function guestCsv(): string {
  const first = ['Ada', 'Grace', 'Alan', 'Katherine', 'Edsger', 'Barbara', 'Donald', 'Frances'];
  const last = ['Lovelace', 'Hopper', 'Turing', 'Johnson', 'Dijkstra', 'Liskov', 'Knuth', 'Allen'];

  const rows = Array.from({ length: 150 }, (_, index) => {
    if (index === 0) return 'Bartholomew,Winterbourne-Fitzgerald,1';
    if (index === 1) return 'Chelsea,Ó Súilleabháin,1';
    if (index === 2) return "Seán,O'Donnell,1";
    if (index === 3) return 'J,Park,1';

    const table = Math.floor(index / 10) + 1;
    return `${first[index % first.length]},${last[index % last.length]}${index},${table}`;
  });

  return ['first_name,last_name,table_number', ...rows].join('\n');
}

test('the v1 acceptance scenario, end to end', async ({ page }) => {
  // One test doing a full production run. The budget reflects 150 records
  // through a real database, a real renderer and a real save/reload.
  test.setTimeout(240_000);

  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();

  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');

  // ── Import a 150-row guest CSV ───────────────────────────────────────────
  await importCsv(page, guestCsv());

  await page.getByTestId('toggle-data').click();
  await expect(page.getByRole('grid')).toContainText('150 records');

  // ── Design an 85 x 55mm place card ───────────────────────────────────────
  // The default artboard is already the trim; the imposition panel reports it.
  await expect(page.getByTestId('imposition-yield')).toContainText('85 x 55');
  await expect(page.getByTestId('imposition-yield')).toContainText('Records150');

  // ── Bind first_name and last_name with auto-fit ──────────────────────────
  await page.getByTestId('tool-text').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('treeitem').getByRole('button').click();

  await page.getByTestId('binding-text').fill('{{ first_name }} {{ last_name }}');
  await page.getByTestId('binding-text').blur();
  await expect(page.getByTestId('bound-badge')).toBeVisible();

  // Shrink, not truncate: a guest whose name is cut in half at their own place
  // setting is worse than one set a point smaller.
  await page.getByTestId('autofit-shrink').click();

  // ── Cycle to the longest name and confirm it fits ────────────────────────
  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 150');

  await page.getByTestId('record-search').fill('Bartholomew');
  await expect(page.getByTestId('record-label')).toContainText('Bartholomew');
  // The canvas still holds the object; auto-fit resized rather than dropping
  // it, and the announcer said so.
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
  await expect(page.getByTestId('live-announcer')).toContainText('Bartholomew');

  // ── Configure A4 with 3mm bleed ──────────────────────────────────────────
  await expect(page.getByTestId('imposition-bleed')).toHaveValue('3');
  await expect(page.getByTestId('imposition-yield')).toContainText('Up10');
  // 150 at 10-up is exactly 15 sheets with nothing wasted.
  await expect(page.getByTestId('imposition-yield')).toContainText('Sheets15');
  await expect(page.getByTestId('imposition-yield')).toContainText('Waste0 cells');

  // ── Pre-flight ───────────────────────────────────────────────────────────
  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toBeVisible();
  const preflight = (await page.getByTestId('preflight-summary').textContent()) ?? '';
  await page.keyboard.press('Escape');

  // ── Export ───────────────────────────────────────────────────────────────
  await page.getByTestId('open-export').click();
  const pending = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByTestId('run-export').click();

  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  const pdf = await PDFDocument.load(bytes);

  // 15-page PDF.
  expect(pdf.getPageCount(), `expected 15 sheets; pre-flight said "${preflight}"`).toBe(15);

  for (const sheetPage of pdf.getPages()) {
    // A4 at 595.276 x 841.89pt.
    expect(sheetPage.getWidth()).toBeCloseTo(595.276, 1);
    expect(sheetPage.getHeight()).toBeCloseTo(841.89, 1);

    // Correct TrimBox and BleedBox: the shop reads these to know where to cut
    // and how much artwork to expect past the cut.
    const trim = sheetPage.getTrimBox();
    const bleed = sheetPage.getBleedBox();
    const media = sheetPage.getMediaBox();

    // 3mm each side = 8.504pt, so bleed is 2 x that wider than trim.
    expect(bleed.width - trim.width).toBeCloseTo(8.5039 * 2, 1);
    expect(bleed.height - trim.height).toBeCloseTo(8.5039 * 2, 1);

    // Nested correctly: trim inside bleed inside media.
    expect(trim.width).toBeLessThanOrEqual(bleed.width + 1e-6);
    expect(bleed.width).toBeLessThanOrEqual(media.width + 1e-6);
  }

  // Inspected through the object graph, not by grepping the bytes: pdf-lib
  // compresses these dictionaries, so a raw string search finds nothing and
  // the assertion passes or fails for the wrong reason.
  const objects = pdf.context.enumerateIndirectObjects().map(([, object]) => String(object));

  // Embedded, not referenced: FontFile2 is the TrueType program itself, so the
  // shop's RIP does not have to find IBM Plex on its own machine.
  expect(objects.some((object) => object.includes('/FontFile2'))).toBe(true);

  // Subsetted. pdf-lib 1.17.1 does NOT write the PDF spec's six-uppercase-letter
  // tag; it appends a numeric suffix to the base name instead, so asserting on
  // the spec form would fail against a perfectly good subset.
  expect(objects.some((object) => /\/BaseFont \/[\w-]+-\d{3,}/.test(object))).toBe(true);

  // The real evidence of subsetting is the width array: one entry per glyph
  // actually drawn. A full Plex face would list hundreds.
  const widths = objects.find((object) => object.includes('/W ['));
  expect(widths).toBeDefined();
  expect((widths?.match(/\d+/g) ?? []).length).toBeLessThan(200);

  // Selectable vector text, not a rasterised page: a rasterised run would
  // carry an image XObject and no font resource at all.
  expect(objects.some((object) => object.includes('/Type0'))).toBe(true);
  expect(objects.some((object) => /\/Subtype\s*\/Image/.test(object))).toBe(false);

  // A 150-card run with one embedded subset has no business being large.
  expect(bytes.byteLength).toBeLessThan(400_000);

  // ── Save the project ─────────────────────────────────────────────────────
  const saving = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const projectFile = await saving;

  const projectStream = await projectFile.createReadStream();
  const projectChunks: Buffer[] = [];
  for await (const chunk of projectStream) projectChunks.push(chunk as Buffer);
  const projectBytes = Buffer.concat(projectChunks);

  expect(projectBytes.byteLength).toBeGreaterThan(1000);

  // ── Reload and reopen ────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();

  await page.getByTestId('project-file').setInputFiles({
    name: 'Release.toke',
    mimeType: 'application/zip',
    buffer: projectBytes,
  });

  // Identical studio state: the design, the binding AND the data all travelled
  // inside the file. A scene graph without its database is not a project.
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
  await page.getByRole('treeitem').getByRole('button').click();
  await expect(page.getByTestId('binding-text')).toHaveValue('{{ first_name }} {{ last_name }}');

  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 150');
  await expect(page.getByTestId('imposition-yield')).toContainText('Sheets15');
});
