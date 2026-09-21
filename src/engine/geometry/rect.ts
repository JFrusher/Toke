import type { Points } from '@/engine/units/types';

/**
 * Axis-aligned rectangles in Points, origin top-left (the PDF/canvas
 * convention with y growing downward; the PDF writer flips at the boundary).
 */

export type Point = { readonly x: number; readonly y: number };

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export function rect(x: Points, y: Points, width: Points, height: Points): Rect {
  return { x, y, width, height };
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Build from two corners in any order; never yields a negative size. */
export function rectFromEdges(x1: Points, y1: Points, x2: Points, y2: Points): Rect {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return {
    x: left,
    y: top,
    width: Math.max(x1, x2) - left,
    height: Math.max(y1, y2) - top,
  };
}

export function union(a: Rect, b: Rect): Rect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    x: left,
    y: top,
    width: Math.max(rectRight(a), rectRight(b)) - left,
    height: Math.max(rectBottom(a), rectBottom(b)) - top,
  };
}

/**
 * Strict overlap. Rects that merely share an edge do NOT intersect —
 * adjacent imposition cells touch exactly under shared-cut geometry, and
 * treating that as a collision would flag every correct layout.
 */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y;
}

/** True when `inner` lies entirely within `outer`. Exact fit counts. */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) &&
    rectBottom(inner) <= rectBottom(outer)
  );
}

/**
 * Grow (or shrink, with a negative amount) on all four sides. This is how
 * bleed is applied to a trim rect. Size clamps at zero rather than inverting.
 */
export function inflate(r: Rect, amount: Points): Rect {
  return {
    x: r.x - amount,
    y: r.y - amount,
    width: Math.max(0, r.width + amount * 2),
    height: Math.max(0, r.height + amount * 2),
  };
}
