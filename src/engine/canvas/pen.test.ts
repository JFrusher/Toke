/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { type Anchor, pathBounds, penToNode, shouldClose, toPath } from '@/engine/canvas/pen';

const at = (x: number, y: number, handle: { x: number; y: number } | null = null): Anchor => ({
  x,
  y,
  handle,
});

const ORIGIN = { x: 0, y: 0 };

describe('toPath', () => {
  it('is empty for no anchors', () => {
    expect(toPath({ anchors: [], closed: false }, ORIGIN)).toBe('');
  });

  it('moves to a single anchor without drawing', () => {
    expect(toPath({ anchors: [at(10, 20)], closed: false }, ORIGIN)).toBe('M 10 20');
  });

  it('joins corner anchors with straight lines', () => {
    // L, not a degenerate C: a curve with coincident control points draws
    // identically and doubles the operator count in the PDF.
    const d = toPath({ anchors: [at(0, 0), at(10, 0), at(10, 10)], closed: false }, ORIGIN);
    expect(d).toBe('M 0 0 L 10 0 L 10 10');
    expect(d).not.toContain('C');
  });

  it('emits a cubic when either end has a handle', () => {
    const d = toPath({ anchors: [at(0, 0, { x: 5, y: 0 }), at(20, 0)], closed: false }, ORIGIN);
    expect(d).toBe('M 0 0 C 5 0, 20 0, 20 0');
  });

  it('mirrors the incoming handle so a dragged point is smooth', () => {
    // The second anchor's handle points forward; its incoming control must be
    // the reflection, or the curve kinks at every point the user dragged.
    const d = toPath(
      { anchors: [at(0, 0, { x: 10, y: 0 }), at(40, 0, { x: 10, y: 0 })], closed: false },
      ORIGIN,
    );
    expect(d).toBe('M 0 0 C 10 0, 30 0, 40 0');
  });

  it('closes back to the first anchor', () => {
    const d = toPath({ anchors: [at(0, 0), at(10, 0), at(10, 10)], closed: true }, ORIGIN);
    expect(d).toBe('M 0 0 L 10 0 L 10 10 L 0 0 Z');
  });

  it('does not close a path of one anchor', () => {
    expect(toPath({ anchors: [at(5, 5)], closed: true }, ORIGIN)).toBe('M 5 5');
  });

  it('is relative to the origin it is given', () => {
    // The node's `d` lives in its own box, so the origin subtracts once here
    // rather than at every consumer.
    const d = toPath({ anchors: [at(110, 220), at(120, 220)], closed: false }, { x: 100, y: 200 });
    expect(d).toBe('M 10 20 L 20 20');
  });

  it('rounds to a precision finer than any press can hold', () => {
    const d = toPath({ anchors: [at(1 / 3, 2 / 3)], closed: false }, ORIGIN);
    expect(d).toBe('M 0.333 0.667');
  });
});

describe('pathBounds', () => {
  it('is empty for no anchors', () => {
    expect(pathBounds({ anchors: [], closed: false })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('covers the anchors', () => {
    const box = pathBounds({ anchors: [at(10, 20), at(40, 60)], closed: false });
    expect(box).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('contains the curve, not just the anchors', () => {
    // Both anchors sit on y = 0 but the handle bows the curve down. A box drawn
    // from anchors alone would have zero height and clip the whole curve.
    const box = pathBounds({ anchors: [at(0, 0, { x: 0, y: 30 }), at(100, 0)], closed: false });
    expect(box.y).toBeCloseTo(0, 6);
    // Peak of 3(1-t)²t·30 is at t = 1/3: 30 · 4/9.
    expect(box.height).toBeCloseTo(40 / 3, 6);
  });

  it('hugs the curve rather than the handles', () => {
    // Fabric recentres a path on its tight curve bounds. If ours included the
    // handle tip (y = 30), canvas and PDF would place the path differently.
    const box = pathBounds({ anchors: [at(0, 0, { x: 0, y: 30 }), at(100, 0)], closed: false });
    expect(box.height).toBeLessThan(30);
  });

  it('includes the closing segment of a closed path', () => {
    const open = pathBounds({ anchors: [at(0, 0), at(50, 0, { x: 0, y: 40 })], closed: false });
    const closed = pathBounds({ anchors: [at(0, 0), at(50, 0, { x: 0, y: 40 })], closed: true });
    expect(closed.height).toBeGreaterThan(0);
    expect(open.width).toBe(50);
  });

  it('handles a single anchor without producing NaN', () => {
    expect(pathBounds({ anchors: [at(7, 9)], closed: false })).toEqual({
      x: 7,
      y: 9,
      width: 0,
      height: 0,
    });
  });
});

describe('shouldClose', () => {
  const triangle = { anchors: [at(0, 0), at(50, 0), at(50, 50)], closed: false };

  it('closes when the click lands on the first anchor', () => {
    expect(shouldClose(triangle, { x: 1, y: 1 }, 1)).toBe(true);
  });

  it('does not close for a click elsewhere', () => {
    expect(shouldClose(triangle, { x: 40, y: 40 }, 1)).toBe(false);
  });

  it('measures the threshold in screen pixels, not scene points', () => {
    // At 8x zoom a point 5 scene units away is 40 screen pixels away — well
    // outside the grab radius the user perceives.
    expect(shouldClose(triangle, { x: 5, y: 0 }, 1)).toBe(true);
    expect(shouldClose(triangle, { x: 5, y: 0 }, 8)).toBe(false);
  });

  it('refuses to close fewer than three anchors', () => {
    // Two anchors closed is the same line drawn twice.
    expect(shouldClose({ anchors: [at(0, 0), at(10, 0)], closed: false }, { x: 0, y: 0 }, 1)).toBe(
      false,
    );
    expect(shouldClose({ anchors: [], closed: false }, { x: 0, y: 0 }, 1)).toBe(false);
  });
});

describe('penToNode', () => {
  it('discards a single click', () => {
    // One anchor would be an invisible zero-size node nobody could select.
    expect(penToNode({ anchors: [at(10, 10)], closed: false }, 'p')).toBeNull();
    expect(penToNode({ anchors: [], closed: false }, 'p')).toBeNull();
  });

  it('places the node at the path bounds with d relative to them', () => {
    const node = penToNode({ anchors: [at(110, 220), at(150, 260)], closed: false }, 'p');
    expect(node).not.toBeNull();
    expect(node?.x).toBe(110);
    expect(node?.y).toBe(220);
    expect(node?.width).toBe(40);
    expect(node?.height).toBe(40);
    // `d` starts at the node origin, so the PDF renderer can draw it from x, y.
    expect(node?.d).toBe('M 0 0 L 40 40');
  });

  it('keeps a closed path closed', () => {
    const node = penToNode({ anchors: [at(0, 0), at(10, 0), at(10, 10)], closed: true }, 'p');
    expect(node?.d.endsWith('Z')).toBe(true);
  });

  it('is stroked and unfilled by default, so an open path draws as a line', () => {
    const node = penToNode({ anchors: [at(0, 0), at(10, 0)], closed: false }, 'p');
    expect(node?.fill.kind).toBe('none');
    expect(node?.stroke.kind).toBe('solid');
  });
});
