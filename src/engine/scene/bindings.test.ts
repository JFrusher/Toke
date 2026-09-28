import { describe, expect, it } from 'vitest';
import { bindTree, imageKey, keepAuthored } from '@/engine/scene/bindings';
import { groupNode, imageNode, lineNode, rectNode, textNode } from '@/engine/scene/factories';
import type { SceneNode } from '@/engine/scene/types';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, points } from '@/engine/units/types';

const p = points;
const base = { x: p(10), y: p(20), width: p(100), height: p(50) };
const images = new Map([
  ['gf', 'hash-gf'],
  ['veg', 'hash-veg'],
]);

function bind(node: SceneNode, row: Record<string, unknown>) {
  return bindTree([node], { row, images });
}

function only(node: SceneNode, row: Record<string, unknown>) {
  const result = bind(node, row);
  expect(result.errors).toEqual([]);
  const [first] = result.nodes;
  if (first === undefined) throw new Error('no node');
  return first;
}

describe('visibility', () => {
  const badge = { ...rectNode({ id: 'badge', ...base }), bind: { visible: 'show' } };

  it.each([[1], [true], ['yes'], ['GF'], ['1']])('shows the object for %j', (value) => {
    expect(only(badge, { show: value }).visible).toBe(true);
  });

  it.each([[0], [false], [null], [''], ['  '], ['0'], ['false'], ['No'], ['n']])(
    'hides the object for %j',
    (value) => {
      expect(only(badge, { show: value }).visible).toBe(false);
    },
  );

  it('never shows an object the author hid', () => {
    expect(only({ ...badge, visible: false }, { show: 1 }).visible).toBe(false);
  });
});

describe('colour', () => {
  it('replaces a solid fill', () => {
    const node = { ...rectNode({ id: 'r', ...base }), bind: { fill: 'accent' } };
    expect(only(node, { accent: '#3D6B4A' })).toMatchObject({
      fill: { kind: 'solid', color: '#3D6B4A' },
    });
  });

  it('accepts short hex', () => {
    const node = { ...rectNode({ id: 'r', ...base }), bind: { fill: 'accent' } };
    expect(only(node, { accent: '#abc' })).toMatchObject({ fill: { color: '#abc' } });
  });

  it('keeps the authored colour when the cell is empty', () => {
    const node = {
      ...rectNode({ id: 'r', ...base, fill: { kind: 'solid', color: '#111111' } }),
      bind: { fill: 'accent' },
    };
    expect(only(node, { accent: null })).toMatchObject({ fill: { color: '#111111' } });
  });

  it('keeps the authored stroke width when binding its colour', () => {
    const node = {
      ...lineNode({ id: 'l', ...base, stroke: { kind: 'solid', color: '#000', width: p(2) } }),
      bind: { stroke: 'ink' },
    };
    expect(only(node, { ink: '#ff0000' })).toMatchObject({
      stroke: { kind: 'solid', color: '#ff0000', width: 2 },
    });
  });

  it('refuses a value that is not a colour', () => {
    const node = { ...rectNode({ id: 'r', ...base }), bind: { fill: 'accent' } };
    const result = bind(node, { accent: 'green' });
    expect(result.errors[0]).toMatchObject({ code: 'BINDING_INVALID_VALUE', objectId: 'r' });
    // The node is kept as authored rather than dropped.
    expect(result.nodes).toHaveLength(1);
  });
});

describe('geometry', () => {
  const node = { ...rectNode({ id: 'r', ...base }), bind: { x: 'left', width: 'w' } };

  it('reads a bare number as millimetres', () => {
    const bound = only(node, { left: 12, w: '30' });
    expect(bound.x).toBeCloseTo(millimetresToPoints(millimetres(12)), 6);
    expect(bound.width).toBeCloseTo(millimetresToPoints(millimetres(30)), 6);
  });

  it('honours a unit in the cell', () => {
    expect(only(node, { left: '1in', w: '72pt' })).toMatchObject({ x: 72, width: 72 });
  });

  it('keeps the authored value for an empty cell', () => {
    expect(only(node, { left: null, w: '' })).toMatchObject({ x: 10, width: 100 });
  });

  it('refuses a negative or zero size', () => {
    expect(bind(node, { left: 1, w: 0 }).errors[0]).toMatchObject({
      code: 'BINDING_INVALID_VALUE',
    });
  });

  it('refuses text that is not a length', () => {
    expect(bind(node, { left: 'far left', w: 1 }).errors[0]).toMatchObject({
      code: 'BINDING_INVALID_VALUE',
    });
  });
});

describe('image', () => {
  const photo = {
    ...imageNode({ id: 'i', ...base, assetId: 'hash-orig' }),
    bind: { asset: 'pic' },
  };

  it('picks the image named in the cell', () => {
    expect(only(photo, { pic: 'veg' })).toMatchObject({ assetId: 'hash-veg' });
  });

  it('matches names without case or extension', () => {
    expect(only(photo, { pic: 'GF.png' })).toMatchObject({ assetId: 'hash-gf' });
  });

  it('keeps the placed image for an empty cell', () => {
    expect(only(photo, { pic: null })).toMatchObject({ assetId: 'hash-orig' });
  });

  it('refuses a name that is not in the library', () => {
    expect(bind(photo, { pic: 'vegan' }).errors[0]).toMatchObject({
      code: 'BINDING_UNKNOWN_IMAGE',
      objectId: 'i',
    });
  });
});

describe('the tree', () => {
  it('reports a column the record source does not return', () => {
    const node = { ...rectNode({ id: 'r', ...base }), bind: { visible: 'nope' } };
    expect(bind(node, { show: 1 }).errors[0]).toMatchObject({
      code: 'BINDING_UNKNOWN_COLUMN',
      objectId: 'r',
    });
  });

  it('binds inside groups', () => {
    const child = { ...textNode({ id: 't', ...base, text: 'x' }), bind: { visible: 'show' } };
    const [group] = bindTree([groupNode({ id: 'g', ...base, children: [child] })], {
      row: { show: 0 },
      images,
    }).nodes;
    expect(group?.kind === 'group' && group.children[0]?.visible).toBe(false);
  });

  it('returns unbound nodes untouched', () => {
    const node = rectNode({ id: 'r', ...base });
    expect(bind(node, {}).nodes[0]).toBe(node);
  });

  it('collects one error per failing node and binds the rest', () => {
    const bad = { ...rectNode({ id: 'a', ...base }), bind: { fill: 'c' } };
    const good = { ...rectNode({ id: 'b', ...base }), bind: { visible: 'show' } };
    const result = bindTree([bad, good], { row: { c: 'nope', show: 0 }, images });
    expect(result.errors).toHaveLength(1);
    expect(result.nodes[1]?.visible).toBe(false);
  });
});

describe('imageKey', () => {
  it('normalises case, extension and spaces', () => {
    expect(imageKey('  Gluten Free.PNG ')).toBe('gluten free');
  });
});

describe('keepAuthored', () => {
  it('restores bound properties and keeps the rest of an edit', () => {
    const authored = { ...rectNode({ id: 'r', ...base }), bind: { x: 'left', visible: 'show' } };
    const edited = { ...authored, x: p(99), y: p(77), visible: false };
    expect(keepAuthored(edited, authored)).toMatchObject({ x: 10, y: 77, visible: true });
  });

  it('leaves an unbound node alone', () => {
    const node = rectNode({ id: 'r', ...base });
    const edited = { ...node, x: p(5) };
    expect(keepAuthored(edited, node)).toBe(edited);
  });
});
