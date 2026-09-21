import { describe, expect, it } from 'vitest';
import {
  contains,
  inflate,
  intersects,
  rect,
  rectBottom,
  rectCentre,
  rectFromEdges,
  rectRight,
  union,
} from '@/engine/geometry/rect';
import { points } from '@/engine/units/types';

const p = points;

describe('rect', () => {
  it('stores x, y, width and height in points', () => {
    const r = rect(p(10), p(20), p(85), p(55));
    expect(r).toEqual({ x: 10, y: 20, width: 85, height: 55 });
  });

  it('derives the right and bottom edges', () => {
    const r = rect(p(10), p(20), p(85), p(55));
    expect(rectRight(r)).toBe(95);
    expect(rectBottom(r)).toBe(75);
  });

  it('derives the centre', () => {
    const r = rect(p(0), p(0), p(85), p(55));
    expect(rectCentre(r)).toEqual({ x: 42.5, y: 27.5 });
  });
});

describe('rectFromEdges', () => {
  it('builds a rect from two corners', () => {
    expect(rectFromEdges(p(10), p(20), p(95), p(75))).toEqual({
      x: 10,
      y: 20,
      width: 85,
      height: 55,
    });
  });

  it('normalises reversed corners rather than producing a negative size', () => {
    expect(rectFromEdges(p(95), p(75), p(10), p(20))).toEqual({
      x: 10,
      y: 20,
      width: 85,
      height: 55,
    });
  });
});

describe('union', () => {
  it('encloses both rects', () => {
    const a = rect(p(0), p(0), p(10), p(10));
    const b = rect(p(20), p(30), p(10), p(10));
    expect(union(a, b)).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });

  it('returns an equal rect when one contains the other', () => {
    const outer = rect(p(0), p(0), p(100), p(100));
    const inner = rect(p(10), p(10), p(10), p(10));
    expect(union(outer, inner)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('handles zero-size rects without collapsing the result', () => {
    const a = rect(p(10), p(10), p(0), p(0));
    const b = rect(p(20), p(20), p(5), p(5));
    expect(union(a, b)).toEqual({ x: 10, y: 10, width: 15, height: 15 });
  });
});

describe('intersects', () => {
  it('is true for overlapping rects', () => {
    expect(intersects(rect(p(0), p(0), p(10), p(10)), rect(p(5), p(5), p(10), p(10)))).toBe(true);
  });

  it('is false for separated rects', () => {
    expect(intersects(rect(p(0), p(0), p(10), p(10)), rect(p(20), p(0), p(10), p(10)))).toBe(false);
  });

  it('is false for rects that merely share an edge', () => {
    // Adjacent imposition cells touch exactly. Treating that as an overlap
    // would make every shared-cut layout report a collision.
    expect(intersects(rect(p(0), p(0), p(10), p(10)), rect(p(10), p(0), p(10), p(10)))).toBe(false);
  });
});

describe('contains', () => {
  it('is true for a fully enclosed rect', () => {
    expect(contains(rect(p(0), p(0), p(100), p(100)), rect(p(10), p(10), p(10), p(10)))).toBe(true);
  });

  it('is true when the inner rect exactly fills the outer', () => {
    expect(contains(rect(p(0), p(0), p(10), p(10)), rect(p(0), p(0), p(10), p(10)))).toBe(true);
  });

  it('is false when the inner rect pokes out by any amount', () => {
    expect(contains(rect(p(0), p(0), p(10), p(10)), rect(p(0), p(0), p(10.001), p(10)))).toBe(
      false,
    );
  });
});

describe('inflate', () => {
  it('grows a rect on all four sides — this is how bleed is applied', () => {
    const trim = rect(p(10), p(10), p(85), p(55));
    expect(inflate(trim, p(3))).toEqual({ x: 7, y: 7, width: 91, height: 61 });
  });

  it('shrinks with a negative amount', () => {
    expect(inflate(rect(p(10), p(10), p(85), p(55)), p(-5))).toEqual({
      x: 15,
      y: 15,
      width: 75,
      height: 45,
    });
  });

  it('clamps to zero rather than producing a negative size', () => {
    const r = inflate(rect(p(0), p(0), p(10), p(10)), p(-20));
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });
});
