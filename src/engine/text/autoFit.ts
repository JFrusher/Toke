import type { LoadedFont } from '@/engine/text/fontLoader';
import { type LineBox, measureText } from '@/engine/text/measure';
import type { Points } from '@/engine/units/types';

/**
 * Fits text to a box.
 *
 * Measures exclusively through engine/text/measure.ts, which is the same path
 * the PDF renderer uses (CLAUDE.md §2.1 rule 3). That is what makes "it fits
 * on screen" mean "it fits on the card".
 *
 * A result is never returned at a size that overflows unless `overflow` is
 * set — a silent overflow would look correct in the editor and print outside
 * the trim on every affected record.
 */

export type AutoFitMode = 'shrink' | 'truncate' | 'wrap';

export type AutoFitInput = {
  readonly text: string;
  readonly font: LoadedFont;
  readonly box: { readonly width: Points; readonly height: Points };
  readonly fontSize: Points;
  readonly minFontSize: Points;
  readonly tracking: number;
  readonly lineHeight: number;
  readonly mode: AutoFitMode;
};

export type AutoFitResult = {
  /** Possibly truncated. */
  readonly text: string;
  readonly fontSize: number;
  readonly lines: readonly LineBox[];
  /** True when the text still does not fit at the minimum size. */
  readonly overflow: boolean;
  /** Binary-search steps taken. Exposed so the budget can be asserted. */
  readonly iterations: number;
};

const ELLIPSIS = '…';

/** Within a hair of the box counts as fitting; floating point should not
 *  trigger a shrink on text that is exactly the right width. */
const EPSILON = 1e-6;

function measure(input: AutoFitInput, fontSize: number, text: string, wrap: boolean) {
  return measureText({
    text,
    font: input.font,
    fontSize: fontSize as Points,
    tracking: input.tracking,
    lineHeight: input.lineHeight,
    ...(wrap ? { wrapWidth: input.box.width } : {}),
  });
}

function fits(measured: { width: number; height: number }, input: AutoFitInput): boolean {
  return (
    measured.width <= input.box.width + EPSILON && measured.height <= input.box.height + EPSILON
  );
}

/**
 * Largest size in [min, max] that fits, by binary search.
 *
 * Decrementing one point at a time would take hundreds of measurements per
 * record; over a 500-card export that is the difference between seconds and
 * minutes.
 */
function largestFittingSize(
  input: AutoFitInput,
  text: string,
  wrap: boolean,
): { fontSize: number; iterations: number; fitted: boolean } {
  const max = input.fontSize;
  const min = input.minFontSize;

  if (fits(measure(input, max, text, wrap), input)) {
    return { fontSize: max, iterations: 0, fitted: true };
  }
  if (!fits(measure(input, min, text, wrap), input)) {
    return { fontSize: min, iterations: 1, fitted: false };
  }

  // Plain numbers: these take midpoints, which strips the Points brand.
  let low: number = min;
  let high: number = max;
  let iterations = 1;

  // Eight halvings of a 1–400pt range lands inside ~1.5pt, which is finer
  // than any size a reader could distinguish on a place card.
  const BUDGET = 8;
  while (iterations < BUDGET && high - low > 0.25) {
    const middle = (low + high) / 2;
    iterations += 1;

    if (fits(measure(input, middle, text, wrap), input)) {
      low = middle;
    } else {
      high = middle;
    }
  }

  // `low` is always known to fit; `high` may not. Returning the tested bound
  // is what guarantees the result never overflows.
  return { fontSize: low, iterations, fitted: true };
}

/**
 * Trims to a whole grapheme so a cut never lands inside a surrogate pair or
 * before a combining mark — both of which render as visible damage.
 */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map((entry) => entry.segment);
  }
  return [...text];
}

function truncateToFit(input: AutoFitInput): AutoFitResult {
  const size = input.fontSize;
  const whole = measure(input, size, input.text, false);

  if (fits(whole, input)) {
    return {
      text: input.text,
      fontSize: size,
      lines: whole.lines,
      overflow: false,
      iterations: 0,
    };
  }

  const units = graphemes(input.text);
  let best = '';

  for (let count = units.length - 1; count > 0; count -= 1) {
    const candidate = `${units.slice(0, count).join('')}${ELLIPSIS}`;
    if (fits(measure(input, size, candidate, false), input)) {
      best = candidate;
      break;
    }
  }

  const measured = measure(input, size, best === '' ? ELLIPSIS : best, false);
  return {
    text: best === '' ? ELLIPSIS : best,
    fontSize: size,
    lines: measured.lines,
    // Nothing fit, not even one grapheme plus the ellipsis.
    overflow: best === '',
    iterations: units.length,
  };
}

export function autoFit(input: AutoFitInput): AutoFitResult {
  if (input.mode === 'truncate') {
    return truncateToFit(input);
  }

  const wrap = input.mode === 'wrap';
  const search = largestFittingSize(input, input.text, wrap);
  const measured = measure(input, search.fontSize, input.text, wrap);

  return {
    text: input.text,
    fontSize: search.fontSize,
    lines: measured.lines,
    overflow: !search.fitted,
    iterations: search.iterations,
  };
}
