import { create } from 'zustand';
import {
  type AlignEdge,
  type Axis,
  alignNodes,
  distributeNodes,
  groupSelection,
  type ReorderDirection,
  reorder,
  ungroupSelection,
} from '@/engine/canvas/arrange';
import type { Guide } from '@/engine/canvas/snapping';
import type { Rect } from '@/engine/geometry/rect';
import { type Command, createHistory, type History } from '@/engine/history/history';
import type { NodeId, SceneNode } from '@/engine/scene/types';
import { millimetresToPoints } from '@/engine/units/convert';
import { millimetres, type Points, points } from '@/engine/units/types';

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line';

/** The part of canvas state that undo/redo rewinds. Viewport is excluded —
 *  nobody expects Ctrl+Z to change the zoom level. */
type Document = {
  readonly nodes: readonly SceneNode[];
  readonly selection: readonly NodeId[];
};

const EMPTY: Document = { nodes: [], selection: [] };

/** 85 × 55mm place card, the v1 default. */
const DEFAULT_ARTBOARD: Rect = {
  x: 0,
  y: 0,
  width: millimetresToPoints(millimetres(85)),
  height: millimetresToPoints(millimetres(55)),
};

/**
 * The history instance lives outside the store for the same reason the db
 * client does: it is mutable machinery, not comparable state. The store holds
 * the value it produces.
 */
let history: History<Document> = createHistory(EMPTY);

type CanvasState = Document & {
  readonly artboard: Rect;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly tool: Tool;
  readonly guides: readonly Guide[];
  readonly snapEnabled: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;

  run: (command: Command<Document>) => void;
  addNode: (node: SceneNode) => void;
  replaceNodes: (nodes: readonly SceneNode[], label: string, coalesceKey?: string) => void;
  deleteSelection: () => void;
  setSelection: (ids: readonly NodeId[]) => void;
  nudge: (dx: Points, dy: Points) => void;

  setTool: (tool: Tool) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  zoomToFit: (viewport: { width: number; height: number }) => void;
  addGuide: (guide: Guide) => void;
  setSnapEnabled: (enabled: boolean) => void;

  align: (edge: AlignEdge) => void;
  distribute: (axis: Axis) => void;
  reorderSelection: (direction: ReorderDirection) => void;
  group: () => void;
  ungroup: () => void;

  undo: () => void;
  redo: () => void;
  reset: () => void;
  loadScene: (nodes: readonly SceneNode[], artboard: Rect) => void;
};

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;

export const useCanvasStore = create<CanvasState>((set, get) => {
  /** Push history's current value into the store. */
  function sync() {
    const document = history.state();
    set({
      nodes: document.nodes,
      selection: document.selection,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    });
  }

  function run(command: Command<Document>) {
    history.run(command);
    sync();
  }

  /** Command that swaps the node list wholesale. Most edits are expressed
   *  this way: the arrange helpers are already pure array transforms. */
  function replace(
    next: readonly SceneNode[],
    label: string,
    coalesceKey?: string,
  ): Command<Document> {
    return {
      label,
      apply: (document) => ({ ...document, nodes: next }),
      ...(coalesceKey === undefined ? {} : { coalesceKey }),
    };
  }

  /** Selected nodes, in scene order rather than selection order. */
  function selectedNodes(): readonly SceneNode[] {
    const selection = new Set(get().selection);
    return get().nodes.filter((node) => selection.has(node.id));
  }

  /** Apply a transform to the selection, leaving everything else in place. */
  function mapSelection(
    transform: (selected: readonly SceneNode[]) => readonly SceneNode[],
    label: string,
    coalesceKey?: string,
  ) {
    const selected = selectedNodes();
    if (selected.length === 0) return;

    const updated = new Map(transform(selected).map((node) => [node.id, node]));
    run(
      replace(
        get().nodes.map((node) => updated.get(node.id) ?? node),
        label,
        coalesceKey,
      ),
    );
  }

  return {
    ...EMPTY,
    artboard: DEFAULT_ARTBOARD,
    zoom: 1,
    panX: 0,
    panY: 0,
    tool: 'select',
    guides: [],
    snapEnabled: true,
    canUndo: false,
    canRedo: false,

    run,

    addNode(node) {
      run({
        label: `Add ${node.name.toLowerCase()}`,
        apply: (document) => ({
          nodes: [...document.nodes, node],
          selection: [node.id],
        }),
      });
    },

    replaceNodes(nodes, label, coalesceKey) {
      run(replace(nodes, label, coalesceKey));
    },

    deleteSelection() {
      const selection = new Set(get().selection);
      if (selection.size === 0) return;

      const removed = get().nodes.filter((node) => selection.has(node.id));
      run({
        label: removed.length === 1 ? 'Delete object' : `Delete ${removed.length} objects`,
        apply: (document) => ({
          nodes: document.nodes.filter((node) => !selection.has(node.id)),
          selection: [],
        }),
        // Restoring by concatenation would move the objects to the top of the
        // stack. Reinsert at the recorded index to preserve z-order.
      });
    },

    setSelection(ids) {
      // Selection is not an undoable edit; it rides along on the document so
      // undo can restore it, but changing it never pushes an entry.
      const current = get().selection;
      // Bail on an identical selection. Fabric emits a selection event for
      // every setActiveObject, so without this the store update re-triggers
      // the effect that set it and React hits its update-depth limit.
      if (current.length === ids.length && current.every((id, i) => id === ids[i])) return;
      set({ selection: ids });
    },

    nudge(dx, dy) {
      mapSelection(
        (selected) =>
          selected.map((node) => ({ ...node, x: points(node.x + dx), y: points(node.y + dy) })),
        'Move object',
        // Held arrow keys are one gesture, not one command per keypress.
        // Keyed on the selection so nudging a different object starts a new
        // entry rather than merging into the previous object's move.
        `nudge:${get().selection.join(',')}`,
      );
    },

    setTool: (tool) => set({ tool }),
    setZoom: (zoom) => set({ zoom: Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM) }),
    setPan: (panX, panY) => set({ panX, panY }),

    zoomToFit(viewport) {
      const { artboard } = get();
      const margin = 48;
      const scale = Math.min(
        (viewport.width - margin * 2) / artboard.width,
        (viewport.height - margin * 2) / artboard.height,
      );
      const zoom = Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM);

      set({
        zoom,
        panX: (viewport.width - artboard.width * zoom) / 2,
        panY: (viewport.height - artboard.height * zoom) / 2,
      });
    },

    addGuide: (guide) => set({ guides: [...get().guides, guide] }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),

    align(edge) {
      const selected = selectedNodes();
      if (selected.length === 0) return;
      const aligned = new Map(
        alignNodes(selected, edge, get().artboard).map((node) => [node.id, node]),
      );
      run(
        replace(
          get().nodes.map((node) => aligned.get(node.id) ?? node),
          `Align ${edge}`,
        ),
      );
    },

    distribute(axis) {
      mapSelection((selected) => distributeNodes(selected, axis), `Distribute ${axis}`);
    },

    reorderSelection(direction) {
      run(replace(reorder(get().nodes, get().selection, direction), `Bring ${direction}`));
    },

    group() {
      const id = `group-${Date.now().toString(36)}`;
      const next = groupSelection(get().nodes, get().selection, id);
      if (next === get().nodes) return;

      run({
        label: 'Group',
        apply: (document) => ({ ...document, nodes: next, selection: [id] }),
      });
    },

    ungroup() {
      const next = ungroupSelection(get().nodes, get().selection);
      if (next === get().nodes) return;
      run(replace(next, 'Ungroup'));
    },

    undo() {
      history.undo();
      sync();
    },

    redo() {
      history.redo();
      sync();
    },

    reset() {
      history = createHistory(EMPTY);
      set({ ...EMPTY, canUndo: false, canRedo: false });
    },

    loadScene(nodes, artboard) {
      // History starts fresh: an opened project has no past in this session,
      // and letting undo reach back past the load would leave the editor
      // showing a scene the file never contained.
      history = createHistory<Document>({ nodes, selection: [] });
      set({ nodes, selection: [], artboard, canUndo: false, canRedo: false });
    },
  };
});
