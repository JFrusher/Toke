import { describe, expect, it } from 'vitest';
import { fromFabricObject, toFabricProps } from '@/engine/scene/fabric';
import { ellipseNode, groupNode, imageNode, rectNode, textNode } from '@/engine/scene/factories';
import type { SceneNode } from '@/engine/scene/types';
import { points } from '@/engine/units/types';

const p = points;

const RECT = rectNode({
  id: 'r1',
  x: p(10),
  y: p(20),
  width: p(85),
  height: p(55),
  fill: { kind: 'solid', color: '#1a1815' },
});

function roundTrip(node: SceneNode): SceneNode {
  return fromFabricObject(toFabricProps(node), node);
}

describe('toFabricProps — geometry', () => {
  it('maps x/y to left/top', () => {
    const props = toFabricProps(RECT);
    expect(props).toMatchObject({ left: 10, top: 20, width: 85, height: 55 });
  });

  it('always emits unit scale — size lives in width/height, never in scale', () => {
    // Keeping size in one place is what makes round-tripping exact. Fabric
    // will set scaleX/scaleY when the user drags a handle; fromFabricObject
    // bakes that back out.
    const props = toFabricProps(RECT);
    expect(props.scaleX).toBe(1);
    expect(props.scaleY).toBe(1);
  });

  it('converts rotation from radians to Fabric degrees', () => {
    const rotated = { ...RECT, rotation: Math.PI / 2 };
    expect(toFabricProps(rotated).angle).toBeCloseTo(90, 9);
  });

  it('pins the transform origin to the top-left corner', () => {
    // Fabric defaults to centre origin. With centre origin, left/top mean the
    // centre point and every coordinate in the inspector would be wrong.
    const props = toFabricProps(RECT);
    expect(props.originX).toBe('left');
    expect(props.originY).toBe('top');
  });
});

describe('toFabricProps — paint', () => {
  it('maps a solid fill', () => {
    expect(toFabricProps(RECT).fill).toBe('#1a1815');
  });

  it('maps no fill to null, not to transparent', () => {
    // Fabric treats '' and 'transparent' inconsistently across object types;
    // null is the documented "do not paint" value.
    const node = rectNode({ id: 'r', x: p(0), y: p(0), width: p(1), height: p(1) });
    expect(toFabricProps(node).fill).toBeNull();
  });

  it('maps a stroke with width and dash', () => {
    const node = rectNode({
      id: 'r',
      x: p(0),
      y: p(0),
      width: p(10),
      height: p(10),
      stroke: { kind: 'solid', color: '#908a7f', width: p(0.25), dash: [2, 2] },
    });
    const props = toFabricProps(node);
    expect(props.stroke).toBe('#908a7f');
    expect(props.strokeWidth).toBe(0.25);
    expect(props.strokeDashArray).toEqual([2, 2]);
  });

  it('keeps the stroke from inflating the bounding box', () => {
    // Fabric's default grows an object by its stroke width. A 85mm card with a
    // 1pt border would measure 85mm + 1pt and impose incorrectly.
    const node = rectNode({
      id: 'r',
      x: p(0),
      y: p(0),
      width: p(10),
      height: p(10),
      stroke: { kind: 'solid', color: '#000', width: p(2) },
    });
    expect(toFabricProps(node).strokeUniform).toBe(true);
    expect(toFabricProps(node).paintFirst).toBe('fill');
  });
});

describe('toFabricProps — text', () => {
  const TEXT = textNode({
    id: 't1',
    x: p(0),
    y: p(0),
    width: p(200),
    height: p(24),
    text: 'Ada Lovelace',
    fontSize: p(18),
  });

  it('maps typography', () => {
    const props = toFabricProps(TEXT);
    expect(props).toMatchObject({
      text: 'Ada Lovelace',
      fontSize: 18,
      textAlign: 'left',
      fontWeight: 400,
      fontStyle: 'normal',
    });
  });

  it('maps tracking to charSpacing in 1/1000 em, which is what Fabric expects', () => {
    const node = { ...TEXT, tracking: 1.8 } as const;
    // 1.8pt at 18pt font = 0.1em = 100 units.
    expect(toFabricProps(node).charSpacing).toBeCloseTo(100, 6);
  });

  it('maps italic to fontStyle', () => {
    expect(toFabricProps({ ...TEXT, italic: true }).fontStyle).toBe('italic');
  });
});

describe('fromFabricObject — bakes scale back into size', () => {
  it('multiplies width by scaleX and resets scale', () => {
    // This is what a resize handle produces: Fabric scales rather than
    // resizing. Left as scale, the PDF renderer would draw the original size.
    const node = fromFabricObject(
      { left: 10, top: 20, width: 85, height: 55, scaleX: 2, scaleY: 3, angle: 0 },
      RECT,
    );
    expect(node.width).toBe(170);
    expect(node.height).toBe(165);
  });

  it('converts degrees back to radians', () => {
    const node = fromFabricObject({ ...toFabricProps(RECT), angle: 90 }, RECT);
    expect(node.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it('treats a missing scale as 1', () => {
    const node = fromFabricObject({ left: 0, top: 0, width: 10, height: 10 }, RECT);
    expect(node.width).toBe(10);
  });

  it('preserves the identity and kind of the source node', () => {
    const node = fromFabricObject({ left: 0, top: 0, width: 10, height: 10 }, RECT);
    expect(node.id).toBe('r1');
    expect(node.kind).toBe('rect');
  });

  it('carries edited text back', () => {
    const text = textNode({
      id: 't',
      x: p(0),
      y: p(0),
      width: p(100),
      height: p(20),
      text: 'before',
    });
    const node = fromFabricObject({ left: 0, top: 0, width: 100, height: 20, text: 'after' }, text);
    expect(node.kind === 'text' && node.text).toBe('after');
  });
});

describe('round trip', () => {
  const nodes: SceneNode[] = [
    RECT,
    ellipseNode({ id: 'e', x: p(1.5), y: p(2.25), width: p(30), height: p(40) }),
    textNode({
      id: 't',
      x: p(5),
      y: p(6),
      width: p(120),
      height: p(18),
      text: 'Grace Hopper',
      fontSize: p(13),
      tracking: 0.65,
      italic: true,
      align: 'center',
    }),
    imageNode({ id: 'i', x: p(0), y: p(0), width: p(50), height: p(50), assetId: 'abc123' }),
  ];

  it.each(nodes)('preserves geometry for $kind', (node) => {
    const back = roundTrip(node);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(back[key] - node[key])).toBeLessThan(1e-6);
    }
  });

  it.each(nodes)('preserves rotation for $kind', (node) => {
    const rotated = { ...node, rotation: 0.6435011087932844 };
    expect(Math.abs(roundTrip(rotated).rotation - rotated.rotation)).toBeLessThan(1e-9);
  });

  it.each(nodes)('preserves the whole node for $kind', (node) => {
    expect(roundTrip(node)).toEqual(node);
  });

  it('survives a full turn of rotation without drift', () => {
    const rotated = { ...RECT, rotation: Math.PI * 2 - 1e-7 };
    expect(Math.abs(roundTrip(rotated).rotation - rotated.rotation)).toBeLessThan(1e-9);
  });
});

describe('groups', () => {
  const group = groupNode({
    id: 'g1',
    x: p(0),
    y: p(0),
    width: p(200),
    height: p(100),
    children: [
      RECT,
      groupNode({
        id: 'g2',
        x: p(5),
        y: p(5),
        width: p(50),
        height: p(50),
        children: [ellipseNode({ id: 'e2', x: p(0), y: p(0), width: p(10), height: p(10) })],
      }),
    ],
  });

  it('round trips nested children', () => {
    expect(roundTrip(group)).toEqual(group);
  });

  it('preserves child order, which is z-order', () => {
    const back = roundTrip(group);
    expect(back.kind === 'group' && back.children.map((c) => c.id)).toEqual(['r1', 'g2']);
  });
});

describe('worker transferability', () => {
  it('structuredClone reproduces a scene exactly', () => {
    // The PDF worker receives this graph. A non-cloneable value fails at
    // runtime with a DataCloneError that is hard to trace.
    const scene = { nodes: [RECT, group()] };
    expect(structuredClone(scene)).toEqual(scene);
  });

  function group() {
    return groupNode({
      id: 'g',
      x: p(0),
      y: p(0),
      width: p(10),
      height: p(10),
      children: [RECT],
    });
  }
});
