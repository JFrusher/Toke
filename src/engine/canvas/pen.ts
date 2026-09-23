import { pathNode } from '@/engine/scene/factories';
import type { PathNode } from '@/engine/scene/types';
import { points } from '@/engine/units/types';

/**
 * Pen-tool geometry: anchors, handles and the SVG path they describe.
 *
 * Pure, and separate from the interaction. "Does this anchor list produce the
 * right `d`?" is arithmetic, and arithmetic belongs in a test rather than in a
 * browser where it can only be judged by eye.
 *
 * Coordinates are absolute scene points throughout. The node's `d` is relative
 * to its own box, so `toPath` subtracts the origin at the end — one conversion,
 * in one place.
 */

export type Anchor = {
  readonly x: number;
  readonly y: number;
  /**
   * Outgoing bezier handle, relative to the anchor. The incoming handle is its
   * mirror, which is what makes a dragged point smooth rather than a corner.
   */
  readonly handle: { readonly x: number; readonly y: number } | null;
};

export type PenPath = {
  readonly anchors: readonly Anchor[];
  readonly closed: boolean;
};

export const EMPTY_PATH: PenPath = { anchors: [], closed: false };

/** How near the first anchor a click must land to close the path, in screen px. */
export const CLOSE_THRESHOLD_PX = 10;

function round(value: number): number {
  // Three decimals is well under a thousandth of a point — far finer than any
  // press can hold — and keeps `d` readable in a diff.
  return Math.round(value * 1000) / 1000;
}

type Point = { readonly x: number; readonly y: number };

/** Control points of the segment from `from` to `to`, as `segment` emits them. */
function controls(from: Anchor, to: Anchor): [Point, Point, Point, Point] {
  const c1 = from.handle === null ? from : { x: from.x + from.handle.x, y: from.y + from.handle.y };
  const c2 = to.handle === null ? to : { x: to.x - to.handle.x, y: to.y - to.handle.y };
  return [from, c1, c2, to];
}

/** Parameter values in (0, 1) where one axis of a cubic turns. */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  // Derivative of the cubic is a quadratic a·t² + b·t + c.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;

  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Tight bounding box of the drawn curve, in scene points.
 *
 * Tight, not "anchors plus handles": Fabric recentres a path on its exact curve
 * bounds while the PDF draws `d` from the node origin. If the node box included
 * handle extents that the curve never reaches, the two renderers would place
 * the same path in different spots. Computing the real extrema makes the box
 * and Fabric agree, and hugs the curve for selection too.
 */
export function pathBounds(path: PenPath): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const [first] = path.anchors;
  if (first === undefined) return { x: 0, y: 0, width: 0, height: 0 };

  const xs: number[] = [first.x];
  const ys: number[] = [first.y];

  const pairs: [Anchor, Anchor][] = [];
  for (let i = 1; i < path.anchors.length; i += 1) {
    const a = path.anchors[i - 1];
    const b = path.anchors[i];
    if (a !== undefined && b !== undefined) pairs.push([a, b]);
  }
  const last = path.anchors[path.anchors.length - 1];
  if (path.closed && path.anchors.length > 1 && last !== undefined) pairs.push([last, first]);

  for (const [from, to] of pairs) {
    const [p0, p1, p2, p3] = controls(from, to);
    xs.push(p3.x);
    ys.push(p3.y);
    for (const t of extremaT(p0.x, p1.x, p2.x, p3.x)) xs.push(cubicAt(p0.x, p1.x, p2.x, p3.x, t));
    for (const t of extremaT(p0.y, p1.y, p2.y, p3.y)) ys.push(cubicAt(p0.y, p1.y, p2.y, p3.y, t));
  }

  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * SVG path data for the anchors, relative to `origin`.
 *
 * Straight segments are emitted as `L` rather than a degenerate curve: a `C`
 * with coincident control points draws identically but doubles the operator
 * count in the PDF for no gain.
 */
export function toPath(path: PenPath, origin: { x: number; y: number }): string {
  const [first, ...rest] = path.anchors;
  if (first === undefined) return '';

  const rx = (value: number) => round(value - origin.x);
  const ry = (value: number) => round(value - origin.y);

  let d = `M ${rx(first.x)} ${ry(first.y)}`;
  let previous = first;

  for (const anchor of rest) {
    d += segment(previous, anchor, rx, ry);
    previous = anchor;
  }

  if (path.closed && path.anchors.length > 1) {
    d += segment(previous, first, rx, ry);
    d += ' Z';
  }

  return d;
}

function segment(
  from: Anchor,
  to: Anchor,
  rx: (value: number) => number,
  ry: (value: number) => number,
): string {
  const straight = from.handle === null && to.handle === null;
  if (straight) return ` L ${rx(to.x)} ${ry(to.y)}`;

  // The outgoing handle of `from`, and the MIRRORED incoming handle of `to`.
  const [, c1, c2] = controls(from, to);

  return ` C ${rx(c1.x)} ${ry(c1.y)}, ${rx(c2.x)} ${ry(c2.y)}, ${rx(to.x)} ${ry(to.y)}`;
}

/** Distance between two scene points, for the close-path hit test. */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when a click at `point` should close the path rather than extend it. */
export function shouldClose(path: PenPath, point: { x: number; y: number }, zoom: number): boolean {
  const first = path.anchors[0];
  // Two anchors is a line; closing it would produce a degenerate shape that
  // draws as the same line twice.
  if (first === undefined || path.anchors.length < 3) return false;
  return distance(first, point) * zoom <= CLOSE_THRESHOLD_PX;
}

/**
 * The scene node a finished path becomes, or null if there is nothing to keep.
 *
 * One anchor is a click, not a path: committing it would leave an invisible
 * zero-size node in the layers tree that nobody could select on the canvas.
 */
export function penToNode(path: PenPath, id: string): PathNode | null {
  if (path.anchors.length < 2) return null;

  const box = pathBounds(path);
  return pathNode({
    id,
    x: points(box.x),
    y: points(box.y),
    width: points(box.width),
    height: points(box.height),
    d: toPath(path, box),
  });
}
