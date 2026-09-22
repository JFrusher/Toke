/**
 * Branded length units.
 *
 * Everything internal to toke is stored in Points (CLAUDE.md §6). These brands
 * exist so that a millimetre value cannot silently reach a function expecting
 * points — the single most likely source of geometry bugs in a print tool, and
 * one that produces plausible-looking output rather than a crash.
 *
 * The brand is type-only: at runtime these are ordinary numbers.
 */

declare const UNIT_BRAND: unique symbol;

export type Points = number & { readonly [UNIT_BRAND]: 'pt' };
export type Millimetres = number & { readonly [UNIT_BRAND]: 'mm' };
export type Inches = number & { readonly [UNIT_BRAND]: 'in' };

/** The units a user may see and type. Storage is always Points. */
export type DisplayUnit = 'mm' | 'in' | 'pt';

export const DISPLAY_UNITS: readonly DisplayUnit[] = ['mm', 'in', 'pt'];

export function points(value: number): Points {
  return value as Points;
}

export function millimetres(value: number): Millimetres {
  return value as Millimetres;
}

export function inches(value: number): Inches {
  return value as Inches;
}

export function isDisplayUnit(value: unknown): value is DisplayUnit {
  return typeof value === 'string' && (DISPLAY_UNITS as readonly string[]).includes(value);
}
