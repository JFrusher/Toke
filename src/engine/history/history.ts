/**
 * Undo/redo as a command stack.
 *
 * Commands carry their own inverse rather than the stack storing snapshots: a
 * scene with a large embedded image would make snapshot history cost hundreds
 * of megabytes at depth 100.
 *
 * Generic over the state value so it can be tested without a scene graph.
 */

export type Command<S> = {
  /** Shown in the Edit menu — "Undo move object". */
  readonly label: string;
  readonly apply: (state: S) => S;
  /**
   * Commands sharing a key collapse into one entry. A drag emits a command per
   * mousemove; without this, one drag costs fifty presses of Ctrl+Z.
   */
  readonly coalesceKey?: string;
};

export type History<S> = {
  state: () => S;
  run: (command: Command<S>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;
  /** Number of reversible entries currently held. */
  depth: () => number;
};

type Entry<S> = {
  readonly command: Command<S>;
  /** State as it was BEFORE the entry ran, so a coalesced merge can rewind. */
  readonly before: S;
};

export function createHistory<S>(initial: S, options: { limit?: number } = {}): History<S> {
  const limit = options.limit ?? 100;

  let current = initial;
  let undoStack: Entry<S>[] = [];
  let redoStack: Entry<S>[] = [];
  // Cleared by undo/redo so a drag cannot merge across a history navigation.
  let lastKey: string | null = null;

  function run(command: Command<S>) {
    const mergeable =
      command.coalesceKey !== undefined && command.coalesceKey === lastKey && undoStack.length > 0;

    if (mergeable) {
      // Replace the top entry, keeping the state from before the run began so
      // a single undo reverses the whole gesture.
      const previous = undoStack[undoStack.length - 1];
      if (previous !== undefined) {
        current = command.apply(previous.before);
        undoStack[undoStack.length - 1] = { command, before: previous.before };
        redoStack = [];
        return;
      }
    }

    const before = current;
    current = command.apply(before);
    undoStack.push({ command, before });

    // A new command makes the redo stack unreachable: replaying it would
    // apply a change onto a state it was never computed against.
    redoStack = [];
    lastKey = command.coalesceKey ?? null;

    if (undoStack.length > limit) {
      undoStack = undoStack.slice(undoStack.length - limit);
    }
  }

  function undo() {
    const entry = undoStack.pop();
    if (entry === undefined) return;

    // Restored from the snapshot taken before the command ran, rather than by
    // asking the command to reverse itself.
    //
    // A per-command inverse cannot be right for a coalesced gesture: the top
    // entry deliberately carries the state from before the WHOLE gesture, so a
    // command that only knows its own last step would undo one nudge of a drag
    // and leave the rest applied. The snapshot always knows.
    current = entry.before;
    redoStack.push(entry);
    lastKey = null;
  }

  function redo() {
    const entry = redoStack.pop();
    if (entry === undefined) return;

    current = entry.command.apply(current);
    undoStack.push(entry);
    lastKey = null;
  }

  return {
    state: () => current,
    run,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack[undoStack.length - 1]?.command.label ?? null,
    redoLabel: () => redoStack[redoStack.length - 1]?.command.label ?? null,
    depth: () => undoStack.length,
  };
}
