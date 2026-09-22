import { describe, expect, it } from 'vitest';
import { type Command, createHistory } from '@/engine/history/history';

/**
 * The stack is generic over a state value. Tested with a plain object so the
 * tests exercise history semantics rather than scene-graph details.
 */
type State = { readonly items: readonly string[]; readonly selection: readonly string[] };

const EMPTY: State = { items: [], selection: [] };

function add(item: string): Command<State> {
  return {
    label: `add ${item}`,
    apply: (state) => ({ ...state, items: [...state.items, item] }),
  };
}

function select(id: string): Command<State> {
  return {
    label: `select ${id}`,
    apply: (state) => ({ ...state, selection: [id] }),
  };
}

describe('basic stack', () => {
  it('starts with nothing to undo or redo', () => {
    const history = createHistory(EMPTY);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('applies a command', () => {
    const history = createHistory(EMPTY);
    history.run(add('a'));
    expect(history.state().items).toEqual(['a']);
  });

  it('undoes and redoes', () => {
    const history = createHistory(EMPTY);
    history.run(add('a'));

    history.undo();
    expect(history.state().items).toEqual([]);

    history.redo();
    expect(history.state().items).toEqual(['a']);
  });

  it('round trips twenty steps to an identical state', () => {
    const history = createHistory(EMPTY);
    for (let i = 0; i < 20; i += 1) history.run(add(`item-${i}`));

    const afterAll = history.state();
    for (let i = 0; i < 20; i += 1) history.undo();
    expect(history.state()).toEqual(EMPTY);

    for (let i = 0; i < 20; i += 1) history.redo();
    expect(history.state()).toEqual(afterAll);
  });

  it('ignores undo past the beginning', () => {
    const history = createHistory(EMPTY);
    history.undo();
    history.undo();
    expect(history.state()).toEqual(EMPTY);
  });

  it('ignores redo past the end', () => {
    const history = createHistory(EMPTY);
    history.run(add('a'));
    history.redo();
    expect(history.state().items).toEqual(['a']);
  });
});

describe('redo invalidation', () => {
  it('discards the redo stack after a new command', () => {
    // Keeping it would let redo reapply a change onto a state it was never
    // computed against.
    const history = createHistory(EMPTY);
    history.run(add('a'));
    history.run(add('b'));
    history.undo();

    expect(history.canRedo()).toBe(true);
    history.run(add('c'));

    expect(history.canRedo()).toBe(false);
    expect(history.state().items).toEqual(['a', 'c']);
  });
});

describe('coalescing', () => {
  it('merges commands sharing a coalesce key into one entry', () => {
    // A drag emits a command per mousemove. Without merging, one drag costs
    // the user fifty presses of Ctrl+Z.
    const history = createHistory(EMPTY);
    history.run({ ...select('a'), coalesceKey: 'drag:a' });
    history.run({ ...select('b'), coalesceKey: 'drag:a' });
    history.run({ ...select('c'), coalesceKey: 'drag:a' });

    expect(history.depth()).toBe(1);
    history.undo();
    expect(history.state().selection).toEqual([]);
  });

  it('keeps the latest value when merging', () => {
    const history = createHistory(EMPTY);
    history.run({ ...select('a'), coalesceKey: 'drag' });
    history.run({ ...select('z'), coalesceKey: 'drag' });
    expect(history.state().selection).toEqual(['z']);
  });

  it('starts a new entry when the key changes', () => {
    const history = createHistory(EMPTY);
    history.run({ ...select('a'), coalesceKey: 'drag:a' });
    history.run({ ...select('b'), coalesceKey: 'drag:b' });
    expect(history.depth()).toBe(2);
  });

  it('never merges commands without a key', () => {
    const history = createHistory(EMPTY);
    history.run(add('a'));
    history.run(add('b'));
    expect(history.depth()).toBe(2);
  });

  it('does not merge across an undo', () => {
    const history = createHistory(EMPTY);
    history.run({ ...select('a'), coalesceKey: 'drag' });
    history.undo();
    history.run({ ...select('b'), coalesceKey: 'drag' });
    expect(history.depth()).toBe(1);
    expect(history.state().selection).toEqual(['b']);
  });
});

describe('depth limit', () => {
  it('drops the oldest entries past the limit', () => {
    const history = createHistory(EMPTY, { limit: 5 });
    for (let i = 0; i < 12; i += 1) history.run(add(`i${i}`));

    expect(history.depth()).toBe(5);

    // Only the last five are reversible; the earlier items stay.
    for (let i = 0; i < 5; i += 1) history.undo();
    expect(history.canUndo()).toBe(false);
    expect(history.state().items).toEqual(['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6']);
  });

  it('defaults to a limit of 100', () => {
    const history = createHistory(EMPTY);
    for (let i = 0; i < 150; i += 1) history.run(add(`i${i}`));
    expect(history.depth()).toBe(100);
  });
});

describe('labels', () => {
  it('reports what undo and redo would do, for the menu', () => {
    const history = createHistory(EMPTY);
    history.run(add('a'));

    expect(history.undoLabel()).toBe('add a');
    history.undo();
    expect(history.redoLabel()).toBe('add a');
    expect(history.undoLabel()).toBeNull();
  });
});

describe('undo restores the state from before the command', () => {
  it('reverses a wholesale replacement', () => {
    // Regression: the replacement command used to build its inverse lazily,
    // capturing `previous` the first time invert() ran — which is at UNDO
    // time, after apply had already changed the state. Undo restored the
    // state it was already in, so every inspector edit was undoable in name
    // only.
    const history = createHistory({ value: 'a' });

    history.run({ label: 'to b', apply: () => ({ value: 'b' }) });
    expect(history.state().value).toBe('b');

    history.undo();
    expect(history.state().value).toBe('a');
  });

  it('reverses a whole coalesced gesture, not just its last step', () => {
    // The top entry deliberately keeps the state from before the gesture
    // began, so one undo reverses the whole drag.
    const history = createHistory({ value: 0 });

    history.run({ label: 'drag', coalesceKey: 'drag', apply: () => ({ value: 1 }) });
    history.run({ label: 'drag', coalesceKey: 'drag', apply: () => ({ value: 2 }) });
    history.run({ label: 'drag', coalesceKey: 'drag', apply: () => ({ value: 3 }) });
    expect(history.state().value).toBe(3);

    history.undo();
    expect(history.state().value).toBe(0);
  });

  it('redo reapplies after an undo', () => {
    const history = createHistory({ value: 'a' });
    history.run({ label: 'to b', apply: () => ({ value: 'b' }) });

    history.undo();
    history.redo();
    expect(history.state().value).toBe('b');
  });
});
