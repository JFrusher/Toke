import { describe, expect, it } from 'vitest';
import { type Guide, snap, snapTargets } from '@/engine/canvas/snapping';
import { rectNode } from '@/engine/scene/factories';
import { points } from '@/engine/units/types';

const p = points;
const ARTBOARD = { x: 0, y: 0, width: 200, height: 100 };

function box(id: string, x: number, y: number, w = 20, h = 20) {
  return rectNode({ id, x: p(x), y: p(y), width: p(w), height: p(h) });
}

/** 4 screen px at 100% zoom = 4pt. At 400% it must still be 4 screen px = 1pt. */
const AT_100 = { threshold: 4, zoom: 1 };

describe('snapTargets', () => {
  it('offers the artboard edges and centre', () => {
    const targets = snapTargets([], ARTBOARD, []);
    expect(targets.vertical).toEqual(expect.arrayContaining([0, 100, 200]));
    expect(targets.horizontal).toEqual(expect.arrayContaining([0, 50, 100]));
  });

  it('offers each other object edge and centre', () => {
    const targets = snapTargets([box('a', 40, 0)], ARTBOARD, []);
    expect(targets.vertical).toEqual(expect.arrayContaining([40, 50, 60]));
  });

  it('offers user guides', () => {
    const guides: Guide[] = [{ id: 'g', axis: 'vertical', position: p(123) }];
    expect(snapTargets([], ARTBOARD, guides).vertical).toContain(123);
  });

  it('excludes the node being dragged from its own targets', () => {
    // Otherwise every object snaps to itself and can never be moved.
    const moving = box('m', 40, 0);
    const targets = snapTargets([moving], ARTBOARD, [], 'm');
    expect(targets.vertical).not.toContain(40);
  });
});

describe('snap', () => {
  const targets = snapTargets([box('a', 100, 0)], ARTBOARD, []);

  it('snaps a near edge onto a target', () => {
    const result = snap(box('m', 98, 0), targets, AT_100);
    expect(result.rect.x).toBe(100);
  });

  it('leaves a distant edge alone', () => {
    // 45,62 is clear of every target on both axes. An earlier version used
    // 80,0 — whose right edge sits exactly on the target at 100, so it
    // snapped with a zero offset and the test proved nothing.
    const result = snap(box('m', 45, 62), targets, AT_100);
    expect(result.rect).toMatchObject({ x: 45, y: 62 });
    expect(result.matches).toEqual([]);
  });

  it('reports which target it snapped to, for the indicator', () => {
    const result = snap(box('m', 98, 0), targets, AT_100);
    expect(result.matches).toEqual(
      expect.arrayContaining([{ axis: 'vertical', position: 100, edge: 'start' }]),
    );
  });

  it('snaps the trailing edge as well as the leading one', () => {
    // A 20-wide box at x=78 has its right edge at 98, 2 from the target.
    const result = snap(box('m', 78, 0), targets, AT_100);
    expect(result.rect.x).toBe(80);
  });

  it('snaps the centre', () => {
    // Box centre at 88 + 10 = 98, 2 from the target at 100.
    const result = snap(box('m', 88, 0), targets, AT_100);
    expect(result.rect.x).toBe(90);
  });

  it('prefers the nearest candidate when several are in range', () => {
    const crowded = { vertical: [99, 103], horizontal: [] };
    const result = snap(box('m', 100, 0), crowded, AT_100);
    expect(result.rect.x).toBe(99);
  });

  it('resolves a tie toward the leading edge, deterministically', () => {
    // Documented precedence: start, then end, then centre. A tie must not
    // depend on iteration order, or a drag would jitter between candidates.
    const tie = { vertical: [98, 118], horizontal: [] };
    const result = snap(box('m', 100, 0), tie, AT_100);
    expect(result.rect.x).toBe(98);
  });

  it('snaps both axes independently', () => {
    const both = { vertical: [100], horizontal: [50] };
    const result = snap(box('m', 98, 48), both, AT_100);
    expect(result.rect).toMatchObject({ x: 100, y: 50 });
  });
});

describe('threshold is constant in screen pixels', () => {
  it('covers 4pt at 100% zoom', () => {
    const targets = { vertical: [100], horizontal: [] };
    expect(snap(box('m', 97, 0), targets, { threshold: 4, zoom: 1 }).rect.x).toBe(100);
  });

  it('covers only 1pt at 400% zoom', () => {
    // The user is looking at a magnified view; 4 screen px is a quarter of the
    // document distance. A fixed document-space threshold would feel sticky
    // when zoomed in and useless when zoomed out.
    const targets = { vertical: [100], horizontal: [] };
    expect(snap(box('m', 97, 0), targets, { threshold: 4, zoom: 4 }).rect.x).toBe(97);
    expect(snap(box('m', 99.5, 0), targets, { threshold: 4, zoom: 4 }).rect.x).toBe(100);
  });

  it('covers 8pt at 50% zoom', () => {
    const targets = { vertical: [100], horizontal: [] };
    // Deliberately 100 wide so only the START edge is anywhere near the
    // target: with a 20-wide box the centre lands closer and wins, which is
    // correct behaviour but tests the wrong thing.
    const wide = box('m', 93, 0, 100, 20);

    expect(snap(wide, targets, { threshold: 4, zoom: 0.5 }).rect.x).toBe(100);
    // Same 7pt gap is out of range once the tolerance drops to 4.
    expect(snap(wide, targets, { threshold: 4, zoom: 1 }).rect.x).toBe(93);
  });
});

describe('suspension', () => {
  it('returns the rect untouched when snapping is off', () => {
    const targets = { vertical: [100], horizontal: [] };
    const result = snap(box('m', 99, 0), targets, { ...AT_100, enabled: false });
    expect(result.rect.x).toBe(99);
    expect(result.matches).toEqual([]);
  });
});
