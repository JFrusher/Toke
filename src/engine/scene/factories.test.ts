import { describe, expect, it } from 'vitest';
import {
  ellipseNode,
  groupNode,
  imageNode,
  lineNode,
  pathNode,
  rectNode,
  textNode,
} from '@/engine/scene/factories';
import { findNode, isGroup, walk } from '@/engine/scene/types';
import { points } from '@/engine/units/types';

const p = points;
const box = { x: p(0), y: p(0), width: p(10), height: p(10) } as const;

describe('factories', () => {
  it('apply sane defaults', () => {
    const node = rectNode({ id: 'r', ...box });
    expect(node).toMatchObject({
      kind: 'rect',
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      cornerRadius: 0,
    });
  });

  it('name a node after its kind when none is given', () => {
    expect(rectNode({ id: 'r', ...box }).name).toBe('Rectangle');
    expect(textNode({ id: 't', ...box, text: 'x' }).name).toBe('Text');
  });

  it('accept an explicit name', () => {
    expect(rectNode({ id: 'r', ...box, name: 'Card back' }).name).toBe('Card back');
  });

  it('produce every kind', () => {
    const kinds = [
      rectNode({ id: '1', ...box }),
      ellipseNode({ id: '2', ...box }),
      lineNode({ id: '3', ...box }),
      pathNode({ id: '4', ...box, d: 'M0 0 L10 10' }),
      textNode({ id: '5', ...box, text: 'x' }),
      imageNode({ id: '6', ...box, assetId: 'a' }),
      groupNode({ id: '7', ...box, children: [] }),
    ].map((n) => n.kind);

    expect(kinds).toEqual(['rect', 'ellipse', 'line', 'path', 'text', 'image', 'group']);
  });

  it('give text a default stroke of none — text is filled, not outlined', () => {
    const node = textNode({ id: 't', ...box, text: 'x' });
    expect(node.fill).toEqual({ kind: 'solid', color: '#1a1815' });
  });
});

describe('walk', () => {
  const tree = [
    rectNode({ id: 'a', ...box }),
    groupNode({
      id: 'g',
      ...box,
      children: [
        rectNode({ id: 'b', ...box }),
        groupNode({ id: 'h', ...box, children: [rectNode({ id: 'c', ...box })] }),
      ],
    }),
    rectNode({ id: 'd', ...box }),
  ];

  it('visits depth first in paint order', () => {
    expect([...walk(tree)].map((n) => n.id)).toEqual(['a', 'g', 'b', 'h', 'c', 'd']);
  });

  it('handles an empty scene', () => {
    expect([...walk([])]).toEqual([]);
  });

  it('handles an empty group', () => {
    expect([...walk([groupNode({ id: 'g', ...box, children: [] })])].map((n) => n.id)).toEqual([
      'g',
    ]);
  });
});

describe('findNode', () => {
  const tree = [
    groupNode({
      id: 'g',
      ...box,
      children: [rectNode({ id: 'deep', ...box })],
    }),
  ];

  it('finds a nested node', () => {
    expect(findNode(tree, 'deep')?.id).toBe('deep');
  });

  it('returns null when absent', () => {
    expect(findNode(tree, 'missing')).toBeNull();
  });
});

describe('isGroup', () => {
  it('narrows to the group type', () => {
    const node = groupNode({ id: 'g', ...box, children: [] });
    expect(isGroup(node)).toBe(true);
    if (isGroup(node)) {
      expect(node.children).toEqual([]);
    }
  });

  it('is false for a leaf', () => {
    expect(isGroup(rectNode({ id: 'r', ...box }))).toBe(false);
  });
});
