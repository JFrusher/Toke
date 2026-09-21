import { describe, expect, it } from 'vitest';
import {
  alignNodes,
  distributeNodes,
  groupSelection,
  reorder,
  ungroupSelection,
} from '@/engine/canvas/arrange';
import { groupNode, rectNode } from '@/engine/scene/factories';
import type { SceneNode } from '@/engine/scene/types';
import { points } from '@/engine/units/types';

const p = points;

function box(id: string, x: number, y: number, w = 10, h = 10): SceneNode {
  return rectNode({ id, x: p(x), y: p(y), width: p(w), height: p(h) });
}

const ARTBOARD = { x: 0, y: 0, width: 100, height: 100 };

describe('alignNodes — single selection aligns to the artboard', () => {
  it('centres horizontally', () => {
    const [node] = alignNodes([box('a', 0, 0, 20, 10)], 'centre', ARTBOARD);
    expect(node?.x).toBe(40);
  });

  it('aligns right', () => {
    const [node] = alignNodes([box('a', 0, 0, 20, 10)], 'right', ARTBOARD);
    expect(node?.x).toBe(80);
  });

  it('aligns to the bottom', () => {
    const [node] = alignNodes([box('a', 0, 0, 20, 10)], 'bottom', ARTBOARD);
    expect(node?.y).toBe(90);
  });
});

describe('alignNodes — multi selection aligns to the selection bounds', () => {
  const selection = [box('a', 0, 0, 10, 10), box('b', 40, 30, 20, 20)];

  it('aligns left to the leftmost edge, not the artboard', () => {
    const aligned = alignNodes(selection, 'left', ARTBOARD);
    expect(aligned.map((n) => n.x)).toEqual([0, 0]);
  });

  it('aligns right to the rightmost edge', () => {
    const aligned = alignNodes(selection, 'right', ARTBOARD);
    // Selection spans 0..60; a 10-wide box lands at 50.
    expect(aligned.map((n) => n.x)).toEqual([50, 40]);
  });

  it('centres vertically within the selection', () => {
    const aligned = alignNodes(selection, 'middle', ARTBOARD);
    // Selection spans y 0..50, centre 25.
    expect(aligned.map((n) => n.y)).toEqual([20, 15]);
  });

  it('leaves the other axis untouched', () => {
    const aligned = alignNodes(selection, 'left', ARTBOARD);
    expect(aligned.map((n) => n.y)).toEqual([0, 30]);
  });

  it('returns an empty selection unchanged', () => {
    expect(alignNodes([], 'left', ARTBOARD)).toEqual([]);
  });
});

describe('distributeNodes', () => {
  it('equalises gaps, not centres', () => {
    // Centres-based distribution leaves visually uneven gaps whenever the
    // objects differ in size, which is the usual case.
    const nodes = [box('a', 0, 0, 10, 10), box('b', 20, 0, 40, 10), box('c', 90, 0, 10, 10)];
    const out = distributeNodes(nodes, 'horizontal');

    const gap1 = (out[1]?.x ?? 0) - ((out[0]?.x ?? 0) + 10);
    const gap2 = (out[2]?.x ?? 0) - ((out[1]?.x ?? 0) + 40);
    expect(gap1).toBeCloseTo(gap2, 9);
  });

  it('keeps the first and last objects pinned', () => {
    const nodes = [box('a', 0, 0), box('b', 20, 0), box('c', 90, 0)];
    const out = distributeNodes(nodes, 'horizontal');
    expect(out[0]?.x).toBe(0);
    expect(out[2]?.x).toBe(90);
  });

  it('sorts by position before distributing, ignoring selection order', () => {
    const nodes = [box('c', 90, 0), box('a', 0, 0), box('b', 20, 0)];
    const out = distributeNodes(nodes, 'horizontal');
    const byId = new Map(out.map((n) => [n.id, n.x]));
    expect(byId.get('a')).toBe(0);
    expect(byId.get('c')).toBe(90);
  });

  it('requires at least three objects', () => {
    const two = [box('a', 0, 0), box('b', 50, 0)];
    expect(distributeNodes(two, 'horizontal')).toEqual(two);
  });

  it('distributes vertically', () => {
    const nodes = [box('a', 0, 0), box('b', 0, 20), box('c', 0, 90)];
    const out = distributeNodes(nodes, 'vertical');
    const gap1 = (out[1]?.y ?? 0) - ((out[0]?.y ?? 0) + 10);
    const gap2 = (out[2]?.y ?? 0) - ((out[1]?.y ?? 0) + 10);
    expect(gap1).toBeCloseTo(gap2, 9);
  });
});

describe('reorder', () => {
  const scene = [box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)];

  it('brings a node forward one step', () => {
    expect(reorder(scene, ['a'], 'forward').map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('sends a node backward one step', () => {
    expect(reorder(scene, ['c'], 'backward').map((n) => n.id)).toEqual(['a', 'c', 'b']);
  });

  it('brings a node to the front', () => {
    expect(reorder(scene, ['a'], 'front').map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('sends a node to the back', () => {
    expect(reorder(scene, ['c'], 'back').map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op at the front', () => {
    expect(reorder(scene, ['c'], 'forward').map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a multi-selection contiguous and in relative order', () => {
    expect(reorder(scene, ['a', 'b'], 'front').map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('groupSelection', () => {
  const scene = [box('a', 0, 0, 10, 10), box('b', 40, 30, 20, 20), box('c', 0, 0)];

  it('wraps the selection in a group sized to its bounds', () => {
    const out = groupSelection(scene, ['a', 'b'], 'g1');
    const group = out.find((n) => n.id === 'g1');

    expect(group).toMatchObject({ kind: 'group', x: 0, y: 0, width: 60, height: 50 });
  });

  it('removes the originals from the top level', () => {
    const out = groupSelection(scene, ['a', 'b'], 'g1');
    expect(out.map((n) => n.id)).toEqual(['c', 'g1']);
  });

  it('preserves child order', () => {
    const out = groupSelection(scene, ['b', 'a'], 'g1');
    const group = out.find((n) => n.id === 'g1');
    expect(group?.kind === 'group' && group.children.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('refuses to group fewer than two nodes', () => {
    expect(groupSelection(scene, ['a'], 'g1')).toEqual(scene);
  });
});

describe('ungroupSelection', () => {
  it('restores children at the group position in z-order', () => {
    const scene = [
      box('z', 0, 0),
      groupNode({
        id: 'g',
        x: p(0),
        y: p(0),
        width: p(60),
        height: p(50),
        children: [box('a', 0, 0), box('b', 40, 30, 20, 20)],
      }),
      box('y', 0, 0),
    ];

    expect(ungroupSelection(scene, ['g']).map((n) => n.id)).toEqual(['z', 'a', 'b', 'y']);
  });

  it('preserves absolute child geometry exactly', () => {
    const child = box('a', 12.5, 7.25, 33, 44);
    const scene = [
      groupNode({
        id: 'g',
        x: p(0),
        y: p(0),
        width: p(100),
        height: p(100),
        children: [child],
      }),
    ];

    const out = ungroupSelection(scene, ['g']);
    expect(out[0]).toEqual(child);
  });

  it('ignores a non-group selection', () => {
    const scene = [box('a', 0, 0)];
    expect(ungroupSelection(scene, ['a'])).toEqual(scene);
  });
});
