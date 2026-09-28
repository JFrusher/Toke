/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { rectNode } from '@/engine/scene/factories';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { points } from '@/engine/units/types';

const bindOf = () => useCanvasStore.getState().nodes[0]?.bind;

describe('setBinding', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
    useCanvasStore
      .getState()
      .addNode(
        rectNode({ id: 'a', x: points(0), y: points(0), width: points(10), height: points(10) }),
      );
  });

  it('binds, rebinds and unbinds one property at a time', () => {
    const { setBinding } = useCanvasStore.getState();
    setBinding('a', 'visible', 'is_gf');
    setBinding('a', 'fill', 'accent');
    setBinding('a', 'visible', 'is_veg');
    expect(bindOf()).toEqual({ visible: 'is_veg', fill: 'accent' });

    setBinding('a', 'fill', null);
    expect(bindOf()).toEqual({ visible: 'is_veg' });
  });

  it('leaves no empty bind object once everything is unbound', () => {
    const { setBinding } = useCanvasStore.getState();
    setBinding('a', 'visible', 'is_gf');
    setBinding('a', 'visible', null);
    expect(useCanvasStore.getState().nodes[0]).not.toHaveProperty('bind');
  });

  it('is one undo', () => {
    useCanvasStore.getState().setBinding('a', 'visible', 'is_gf');
    useCanvasStore.getState().undo();
    expect(bindOf()).toBeUndefined();
  });
});
