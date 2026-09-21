import { describe, expect, it } from 'vitest';
import {
  fromPoints,
  inchesToPoints,
  MM_PER_INCH,
  millimetresToPoints,
  POINTS_PER_INCH,
  POINTS_PER_MM,
  pointsToInches,
  pointsToMillimetres,
  toPoints,
} from '@/engine/units/convert';
import { inches, millimetres, points } from '@/engine/units/types';

const EPSILON = 1e-9;

describe('constants', () => {
  it('defines a point as 1/72 inch', () => {
    expect(POINTS_PER_INCH).toBe(72);
  });

  it('defines an inch as 25.4mm', () => {
    expect(MM_PER_INCH).toBe(25.4);
  });

  it('derives points-per-mm rather than hardcoding it', () => {
    expect(POINTS_PER_MM).toBeCloseTo(2.834645669291339, 12);
  });
});

describe('millimetresToPoints', () => {
  it('converts an A4 width', () => {
    expect(millimetresToPoints(millimetres(210))).toBeCloseTo(595.2755905511812, 9);
  });

  it('converts an A4 height', () => {
    expect(millimetresToPoints(millimetres(297))).toBeCloseTo(841.8897637795277, 9);
  });

  it('converts a place-card trim width', () => {
    expect(millimetresToPoints(millimetres(85))).toBeCloseTo(240.94488188976382, 9);
  });

  it('converts zero to zero', () => {
    expect(millimetresToPoints(millimetres(0))).toBe(0);
  });

  it('preserves sign for negative offsets', () => {
    expect(millimetresToPoints(millimetres(-3))).toBeCloseTo(-8.503937007874017, 9);
  });
});

describe('inchesToPoints', () => {
  it('converts one inch to 72 points', () => {
    expect(inchesToPoints(inches(1))).toBe(72);
  });

  it('converts a 0.125in bleed', () => {
    expect(inchesToPoints(inches(0.125))).toBe(9);
  });

  it('converts US Letter width', () => {
    expect(inchesToPoints(inches(8.5))).toBe(612);
  });
});

describe('round trips', () => {
  const samples = [0, 1, 3, 85, 105.5, 210, 297, -42.125, 0.001, 9999.999];

  it.each(samples)('mm -> pt -> mm is lossless for %p', (value) => {
    const roundTripped = pointsToMillimetres(millimetresToPoints(millimetres(value)));
    expect(Math.abs(roundTripped - value)).toBeLessThan(EPSILON);
  });

  it.each(samples)('in -> pt -> in is lossless for %p', (value) => {
    const roundTripped = pointsToInches(inchesToPoints(inches(value)));
    expect(Math.abs(roundTripped - value)).toBeLessThan(EPSILON);
  });

  it.each(samples)('pt -> mm -> pt is lossless for %p', (value) => {
    const roundTripped = millimetresToPoints(pointsToMillimetres(points(value)));
    expect(Math.abs(roundTripped - value)).toBeLessThan(EPSILON);
  });
});

describe('toPoints / fromPoints', () => {
  it('converts from each display unit', () => {
    expect(toPoints(1, 'in')).toBe(72);
    expect(toPoints(24, 'pt')).toBe(24);
    expect(toPoints(25.4, 'mm')).toBeCloseTo(72, 9);
  });

  it('converts back to each display unit', () => {
    expect(fromPoints(points(72), 'in')).toBeCloseTo(1, 9);
    expect(fromPoints(points(24), 'pt')).toBe(24);
    expect(fromPoints(points(72), 'mm')).toBeCloseTo(25.4, 9);
  });

  it('round trips through every display unit', () => {
    for (const unit of ['mm', 'in', 'pt'] as const) {
      const back = fromPoints(toPoints(123.456, unit), unit);
      expect(Math.abs(back - 123.456)).toBeLessThan(EPSILON);
    }
  });
});
