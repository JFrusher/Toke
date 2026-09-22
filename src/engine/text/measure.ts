import type { LoadedFont } from '@/engine/text/fontLoader';
import type { Points } from '@/engine/units/types';

/**
 * THE text measurement path (CLAUDE.md §2.1 rule 3).
 *
 * Canvas auto-fit and PDF layout both call this. Nothing else may measure
 * text — not `ctx.measureText`, not Fabric's internal measurement. Two
 * measurement sources disagree by a fraction of a point, which is invisible
 * on screen and puts text outside the trim across an entire print run.
 *
 * Enforced by a fitness test in engine/db/boundaries.test.ts.
 */

export type LineBox = {
  readonly text: string;
  /** Points. Excludes trailing whitespace. */
  readonly width: number;
  /** Character offsets back into the source string. */
  readonly start: number;
  readonly end: number;
};

export type Measured = {
  readonly lines: readonly LineBox[];
  /** Widest line, in Points. */
  readonly width: number;
  readonly height: number;
  /** Points, positive. */
  readonly ascent: number;
  /** Points, negative. */
  readonly descent: number;
  readonly lineHeight: number;
};

export type MeasureInput = {
  readonly text: string;
  readonly font: LoadedFont;
  readonly fontSize: Points;
  /** Extra space BETWEEN characters, in Points. */
  readonly tracking: number;
  /** Multiple of font size. */
  readonly lineHeight: number;
  /** Wrap at this width. Omit for no wrapping. */
  readonly wrapWidth?: Points;
};

/** Advance width of a run, before tracking. */
function advanceWidth(text: string, font: LoadedFont, fontSize: number): number {
  if (text === '') return 0;

  const run = font.parsed.layout(text);
  let units = 0;
  for (const position of run.positions) {
    units += position.xAdvance;
  }
  return (units / font.unitsPerEm) * fontSize;
}

/**
 * Tracking is added between characters only — n-1 gaps for n characters.
 * Adding a trailing gap would make a centred line sit half a unit left of
 * true centre, and a right-aligned line short of its box.
 */
function trackingWidth(text: string, tracking: number): number {
  return text.length < 2 ? 0 : (text.length - 1) * tracking;
}

function runWidth(text: string, font: LoadedFont, fontSize: number, tracking: number): number {
  return advanceWidth(text, font, fontSize) + trackingWidth(text, tracking);
}

type Word = { readonly text: string; readonly start: number };

/** Split on spaces, keeping each word's offset into the source string. */
function splitWords(paragraph: string): Word[] {
  const words: Word[] = [];
  let index = 0;

  while (index < paragraph.length) {
    while (index < paragraph.length && paragraph[index] === ' ') index += 1;
    if (index >= paragraph.length) break;

    const start = index;
    while (index < paragraph.length && paragraph[index] !== ' ') index += 1;
    words.push({ text: paragraph.slice(start, index), start });
  }

  return words;
}

/**
 * Greedy wrap over word tokens.
 *
 * Working from tokens rather than a scanning cursor is what keeps runs of
 * spaces out of the line text: a line is rebuilt by joining its words with a
 * single space, so trailing and repeated whitespace can never be measured in.
 */
function wrapParagraph(
  paragraph: string,
  offset: number,
  input: MeasureInput,
  limit: number,
): LineBox[] {
  const { font, fontSize, tracking } = input;
  const words = splitWords(paragraph);

  if (words.length === 0) {
    return [{ text: '', width: 0, start: offset, end: offset }];
  }

  const lines: LineBox[] = [];
  let current: Word[] = [];

  const join = (list: readonly Word[]) => list.map((word) => word.text).join(' ');

  function flush() {
    const first = current[0];
    const last = current[current.length - 1];
    if (first === undefined || last === undefined) return;

    const text = join(current);
    lines.push({
      text,
      width: runWidth(text, font, fontSize, tracking),
      start: offset + first.start,
      end: offset + last.start + last.text.length,
    });
    current = [];
  }

  for (const word of words) {
    if (current.length === 0) {
      // The first word always goes on the line, even when wider than the
      // limit. Breaking mid-word is worse than overflowing, and refusing to
      // place it would never terminate.
      current.push(word);
      continue;
    }

    const candidate = join([...current, word]);
    if (runWidth(candidate, font, fontSize, tracking) <= limit) {
      current.push(word);
    } else {
      flush();
      current.push(word);
    }
  }

  flush();
  return lines;
}

export function measureText(input: MeasureInput): Measured {
  const { text, font, fontSize, tracking, lineHeight } = input;

  const lineHeightPt = fontSize * lineHeight;
  const ascent = (font.ascent / font.unitsPerEm) * fontSize;
  const descent = (font.descent / font.unitsPerEm) * fontSize;

  const lines: LineBox[] = [];
  let offset = 0;

  // Explicit breaks are honoured first; wrapping happens inside each one.
  for (const paragraph of text.split('\n')) {
    if (input.wrapWidth === undefined) {
      lines.push({
        text: paragraph,
        width: runWidth(paragraph, font, fontSize, tracking),
        start: offset,
        end: offset + paragraph.length,
      });
    } else {
      lines.push(...wrapParagraph(paragraph, offset, input, input.wrapWidth));
    }
    offset += paragraph.length + 1;
  }

  return {
    lines,
    width: lines.reduce((widest, line) => Math.max(widest, line.width), 0),
    height: lines.length * lineHeightPt,
    ascent,
    descent,
    lineHeight: lineHeightPt,
  };
}
