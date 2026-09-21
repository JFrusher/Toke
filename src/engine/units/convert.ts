import {
  type DisplayUnit,
  type Inches,
  inches,
  type Millimetres,
  millimetres,
  type Points,
  points,
} from '@/engine/units/types';

export const POINTS_PER_INCH = 72;
export const MM_PER_INCH = 25.4;

/** Derived, never hardcoded: 2.834645669291339… */
export const POINTS_PER_MM = POINTS_PER_INCH / MM_PER_INCH;

export function millimetresToPoints(value: Millimetres): Points {
  return points(value * POINTS_PER_MM);
}

export function pointsToMillimetres(value: Points): Millimetres {
  return millimetres(value / POINTS_PER_MM);
}

export function inchesToPoints(value: Inches): Points {
  return points(value * POINTS_PER_INCH);
}

export function pointsToInches(value: Points): Inches {
  return inches(value / POINTS_PER_INCH);
}

/** Edge conversion: a raw number the user typed, in their display unit. */
export function toPoints(value: number, unit: DisplayUnit): Points {
  switch (unit) {
    case 'mm':
      return millimetresToPoints(millimetres(value));
    case 'in':
      return inchesToPoints(inches(value));
    case 'pt':
      return points(value);
  }
}

/** Edge conversion: Points out to a raw number for display. */
export function fromPoints(value: Points, unit: DisplayUnit): number {
  switch (unit) {
    case 'mm':
      return pointsToMillimetres(value);
    case 'in':
      return pointsToInches(value);
    case 'pt':
      return value;
  }
}
