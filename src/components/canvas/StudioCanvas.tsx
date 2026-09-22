'use client';

import * as fabric from 'fabric';
import { useCallback, useEffect, useRef, useState } from 'react';
import { snap, snapTargets } from '@/engine/canvas/snapping';
import { fromFabricObject, toFabricProps } from '@/engine/scene/fabric';
import { ellipseNode, lineNode, rectNode, textNode } from '@/engine/scene/factories';
import type { NodeId, SceneNode } from '@/engine/scene/types';
import { MAX_ZOOM, MIN_ZOOM, type Tool, useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { useStudioStore } from '@/engine/store/useStudioStore';
import { ensureFontsLoaded, getFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { renderTextNode, type StudioMode } from '@/engine/tokens/render';
import { points } from '@/engine/units/types';

/**
 * Fabric owns interaction; the store owns truth.
 *
 * Fabric objects are created from SceneNodes and edited in place. When Fabric
 * reports a change we convert back and commit to the store; when the store
 * changes for any other reason we reconcile Fabric to match. A `fromFabric`
 * flag breaks the loop that would otherwise fight the user mid-drag.
 */

const SNAP_THRESHOLD_PX = 4;

let nextId = 0;
function makeId(kind: string): NodeId {
  nextId += 1;
  return `${kind}-${nextId}`;
}

/**
 * Groups hold their children in ABSOLUTE coordinates (see engine/canvas/arrange),
 * so rendering needs no transform stack — only a flat list of leaves in paint
 * order. A group itself draws nothing.
 *
 * Without this, grouping moved children out of the top-level array and they
 * vanished from the canvas while still appearing in the layers tree.
 */
function renderableNodes(nodes: readonly SceneNode[]): SceneNode[] {
  const flat: SceneNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'group') flat.push(...renderableNodes(node.children));
    else flat.push(node);
  }
  return flat;
}

/** Leaf ids a selection covers: selecting a group selects everything inside it. */
function selectedLeafIds(nodes: readonly SceneNode[], selection: readonly NodeId[]): NodeId[] {
  const wanted = new Set(selection);
  const ids: NodeId[] = [];

  const visit = (list: readonly SceneNode[], inherited: boolean) => {
    for (const node of list) {
      const active = inherited || wanted.has(node.id);
      if (node.kind === 'group') visit(node.children, active);
      else if (active) ids.push(node.id);
    }
  };

  visit(nodes, false);
  return ids;
}

/**
 * Size a text node from engine/text/measure.ts rather than letting Fabric
 * measure it (CLAUDE.md §2.1 rule 3).
 *
 * Fabric would size the box with ctx.measureText. That happens to agree today
 * — the browser and fontkit read the same file — but "happens to agree" is
 * not a guarantee. Driving the box from our own measurement makes the canvas
 * and the PDF the same number by construction, not by coincidence.
 *
 * Returns null when the face has not loaded yet; Fabric's own size stands in
 * until the fonts arrive and the effect re-runs.
 */
function measuredTextBox(node: SceneNode): { width: number; height: number } | null {
  if (node.kind !== 'text') return null;

  const font = getFont(node.fontFamily, node.fontWeight, node.italic);
  if (font === null) return null;

  const measured = measureText({
    text: node.text,
    font,
    fontSize: node.fontSize,
    tracking: node.tracking,
    lineHeight: node.lineHeight,
  });

  return { width: measured.width, height: measured.height };
}

/** Returns the node resized to its measured text box, or unchanged if the
 *  face has not loaded. */
export function withMeasuredSize(node: SceneNode): SceneNode {
  const box = measuredTextBox(node);
  if (box === null) return node;
  return { ...node, width: points(box.width), height: points(box.height) };
}

/**
 * What a text node should actually show right now — template in Token Mode,
 * resolved and auto-fitted values in Live Mode. Goes through the same
 * renderTextNode the PDF renderer will use in Phase 8.
 */
function textPresentation(node: SceneNode, mode: StudioMode, row: Record<string, unknown> | null) {
  if (node.kind !== 'text') return null;

  const shown = renderTextNode({
    node,
    font: getFont(node.fontFamily, node.fontWeight, node.italic),
    mode,
    row,
  });

  // The object falls back to its template so the canvas still draws, but the
  // reason must not vanish with it — an unresolved token that renders quietly
  // as "{{ guest }}" is a card that prints wrong.
  if (shown.error !== null) reportDiagnostic('tokens', 'error', shown.error);
  if (shown.overflow) {
    reportDiagnostic('auto-fit', 'warning', {
      code: 'TEXT_OVERFLOW',
      message: `"${shown.text}" does not fit its box at the minimum size.`,
      hint: 'Widen the box, lower the minimum size, or shorten the value.',
      objectId: node.id,
    });
  }

  return shown;
}

function buildFabricObject(
  node: SceneNode,
  fontsReady: boolean,
  mode: StudioMode,
  row: Record<string, unknown> | null,
): fabric.FabricObject | null {
  const props = toFabricProps(node);

  switch (node.kind) {
    case 'rect':
      return new fabric.Rect(props);
    case 'ellipse':
      return new fabric.Ellipse({ ...props, rx: node.width / 2, ry: node.height / 2 });
    case 'line':
      // Fabric's Line takes endpoints, not a box. Drawing the box diagonal
      // keeps the node's bounding geometry meaningful for snapping and PDF.
      return new fabric.Line([0, 0, node.width, node.height], props);
    case 'path':
      return new fabric.Path(node.d, props);
    case 'text': {
      const shown = textPresentation(node, mode, row);
      const text = new fabric.IText(shown?.text ?? node.text, {
        ...props,
        ...(shown === null ? {} : { fontSize: shown.fontSize }),
      });
      const box = fontsReady ? measuredTextBox(node) : null;
      if (box !== null) text.set({ width: box.width, height: box.height });
      return text;
    }
    case 'image':
    case 'group':
      // Images need the asset store (P4.1) and groups are a store-level
      // construct for now; neither is placeable from the toolbar yet.
      return null;
  }
}

export function StudioCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const objectsRef = useRef<Map<NodeId, fabric.FabricObject>>(new Map());
  const artboardRef = useRef<fabric.Rect | null>(null);
  /** True while we are writing Fabric → store, so the store → Fabric effect
   *  does not immediately overwrite what the user is dragging. */
  const fromFabric = useRef(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);

  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const tool = useCanvasStore((s) => s.tool);
  const artboard = useCanvasStore((s) => s.artboard);
  const mode = useStudioStore((s) => s.mode);
  const cursor = useStudioStore((s) => s.cursor);
  // The record source, not the edited table: a design may print only
  // accepted guests, and previewing the wrong set hides real problems.
  const rows = useDataStore((s) => s.records);

  const commitFromFabric = useCallback((label: string, coalesceKey?: string) => {
    const store = useCanvasStore.getState();
    const updated = store.nodes.map((node) => {
      const object = objectsRef.current.get(node.id);
      if (object === undefined) return node;
      const updated = fromFabricObject(
        {
          left: object.left,
          top: object.top,
          width: object.width,
          height: object.height,
          scaleX: object.scaleX,
          scaleY: object.scaleY,
          angle: object.angle,
          opacity: object.opacity,
          visible: object.visible,
          ...(object instanceof fabric.IText ? { text: object.text } : {}),
        },
        node,
      );

      // A text edit changes the string, so the box must be remeasured — the
      // width Fabric reports is its own, and the node must carry ours.
      const textChanged =
        updated.kind === 'text' && node.kind === 'text' && updated.text !== node.text;
      return textChanged ? withMeasuredSize(updated) : updated;
    });

    fromFabric.current = true;
    store.replaceNodes(updated, label, coalesceKey);
    fromFabric.current = false;
  }, []);

  // ---- create the canvas once -------------------------------------------
  useEffect(() => {
    const element = canvasElementRef.current;
    const container = containerRef.current;
    if (element === null || container === null) return;

    const canvas = new fabric.Canvas(element, {
      backgroundColor: '#d8d2c6',
      preserveObjectStacking: true,
      selection: true,
      uniformScaling: false,
    });
    canvasRef.current = canvas;

    const artboardRect = new fabric.Rect({
      left: 0,
      top: 0,
      width: artboard.width,
      height: artboard.height,
      fill: '#ffffff',
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
      shadow: new fabric.Shadow({ color: 'rgba(26,24,21,0.18)', blur: 12, offsetY: 2 }),
    });
    artboardRef.current = artboardRect;
    canvas.add(artboardRect);

    // Captured after the null guard: TypeScript loses the narrowing across
    // the closure boundary otherwise.
    const host = container;
    function resize() {
      canvas.setDimensions({ width: host.clientWidth, height: host.clientHeight });
      canvas.requestRenderAll();
    }
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    useCanvasStore.getState().zoomToFit({ width: host.clientWidth, height: host.clientHeight });

    return () => {
      observer.disconnect();
      objectsRef.current.clear();
      void canvas.dispose();
      canvasRef.current = null;
    };
  }, [artboard.width, artboard.height]);

  // ---- fonts -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void ensureFontsLoaded().then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- viewport ----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    // Zoom is a view transform only. Object geometry in Points never changes,
    // which is what keeps the canvas and the PDF in agreement.
    canvas.setViewportTransform([zoom, 0, 0, zoom, panX, panY]);
    canvas.requestRenderAll();
  }, [zoom, panX, panY]);

  // ---- store → fabric ----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || fromFabric.current) return;

    const objects = objectsRef.current;
    const currentRow = (rows[cursor] ?? null) as Record<string, unknown> | null;
    const renderable = renderableNodes(nodes);
    const live = new Set(renderable.map((node) => node.id));

    for (const [id, object] of objects) {
      if (!live.has(id)) {
        canvas.remove(object);
        objects.delete(id);
      }
    }

    for (const node of renderable) {
      const existing = objects.get(node.id);
      if (existing === undefined) {
        const created = buildFabricObject(node, fontsReady, mode, currentRow);
        if (created === null) continue;
        created.set({ nodeId: node.id } as Partial<fabric.FabricObject>);
        objects.set(node.id, created);
        canvas.add(created);
      } else {
        existing.set(toFabricProps(node));

        const shown = textPresentation(node, mode, currentRow);
        if (shown !== null) {
          existing.set({ text: shown.text, fontSize: shown.fontSize });
          // Overflow is signalled on the canvas as well as in the panel —
          // CLAUDE.md §4.7 forbids colour alone, and a rust outline is the
          // only cue visible while looking at the artboard.
          existing.set({
            stroke: shown.overflow ? '#a6401f' : null,
            strokeWidth: shown.overflow ? 0.5 : 0,
          });
        }

        // Guarded on fontsReady so the intent is explicit: before the face
        // loads there is nothing to measure against, and once it lands this
        // effect re-runs and resizes every text box.
        const box = fontsReady ? measuredTextBox(node) : null;
        if (box !== null) existing.set({ width: box.width, height: box.height });
        existing.setCoords();
      }
    }

    // Array order is z-order; the artboard stays at the bottom.
    const artboardRect = artboardRef.current;
    if (artboardRect !== null) canvas.moveObjectTo(artboardRect, 0);
    renderable.forEach((node, index) => {
      const object = objects.get(node.id);
      if (object !== undefined) canvas.moveObjectTo(object, index + 1);
    });

    // Exposed for browser tests: asserts what Fabric actually holds, rather
    // than what the layers tree claims. DEF-1 slipped through precisely
    // because only the tree was checked.
    setRenderedCount(objects.size);
    canvas.requestRenderAll();
  }, [nodes, fontsReady, mode, cursor, rows]);

  // ---- selection: store → fabric ----------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const wanted = selectedLeafIds(useCanvasStore.getState().nodes, selection)
      .map((id) => objectsRef.current.get(id))
      .filter((object): object is fabric.FabricObject => object !== undefined);

    // Compare against what Fabric already has. A timing flag cannot work here
    // because this effect runs after React commits, long after the flag was
    // cleared — value equality is the only reliable stop condition.
    const active = canvas.getActiveObjects();
    const same =
      active.length === wanted.length && wanted.every((object) => active.includes(object));
    if (same) return;

    canvas.discardActiveObject();
    if (wanted.length === 1 && wanted[0] !== undefined) {
      canvas.setActiveObject(wanted[0]);
    } else if (wanted.length > 1) {
      canvas.setActiveObject(new fabric.ActiveSelection(wanted, { canvas }));
    }
    canvas.requestRenderAll();
  }, [selection]);

  // ---- fabric → store ----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    function idsOf(objects: readonly fabric.FabricObject[]): NodeId[] {
      const ids: NodeId[] = [];
      for (const [id, object] of objectsRef.current) {
        if (objects.includes(object)) ids.push(id);
      }
      return ids;
    }

    function onSelection() {
      const active = canvas?.getActiveObjects() ?? [];
      fromFabric.current = true;
      useCanvasStore.getState().setSelection(idsOf(active));
      fromFabric.current = false;
    }

    function onModified() {
      commitFromFabric('Transform object');
    }

    function onMoving(event: { target?: fabric.FabricObject }) {
      const store = useCanvasStore.getState();
      const target = event.target;
      if (target === undefined || !store.snapEnabled) return;

      let movingId: NodeId | null = null;
      for (const [id, object] of objectsRef.current) {
        if (object === target) movingId = id;
      }
      if (movingId === null) return;

      const node = store.nodes.find((n) => n.id === movingId);
      if (node === undefined) return;

      const live: SceneNode = {
        ...node,
        x: points(target.left ?? node.x),
        y: points(target.top ?? node.y),
      };

      const targets = snapTargets(store.nodes, store.artboard, store.guides, movingId);
      const result = snap(live, targets, {
        threshold: SNAP_THRESHOLD_PX,
        zoom: store.zoom,
        enabled: store.snapEnabled,
      });

      target.set({ left: result.rect.x, top: result.rect.y });
    }

    function onWheel(event: { e: WheelEvent }) {
      const store = useCanvasStore.getState();
      event.e.preventDefault();
      event.e.stopPropagation();

      if (event.e.ctrlKey || event.e.metaKey) {
        const next = Math.min(Math.max(store.zoom * 0.999 ** event.e.deltaY, MIN_ZOOM), MAX_ZOOM);
        store.setZoom(next);
        return;
      }
      store.setPan(store.panX - event.e.deltaX, store.panY - event.e.deltaY);
    }

    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', onSelection);
    canvas.on('object:modified', onModified);
    canvas.on('object:moving', onMoving);
    canvas.on('mouse:wheel', onWheel);

    return () => {
      canvas.off('selection:created', onSelection);
      canvas.off('selection:updated', onSelection);
      canvas.off('selection:cleared', onSelection);
      canvas.off('object:modified', onModified);
      canvas.off('object:moving', onMoving);
      canvas.off('mouse:wheel', onWheel);
    };
  }, [commitFromFabric]);

  // ---- placement tools ---------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    canvas.selection = tool === 'select';
    canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';

    if (tool === 'select') return;

    function onMouseDown(event: { scenePoint: fabric.Point }) {
      const store = useCanvasStore.getState();
      const { x, y } = event.scenePoint;
      const node = placeNode(tool, points(x), points(y));
      if (node !== null) {
        store.addNode(node);
        store.setTool('select');
      }
    }

    canvas.on('mouse:down', onMouseDown);
    return () => {
      canvas.off('mouse:down', onMouseDown);
    };
  }, [tool]);

  return (
    <div
      ref={containerRef}
      data-testid="canvas-viewport"
      data-fabric-objects={renderedCount}
      data-fonts-ready={fontsReady}
      className="relative h-full w-full overflow-hidden bg-pasteboard"
    >
      <canvas ref={canvasElementRef} />
    </div>
  );
}

/** Default sizes are sensible for an 85 × 55mm card rather than arbitrary. */
function placeNode(tool: Tool, x: ReturnType<typeof points>, y: ReturnType<typeof points>) {
  switch (tool) {
    case 'rect':
      return rectNode({
        id: makeId('rect'),
        x,
        y,
        width: points(120),
        height: points(60),
        fill: { kind: 'solid', color: '#1a1815' },
      });
    case 'ellipse':
      return ellipseNode({
        id: makeId('ellipse'),
        x,
        y,
        width: points(80),
        height: points(80),
        fill: { kind: 'solid', color: '#1f3a5f' },
      });
    case 'line':
      return lineNode({ id: makeId('line'), x, y, width: points(120), height: points(0) });
    case 'text': {
      const node = textNode({
        id: makeId('text'),
        x,
        y,
        width: points(160),
        height: points(24),
        text: 'Text',
        fontSize: points(18),
      });
      // The NODE carries the measured size, not just the Fabric object. The
      // scene graph is what the PDF renderer reads and what the inspector
      // shows; sizing only the canvas object would leave both wrong.
      return withMeasuredSize(node);
    }
    case 'select':
      return null;
  }
}
