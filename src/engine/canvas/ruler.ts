import { fromPoints, toPoints } from '@/engine/units/convert';
import type { DisplayUnit, Points } from '@/engine/units/types';

/**
 * Ruler tick placement.
 *
 * Pure, and deliberately not in the component: "ticks stay legible from 10% to
 * 1600%" is a claim about arithmetic, and arithmetic is cheaper to prove in a
 * test than to eyeball at eight zoom levels.
 *
 * Steps are chosen in the DISPLAY unit, not in points. A ruler in millimetres
 * must land on whole millimetres; deriving the step from points and converting
 * gives 0.35mm gridlines, which is not a ruler anybody can read against.
 */

export type RulerTick = {
  /** Scene position, in points. */
  readonly positionPt: Points;
  /** Set on labelled ticks; `null` on the subdivisions between them. */
  readonly label: string | null;
};

/**
 * Step ladders, in each unit's own terms.
 *
 * Inches subdivide in halves rather than the 1-2-5 decimal run, because an
 * imperial ruler reads in sixteenths and a 0.2in tick is meaningless to the
 * person holding it.
 */
const LADDERS: Record<DisplayUnit, readonly number[]> = {
  mm: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
  in: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 6, 12, 36],
  pt: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
};

/** Labels need room for their own text; subdivisions only need to be distinct. */
const MIN_LABEL_PX = 56;
const MIN_MINOR_PX = 6;

/** Guards against a pathological zoom producing an unbounded list. */
const MAX_TICKS = 2000;

/** How many subdivisions a labelled step is cut into, tried widest first. */
const SUBDIVISIONS = [10, 8, 5, 4, 2] as const;

function labelFor(valueInUnit: number, unit: DisplayUnit): string {
  // Trailing zeroes are noise on a ruler: 10, not 10.00. Sixteenths of an inch
  // still need their decimals, so the precision is derived from the value.
  const rounded = Math.round(valueInUnit * 1000) / 1000;
  return unit === 'in' && !Number.isInteger(rounded)
    ? String(rounded)
    : String(Math.round(rounded * 100) / 100);
}

/**
 * The labelled step for this zoom, in display units.
 *
 * Exported for the tests: whether the ladder degrades sensibly is the whole
 * behaviour, and asserting it through generated ticks would be indirect.
 */
export function labelStep(zoom: number, unit: DisplayUnit): number {
  const ladder = LADDERS[unit];
  const last = ladder[ladder.length - 1] ?? 1;

  for (const step of ladder) {
    const stepPt = toPoints(step, unit);
    if (stepPt * zoom >= MIN_LABEL_PX) return step;
  }

  // Past the top of the ladder, keep doubling rather than crowding labels.
  let step = last;
  while (toPoints(step, unit) * zoom < MIN_LABEL_PX && step < last * 4096) step *= 2;
  return step;
}

/** The finest subdivision of `step` that still reads at this zoom. */
export function minorStep(step: number, zoom: number, unit: DisplayUnit): number {
  for (const divisions of SUBDIVISIONS) {
    const candidate = step / divisions;
    if (toPoints(candidate, unit) * zoom >= MIN_MINOR_PX) return candidate;
  }
  return step;
}

/**
 * Ticks covering a scene range, in points.
 *
 * `fromPt` and `toPt` are the scene coordinates at the two ends of the ruler,
 * so panning is expressed entirely by the caller and this function has no
 * opinion about the viewport.
 */
export function rulerTicks(input: {
  readonly fromPt: number;
  readonly toPt: number;
  /** Screen pixels per point. */
  readonly zoom: number;
  readonly unit: DisplayUnit;
}): readonly RulerTick[] {
  const { fromPt, toPt, zoom, unit } = input;

  if (!Number.isFinite(fromPt) || !Number.isFinite(toPt) || toPt <= fromPt) return [];
  if (!Number.isFinite(zoom) || zoom <= 0) return [];

  const step = labelStep(zoom, unit);
  const minor = minorStep(step, zoom, unit);

  const from = fromPoints(fromPt as Points, unit);
  const to = fromPoints(toPt as Points, unit);

  // Started at a whole multiple of the minor step so ticks sit on round
  // numbers regardless of where the viewport happens to begin.
  const first = Math.floor(from / minor) * minor;
  const ticks: RulerTick[] = [];

  for (let value = first; value <= to && ticks.length < MAX_TICKS; value += minor) {
    // Compared against a fraction of the minor step rather than an absolute
    // epsilon: at 1/16in the steps are tiny, and a fixed tolerance would label
    // every subdivision.
    const remainder = Math.abs(value / step - Math.round(value / step));
    const isLabelled = remainder < 1e-6;

    ticks.push({
      positionPt: toPoints(value, unit),
      label: isLabelled ? labelFor(Math.round(value / step) * step, unit) : null,
    });
  }

  return ticks;
}
