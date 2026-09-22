import { fromPoints } from '@/engine/units/convert';
import type { DisplayUnit, Points } from '@/engine/units/types';

/**
 * Display precision per unit. 0.01mm is already an order of magnitude finer
 * than any guillotine tolerance, so more decimals would be false precision in
 * a dense numeric field.
 */
const DEFAULT_PRECISION: Record<DisplayUnit, number> = {
  mm: 2,
  in: 3,
  pt: 2,
};

/** Bare number for a numeric input field — no unit suffix. */
export function formatNumber(value: Points, unit: DisplayUnit, precision?: number): string {
  const decimals = precision ?? DEFAULT_PRECISION[unit];
  const rounded = Number(fromPoints(value, unit).toFixed(decimals));

  // Round-to-zero of a small negative yields -0, which stringifies as "-0".
  // A width of "-0mm" in the inspector reads as a bug.
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Number plus unit suffix, e.g. "85mm". */
export function formatLength(value: Points, unit: DisplayUnit, precision?: number): string {
  return `${formatNumber(value, unit, precision)}${unit}`;
}
