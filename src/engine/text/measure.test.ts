/**
 * @vitest-environment node
 */
import { create as createFont, type Font } from 'fontkit';
import { describe, expect, it } from 'vitest';
import { fontBytes, PLEX_SANS_REGULAR } from '@/engine/text/fixtures';
import { loadFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { points } from '@/engine/units/types';
import { isOk } from '@/lib/result';

const p = points;

const loaded = loadFont(fontBytes(PLEX_SANS_REGULAR), {});
if (!isOk(loaded)) throw new Error('fixture font failed to load');
const FONT = loaded.value;

/** Independent ground truth, straight from fontkit. */
function fontkitAdvance(text: string, size: number): number {
  const parsed = createFont(Buffer.from(fontBytes(PLEX_SANS_REGULAR))) as Font;
  const run = parsed.layout(text);
  const units = run.positions.reduce(
    (total: number, position: { xAdvance: number }) => total + position.xAdvance,
    0,
  );
  return (units / parsed.unitsPerEm) * size;
}

function measure(text: string, overrides: Partial<Parameters<typeof measureText>[0]> = {}) {
  return measureText({
    text,
    font: FONT,
    fontSize: p(18),
    tracking: 0,
    lineHeight: 1.2,
    ...overrides,
  });
}

describe('width', () => {
  it('matches fontkit advance widths exactly', () => {
    // The single source of truth for text size (CLAUDE.md §2.1). If this
    // drifts, auto-fit passes on screen and overflows the trim in print.
    for (const text of ['Ada', 'Ada Lovelace', 'Winterbourne', 'iiii', 'WWWW']) {
      expect(measure(text).width).toBeCloseTo(fontkitAdvance(text, 18), 9);
    }
  });

  it('scales linearly with font size', () => {
    const small = measure('Lovelace', { fontSize: p(10) }).width;
    const large = measure('Lovelace', { fontSize: p(20) }).width;
    expect(large).toBeCloseTo(small * 2, 9);
  });

  it('is zero for an empty string', () => {
    expect(measure('').width).toBe(0);
  });

  it('still reports one line for an empty string', () => {
    // A blank text object must keep its height, or the layout jumps when a
    // token resolves to nothing.
    expect(measure('').lines).toHaveLength(1);
  });

  it('counts a space', () => {
    expect(measure('a b').width).toBeGreaterThan(measure('ab').width);
  });
});

describe('tracking', () => {
  it('widens the line', () => {
    expect(measure('Lovelace', { tracking: 2 }).width).toBeGreaterThan(measure('Lovelace').width);
  });

  it('adds between characters only, not after the last', () => {
    // 8 characters means 7 gaps. Adding a trailing gap would make a centred
    // line sit half a tracking unit left of true centre.
    const plain = measure('Lovelace').width;
    const tracked = measure('Lovelace', { tracking: 2 }).width;
    expect(tracked - plain).toBeCloseTo(7 * 2, 9);
  });

  it('does not apply to a single character', () => {
    expect(measure('A', { tracking: 5 }).width).toBeCloseTo(measure('A').width, 9);
  });

  it('does not apply to an empty string', () => {
    expect(measure('', { tracking: 5 }).width).toBe(0);
  });
});

describe('height and baselines', () => {
  it('derives line height from the multiplier', () => {
    const single = measure('Ada').height;
    expect(measure('Ada', { lineHeight: 2.4 }).height).toBeCloseTo(single * 2, 6);
  });

  it('reports ascent and descent in points', () => {
    const result = measure('Ada');
    expect(result.ascent).toBeCloseTo((FONT.ascent / FONT.unitsPerEm) * 18, 9);
    expect(result.descent).toBeCloseTo((FONT.descent / FONT.unitsPerEm) * 18, 9);
  });

  it('grows with each wrapped line', () => {
    const one = measure('Ada', { wrapWidth: p(500) }).height;
    const two = measure('Ada Lovelace', { wrapWidth: p(40) }).height;
    expect(two).toBeCloseTo(one * 2, 6);
  });
});

describe('explicit line breaks', () => {
  it('splits on a newline', () => {
    expect(measure('Ada\nLovelace').lines.map((line) => line.text)).toEqual(['Ada', 'Lovelace']);
  });

  it('keeps an empty line between two breaks', () => {
    expect(measure('a\n\nb').lines.map((line) => line.text)).toEqual(['a', '', 'b']);
  });

  it('reports the widest line as the width', () => {
    const result = measure('i\nWWWWWW');
    expect(result.width).toBeCloseTo(fontkitAdvance('WWWWWW', 18), 9);
  });
});

describe('word wrap', () => {
  it('breaks between words', () => {
    const result = measure('Ada Lovelace', { wrapWidth: p(50) });
    expect(result.lines.map((line) => line.text)).toEqual(['Ada', 'Lovelace']);
  });

  it('keeps a line that fits intact', () => {
    const result = measure('Ada Lovelace', { wrapWidth: p(500) });
    expect(result.lines).toHaveLength(1);
  });

  it('never exceeds the wrap width when a break is possible', () => {
    const result = measure('Eleanor Winterbourne Fitzgerald', { wrapWidth: p(90) });
    for (const line of result.lines) {
      // A word that cannot fit is allowed to overflow; see below.
      if (line.text.includes(' ')) expect(line.width).toBeLessThanOrEqual(90);
    }
  });

  it('puts a word longer than the wrap width on its own line rather than looping', () => {
    // The pathological case. Splitting mid-word would be worse than
    // overflowing, and looping forever would hang the export.
    const result = measure('Antidisestablishmentarianism', { wrapWidth: p(20) });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.width).toBeGreaterThan(20);
  });

  it('keeps a long word on its own line among shorter ones', () => {
    const result = measure('a Antidisestablishmentarianism b', { wrapWidth: p(40) });
    expect(result.lines.map((line) => line.text)).toEqual([
      'a',
      'Antidisestablishmentarianism',
      'b',
    ]);
  });

  it('collapses consecutive spaces at a break', () => {
    const result = measure('Ada    Lovelace', { wrapWidth: p(50) });
    expect(result.lines.map((line) => line.text)).toEqual(['Ada', 'Lovelace']);
  });

  it('does not leave trailing whitespace measured into a line', () => {
    // Trailing space counted into the width makes a right-aligned line sit
    // short of its box by exactly one space.
    const wrapped = measure('Ada Lovelace', { wrapWidth: p(50) });
    expect(wrapped.lines[0]?.width).toBeCloseTo(fontkitAdvance('Ada', 18), 9);
  });

  it('wraps within each explicit line independently', () => {
    const result = measure('Ada Lovelace\nGrace Hopper', { wrapWidth: p(50) });
    expect(result.lines.map((line) => line.text)).toEqual(['Ada', 'Lovelace', 'Grace', 'Hopper']);
  });

  it('reports character offsets back into the source string', () => {
    const result = measure('Ada Lovelace', { wrapWidth: p(50) });
    expect(result.lines[0]).toMatchObject({ start: 0, end: 3 });
    expect(result.lines[1]).toMatchObject({ start: 4, end: 12 });
  });
});

describe('determinism', () => {
  it('returns identical results for identical input', () => {
    // Export runs the same measurement hundreds of times. Any variance would
    // show up as inconsistent cards in one print run.
    expect(measure('Ada Lovelace', { wrapWidth: p(60) })).toEqual(
      measure('Ada Lovelace', { wrapWidth: p(60) }),
    );
  });
});
