import { describe, expect, it } from 'vitest';
import { millimetresToPoints } from '@/engine/units/convert';
import {
  type Inches,
  inches,
  isDisplayUnit,
  type Millimetres,
  millimetres,
  type Points,
  points,
} from '@/engine/units/types';

/* The @ts-expect-error assertions below are the real subject of this file.
   Vitest strips types without checking them, so these pass vacuously at
   runtime — `npm run typecheck` is what enforces them. If a brand stops
   working, tsc fails with "unused @ts-expect-error directive". */

describe('constructors', () => {
  it('produce plain numbers at runtime', () => {
    expect(points(5)).toBe(5);
    expect(millimetres(85)).toBe(85);
    expect(inches(1)).toBe(1);
  });
});

describe('nominal typing (enforced by tsc, not vitest)', () => {
  it('rejects a raw number assigned to Points', () => {
    // @ts-expect-error a bare number must not be assignable to Points
    const p: Points = 5;
    expect(p).toBe(5);
  });

  it('rejects Millimetres assigned to Points', () => {
    // @ts-expect-error unit types must not be interchangeable
    const p: Points = millimetres(85);
    expect(p).toBe(85);
  });

  it('rejects Points assigned to Inches', () => {
    // @ts-expect-error unit types must not be interchangeable
    const i: Inches = points(72);
    expect(i).toBe(72);
  });

  it('rejects Inches assigned to Millimetres', () => {
    // @ts-expect-error unit types must not be interchangeable
    const m: Millimetres = inches(1);
    expect(m).toBe(1);
  });

  it('rejects a bare number passed to a converter', () => {
    // @ts-expect-error millimetresToPoints must not accept an unbranded number
    expect(millimetresToPoints(210)).toBeCloseTo(595.2755905511812, 9);
  });

  it('allows a correctly branded value through a converter', () => {
    expect(millimetresToPoints(millimetres(210))).toBeCloseTo(595.2755905511812, 9);
  });
});

describe('isDisplayUnit', () => {
  it('accepts the three supported units', () => {
    expect(isDisplayUnit('mm')).toBe(true);
    expect(isDisplayUnit('in')).toBe(true);
    expect(isDisplayUnit('pt')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isDisplayUnit('cm')).toBe(false);
    expect(isDisplayUnit('')).toBe(false);
    expect(isDisplayUnit(undefined)).toBe(false);
  });
});
