/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { rectNode } from '@/engine/scene/factories';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { points } from '@/engine/units/types';

/**
 * INC-10 — a held arrow key is one gesture, not one command per keypress.
 *
 * Without coalescing, nudging an object ten steps costs ten undos, which makes
 * the arrow keys unusable for the fine positioning they exist for.
 */

function place(id: string, x = 0, y = 0) {
  useCanvasStore.getState().reset();
  useCanvasStore
    .getState()
    .addNode(rectNode({ id, x: points(x), y: points(y), width: points(10), height: points(10) }));
}

function positionOf(id: string) {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return { x: node.x, y: node.y };
}

describe('nudge coalescing', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('collapses a run of nudges into one undo', () => {
    place('a');
    for (let i = 0; i < 10; i += 1) useCanvasStore.getState().nudge(points(1), points(0));
    expect(positionOf('a').x).toBe(10);

    useCanvasStore.getState().undo();
    // Back to where the run started, not one step back into it.
    expect(positionOf('a').x).toBe(0);
  });

  it('redo replays the whole run', () => {
    place('a');
    for (let i = 0; i < 4; i += 1) useCanvasStore.getState().nudge(points(1), points(0));

    useCanvasStore.getState().undo();
    useCanvasStore.getState().redo();
    expect(positionOf('a').x).toBe(4);
  });

  it('does not merge a nudge into the placement before it', () => {
    place('a');
    useCanvasStore.getState().nudge(points(5), points(0));

    useCanvasStore.getState().undo();
    // The object is still there — only the move was taken back.
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
    expect(positionOf('a').x).toBe(0);
  });

  it('starts a new entry when the selection changes', () => {
    useCanvasStore.getState().reset();
    const store = useCanvasStore.getState();
    store.addNode(
      rectNode({ id: 'a', x: points(0), y: points(0), width: points(10), height: points(10) }),
    );
    store.addNode(
      rectNode({ id: 'b', x: points(0), y: points(0), width: points(10), height: points(10) }),
    );

    useCanvasStore.getState().setSelection(['a']);
    useCanvasStore.getState().nudge(points(3), points(0));
    useCanvasStore.getState().setSelection(['b']);
    useCanvasStore.getState().nudge(points(7), points(0));

    // Undoing the second object's move must not also revert the first's.
    useCanvasStore.getState().undo();
    expect(positionOf('b').x).toBe(0);
    expect(positionOf('a').x).toBe(3);
  });
});
