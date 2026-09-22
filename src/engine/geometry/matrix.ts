import type { Point, Rect } from '@/engine/geometry/rect';
import type { Points } from '@/engine/units/types';
import { appError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

/**
 * 2D affine transform in the SVG / canvas `[a b c d e f]` convention, which is
 * also what Fabric and pdf-lib speak — so no translation layer is needed at
 * either boundary.
 *
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */
export type Matrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export function identity(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function translate(tx: Points, ty: Points): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scale(sx: number, sy: number): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function rotate(radians: number): Matrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Apply `first` then `second`. */
function multiply(first: Matrix, second: Matrix): Matrix {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    e: second.a * first.e + second.c * first.f + second.e,
    f: second.b * first.e + second.d * first.f + second.f,
  };
}

/**
 * Compose in application order: `compose(a, b, c)` applies a, then b, then c.
 * Chosen over the mathematical right-to-left convention because every call
 * site here reads as a pipeline.
 */
export function compose(...matrices: readonly Matrix[]): Matrix {
  return matrices.reduce(multiply, identity());
}

export function invert(m: Matrix): Result<Matrix> {
  const determinant = m.a * m.d - m.b * m.c;

  // Reachable from the UI by scaling an object to zero on either axis.
  // Returning a matrix full of Infinity would corrupt geometry silently.
  if (determinant === 0 || !Number.isFinite(determinant)) {
    return err(
      appError('SINGULAR_MATRIX', 'Transform cannot be inverted (zero determinant).', {
        hint: 'An object has been scaled to zero width or height.',
      }),
    );
  }

  return ok({
    a: m.d / determinant,
    b: -m.b / determinant,
    c: -m.c / determinant,
    d: m.a / determinant,
    e: (m.c * m.f - m.d * m.e) / determinant,
    f: (m.b * m.e - m.a * m.f) / determinant,
  });
}

export function applyToPoint(m: Matrix, point: Point): Point {
  return {
    x: m.a * point.x + m.c * point.y + m.e,
    y: m.b * point.x + m.d * point.y + m.f,
  };
}

/**
 * Axis-aligned bounding box of the transformed rectangle.
 *
 * All FOUR corners are transformed. Transforming only two opposite corners is
 * the classic bug: under rotation it reports a box that is too small, and at
 * 45° it can collapse to zero width.
 */
export function transformRect(m: Matrix, r: Rect): Rect {
  const corners: readonly Point[] = [
    applyToPoint(m, { x: r.x, y: r.y }),
    applyToPoint(m, { x: r.x + r.width, y: r.y }),
    applyToPoint(m, { x: r.x + r.width, y: r.y + r.height }),
    applyToPoint(m, { x: r.x, y: r.y + r.height }),
  ];

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}
