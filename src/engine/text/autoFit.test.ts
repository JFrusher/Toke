/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { autoFit } from '@/engine/text/autoFit';
import { fontBytes, PLEX_SANS_REGULAR } from '@/engine/text/fixtures';
import { loadFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { points } from '@/engine/units/types';
import { isOk } from '@/lib/result';

const p = points;

const loaded = loadFont(fontBytes(PLEX_SANS_REGULAR), {});
if (!isOk(loaded)) throw new Error('fixture font failed to load');
const FONT = loaded.value;

const BOX = { width: p(120), height: p(40) };

// NOT named `fit`: that is Jest's alias for `it.only`, so a focused-test
// lint rule fires on every call and a reader could misread it the same way.
function fitText(text: string, overrides: Partial<Parameters<typeof autoFit>[0]> = {}) {
  return autoFit({
    text,
    font: FONT,
    box: BOX,
    fontSize: p(18),
    minFontSize: p(6),
    tracking: 0,
    lineHeight: 1.2,
    mode: 'shrink',
    ...overrides,
  });
}

function widthAt(text: string, size: number): number {
  return measureText({
    text,
    font: FONT,
    fontSize: points(size),
    tracking: 0,
    lineHeight: 1.2,
  }).width;
}

describe('text that already fits', () => {
  it('keeps the requested size', () => {
    const result = fitText('Ada');
    expect(result.fontSize).toBe(18);
    expect(result.overflow).toBe(false);
  });

  it('returns the text unchanged', () => {
    expect(fitText('Ada').text).toBe('Ada');
  });

  it('handles an empty string', () => {
    const result = fitText('');
    expect(result.fontSize).toBe(18);
    expect(result.overflow).toBe(false);
  });
});

describe('shrink to fit', () => {
  it('reduces the size until the text fits', () => {
    const result = fitText('Bartholomew Winterbourne Fitzgerald');
    expect(result.fontSize).toBeLessThan(18);
    expect(widthAt(result.text, result.fontSize)).toBeLessThanOrEqual(BOX.width + 1e-6);
  });

  it('never returns a size that overflows', () => {
    // The whole point. A size that overflows would pass on screen and print
    // outside the trim.
    for (const name of [
      'Ada',
      'Ada Lovelace',
      'Bartholomew Winterbourne',
      'Bartholomew Winterbourne Fitzgerald-Smythe',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
    ]) {
      const result = fitText(name);
      if (!result.overflow) {
        expect(widthAt(result.text, result.fontSize)).toBeLessThanOrEqual(BOX.width + 1e-6);
      }
    }
  });

  it('never goes below the minimum size', () => {
    const result = fitText('W'.repeat(200));
    expect(result.fontSize).toBeGreaterThanOrEqual(6);
  });

  it('flags overflow when the minimum still does not fit', () => {
    const result = fitText('W'.repeat(200));
    expect(result.overflow).toBe(true);
    expect(result.fontSize).toBe(6);
  });

  it('converges in at most eight iterations', () => {
    // Binary search over a continuous range. Linear decrement would take
    // hundreds of measurements per record and make a 500-card export crawl.
    const result = fitText('Bartholomew Winterbourne Fitzgerald');
    expect(result.iterations).toBeLessThanOrEqual(8);
  });

  it('converges for a wide size range', () => {
    const result = fitText('Bartholomew Winterbourne', { fontSize: p(400), minFontSize: p(1) });
    expect(result.iterations).toBeLessThanOrEqual(8);
    expect(result.fontSize).toBeLessThanOrEqual(400);
  });

  it('respects the box height as well as its width', () => {
    const result = fitText('Ada Lovelace', { box: { width: p(500), height: p(10) } });
    expect(result.fontSize).toBeLessThan(18);
  });
});

describe('truncate', () => {
  it('shortens the text and appends an ellipsis', () => {
    const result = fitText('Bartholomew Winterbourne Fitzgerald', { mode: 'truncate' });
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.length).toBeLessThan('Bartholomew Winterbourne Fitzgerald'.length);
  });

  it('keeps the requested font size', () => {
    expect(fitText('Bartholomew Winterbourne Fitzgerald', { mode: 'truncate' }).fontSize).toBe(18);
  });

  it('produces text that fits', () => {
    const result = fitText('Bartholomew Winterbourne Fitzgerald', { mode: 'truncate' });
    expect(widthAt(result.text, result.fontSize)).toBeLessThanOrEqual(BOX.width + 1e-6);
  });

  it('leaves text that already fits alone', () => {
    const result = fitText('Ada', { mode: 'truncate' });
    expect(result.text).toBe('Ada');
    expect(result.overflow).toBe(false);
  });

  it('never splits a surrogate pair', () => {
    // Cutting an emoji in half produces a replacement character on the card.
    const result = fitText('👰🏽‍♀️👰🏽‍♀️👰🏽‍♀️👰🏽‍♀️👰🏽‍♀️👰🏽‍♀️👰🏽‍♀️👰🏽‍♀️', {
      mode: 'truncate',
      box: { width: p(30), height: p(40) },
    });
    expect(result.text).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('cuts on a grapheme boundary, never mid-cluster', () => {
    // NFD "é" is ONE grapheme made of TWO code points, and correctly ends
    // with a combining mark — so a regex on the last code point proves
    // nothing. What matters is that the kept text is a whole-grapheme prefix
    // of the original; a cut inside the cluster would strand an acute accent
    // with nothing to sit on.
    const source = 'é'.repeat(40).normalize('NFD');
    const result = fitText(source, { mode: 'truncate', box: { width: p(30), height: p(40) } });

    const kept = result.text.replace('…', '');
    const segment = (value: string) =>
      [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
        (entry) => entry.segment,
      );

    const keptGraphemes = segment(kept);
    expect(segment(source).slice(0, keptGraphemes.length)).toEqual(keptGraphemes);
  });

  it('flags overflow when even one character will not fit', () => {
    const result = fitText('WWWW', { mode: 'truncate', box: { width: p(1), height: p(40) } });
    expect(result.overflow).toBe(true);
  });
});

describe('wrap', () => {
  it('wraps to the box width', () => {
    const result = fitText('Bartholomew Winterbourne Fitzgerald', { mode: 'wrap' });
    expect(result.lines.length).toBeGreaterThan(1);
  });

  it('keeps the requested size when the wrapped text fits the box', () => {
    // 90pt, not 60: "Lovelace" alone measures 70.7pt at 18pt, so a 60pt box
    // cannot hold the longest wrapped line and a shrink is correct there.
    const result = fitText('Ada Lovelace', { mode: 'wrap', box: { width: p(90), height: p(100) } });
    expect(result.fontSize).toBe(18);
    expect(result.overflow).toBe(false);
  });

  it('shrinks when the wrapped text is too tall', () => {
    // Width alone is satisfied by wrapping; height is what forces a shrink.
    const result = fitText('Bartholomew Winterbourne Fitzgerald Smythe', {
      mode: 'wrap',
      box: { width: p(60), height: p(30) },
    });
    expect(result.fontSize).toBeLessThan(18);
  });

  it('flags overflow when it cannot fit even at the minimum', () => {
    const result = fitText('Bartholomew Winterbourne Fitzgerald Smythe '.repeat(10), {
      mode: 'wrap',
      box: { width: p(40), height: p(20) },
    });
    expect(result.overflow).toBe(true);
  });

  it('reports the wrapped lines', () => {
    const result = fitText('Ada Lovelace', { mode: 'wrap', box: { width: p(90), height: p(100) } });
    expect(result.lines.map((line) => line.text)).toEqual(['Ada', 'Lovelace']);
  });
});

describe('determinism', () => {
  it('gives the same answer every time', () => {
    // Export measures the same string for hundreds of records; variance
    // would print inconsistent cards in one run.
    const a = fitText('Bartholomew Winterbourne');
    const b = fitText('Bartholomew Winterbourne');
    expect(a).toEqual(b);
  });
});
