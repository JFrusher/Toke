/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fontsForExport } from '@/engine/pdf/exportClient';
import { groupNode, rectNode, textNode } from '@/engine/scene/factories';
import { fontBytes, PLEX_SANS_BOLD, PLEX_SANS_REGULAR } from '@/engine/text/fixtures';
import { clearFonts, loadFont, registerFont } from '@/engine/text/fontLoader';
import { points } from '@/engine/units/types';
import { isOk } from '@/lib/result';

/**
 * INC-24 — only the faces a scene uses cross the worker boundary.
 *
 * Every face is ~218KB copied into the export worker. Sending the whole
 * registry for a card that uses one weight multiplies the payload for nothing.
 */

function register(path: string, weight: 400 | 600) {
  const loaded = loadFont(fontBytes(path), { family: 'IBM Plex Sans', weight });
  if (!isOk(loaded)) throw new Error('fixture font failed to load');
  registerFont(loaded.value);
}

const text = (id: string, fontWeight: 400 | 500 | 600) =>
  textNode({
    id,
    x: points(0),
    y: points(0),
    width: points(100),
    height: points(20),
    text: 'Ada',
    fontWeight,
  });

describe('fontsForExport', () => {
  beforeEach(() => {
    clearFonts();
    register(PLEX_SANS_REGULAR, 400);
    register(PLEX_SANS_BOLD, 600);
  });

  it('sends every registered face when given no scene', () => {
    expect(fontsForExport()).toHaveLength(2);
  });

  it('sends only the faces the scene resolves to', () => {
    const fonts = fontsForExport([text('a', 400)]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]?.weight).toBe(400);
  });

  it('sends each face once however many nodes use it', () => {
    expect(fontsForExport([text('a', 400), text('b', 400), text('c', 400)])).toHaveLength(1);
  });

  it('sends the RESOLVED face when a weight falls back', () => {
    // 500 is not registered here; getFont resolves it to 400 (the first of the
    // equidistant faces). The worker makes the same choice from the same
    // family, so canvas and PDF still read one file.
    const fonts = fontsForExport([text('a', 500)]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]?.weight).toBe(400);
  });

  it('finds text inside groups', () => {
    const group = groupNode({
      id: 'g',
      x: points(0),
      y: points(0),
      width: points(100),
      height: points(20),
      children: [text('a', 600)],
    });
    expect(fontsForExport([group]).map((font) => font.weight)).toEqual([600]);
  });

  it('sends nothing for a scene with no text', () => {
    const rect = rectNode({
      id: 'r',
      x: points(0),
      y: points(0),
      width: points(10),
      height: points(10),
    });
    expect(fontsForExport([rect])).toEqual([]);
  });

  it('names faces by the family the design references', () => {
    // cssFamily, not the file's own name — the P8 bug where every uploaded
    // font failed at export.
    expect(fontsForExport([text('a', 600)])[0]?.family).toBe('IBM Plex Sans');
  });
});
