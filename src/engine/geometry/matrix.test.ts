import { describe, expect, it } from 'vitest';
import {
  applyToPoint,
  compose,
  identity,
  invert,
  rotate,
  scale,
  transformRect,
  translate,
} from '@/engine/geometry/matrix';
import { rect } from '@/engine/geometry/rect';
import { points } from '@/engine/units/types';
import { isErr, isOk } from '@/lib/result';

const p = points;
const QUARTER_TURN = Math.PI / 2;
const EIGHTH_TURN = Math.PI / 4;

function expectClose(actual: number, expected: number, epsilon = 1e-10) {
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon);
}

describe('identity', () => {
  it('is the SVG/canvas [a b c d e f] identity', () => {
    expect(identity()).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });

  it('leaves a point untouched', () => {
    expect(applyToPoint(identity(), { x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });
});

describe('translate', () => {
  it('offsets a point', () => {
    expect(applyToPoint(translate(p(10), p(20)), { x: 1, y: 2 })).toEqual({ x: 11, y: 22 });
  });
});

describe('scale', () => {
  it('scales a point about the origin', () => {
    expect(applyToPoint(scale(2, 3), { x: 4, y: 5 })).toEqual({ x: 8, y: 15 });
  });
});

describe('rotate', () => {
  it('rotates a quarter turn', () => {
    const r = applyToPoint(rotate(QUARTER_TURN), { x: 1, y: 0 });
    expectClose(r.x, 0);
    expectClose(r.y, 1);
  });

  it('rotates a half turn — the tent-fold back panel', () => {
    const r = applyToPoint(rotate(Math.PI), { x: 1, y: 0 });
    expectClose(r.x, -1);
    expectClose(r.y, 0);
  });
});

describe('compose', () => {
  it('applies the first matrix then the second', () => {
    // Scale then translate: (2,2) -> scaled (4,4) -> translated (14,4)
    const m = compose(scale(2, 2), translate(p(10), p(0)));
    expect(applyToPoint(m, { x: 2, y: 2 })).toEqual({ x: 14, y: 4 });
  });

  it('is order dependent', () => {
    // Translate then scale: (2,2) -> translated (12,2) -> scaled (24,4)
    const m = compose(translate(p(10), p(0)), scale(2, 2));
    expect(applyToPoint(m, { x: 2, y: 2 })).toEqual({ x: 24, y: 4 });
  });

  it('composes any number of matrices', () => {
    const m = compose(translate(p(5), p(5)), scale(2, 2), translate(p(-10), p(-10)));
    expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('returns identity for no arguments', () => {
    expect(compose()).toEqual(identity());
  });
});

describe('invert', () => {
  it('round trips a point through a composed transform', () => {
    const m = compose(translate(p(10), p(20)), rotate(EIGHTH_TURN), scale(2, 3));
    const inverse = invert(m);
    if (!isOk(inverse)) {
      throw new Error('expected an invertible matrix');
    }

    const original = { x: 12.5, y: -7.25 };
    const there = applyToPoint(m, original);
    const back = applyToPoint(inverse.value, there);

    expectClose(back.x, original.x);
    expectClose(back.y, original.y);
  });

  it('composing a matrix with its inverse yields identity', () => {
    const m = compose(translate(p(10), p(20)), rotate(EIGHTH_TURN), scale(2, 3));
    const inverse = invert(m);
    if (!isOk(inverse)) {
      throw new Error('expected an invertible matrix');
    }

    const round = compose(m, inverse.value);
    const id = identity();
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      expectClose(round[key], id[key]);
    }
  });

  it('reports a singular matrix rather than returning Infinity', () => {
    // Reachable from the UI: scaling an object to zero width.
    const result = invert(scale(0, 1));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('SINGULAR_MATRIX');
    }
  });
});

describe('transformRect', () => {
  it('is a no-op under identity', () => {
    const r = rect(p(10), p(20), p(85), p(55));
    expect(transformRect(identity(), r)).toEqual(r);
  });

  it('translates', () => {
    const r = rect(p(0), p(0), p(85), p(55));
    expect(transformRect(translate(p(10), p(20)), r)).toEqual({
      x: 10,
      y: 20,
      width: 85,
      height: 55,
    });
  });

  it('returns the enlarged bounding box of a rotated rect, not a corner pair', () => {
    // 10x10 rotated 45 degrees spans 10*sqrt(2) on both axes. A naive
    // transform of only the top-left and bottom-right corners would report
    // a zero-width box here, which is the classic bug.
    const r = rect(p(0), p(0), p(10), p(10));
    const out = transformRect(rotate(EIGHTH_TURN), r);
    const diagonal = 10 * Math.SQRT2;

    expectClose(out.width, diagonal, 1e-9);
    expectClose(out.height, diagonal, 1e-9);
    expectClose(out.x, -diagonal / 2, 1e-9);
    expectClose(out.y, 0, 1e-9);
  });

  it('a quarter turn swaps width and height', () => {
    const out = transformRect(rotate(QUARTER_TURN), rect(p(0), p(0), p(85), p(55)));
    expectClose(out.width, 55, 1e-9);
    expectClose(out.height, 85, 1e-9);
  });

  it('handles a zero-size rect', () => {
    const out = transformRect(rotate(EIGHTH_TURN), rect(p(5), p(5), p(0), p(0)));
    expectClose(out.width, 0);
    expectClose(out.height, 0);
  });
});
