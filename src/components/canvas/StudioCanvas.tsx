'use client';

import * as fabric from 'fabric';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasGuides } from '@/components/canvas/CanvasGuides';
import { CanvasRulers, RULER_SIZE, useCursorPosition } from '@/components/canvas/CanvasRulers';
import { PenPreview } from '@/components/canvas/PenPreview';
import { EMPTY_PATH, type PenPath, penToNode, shouldClose } from '@/engine/canvas/pen';
import { type SnapMatch, snap, snapTargets } from '@/engine/canvas/snapping';
import { getAsset, objectUrlFor } from '@/engine/persistence/assetStore';
import { fromFabricObject, toFabricProps } from '@/engine/scene/fabric';
import { ellipseNode, lineNode, rectNode, textNode } from '@/engine/scene/factories';
import { croppedAspect, fitBox } from '@/engine/scene/image';
import type { NodeId, SceneNode } from '@/engine/scene/types';
import { MAX_ZOOM, MIN_ZOOM, type Tool, useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { useStudioStore } from '@/engine/store/useStudioStore';
import { ensureFontsLoaded, getFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { renderTextNode, type StudioMode } from '@/engine/tokens/render';
import { points } from '@/engine/units/types';
import { isTypingTarget } from '@/lib/dom';
import { isOk } from '@/lib/result';

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
 * A member of a multi-selection keeps its position RELATIVE to the selection:
 * Fabric's ActiveSelection is a temporary group. The scene graph is absolute,
 * so both directions convert here, and nowhere else reads `left`/`top` raw.
 *
 * Skew is dropped: a rotated member scaled non-uniformly as part of a
 * selection picks some up, and a node has no skew to carry it.
 */
const TRANSFORM_KEYS = [
  'left',
  'top',
  'scaleX',
  'scaleY',
  'angle',
  'skewX',
  'skewY',
  'flipX',
  'flipY',
] as const;

/** The object's transform in scene space, whether or not it is selected with others. */
function sceneTransform(object: fabric.FabricObject) {
  const read = () => ({
    left: object.left,
    top: object.top,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    angle: object.angle,
  });
  if (object.group === undefined) return read();

  const saved = Object.fromEntries(TRANSFORM_KEYS.map((key) => [key, object[key]]));
  // Borrow Fabric's own decomposition, then put the relative values back:
  // the selection is still live and must not see its member move.
  fabric.util.applyTransformToObject(object, object.calcTransformMatrix());
  const absolute = read();
  object.set(saved);
  return absolute;
}

/** After scene-space props were set on a selected member, make them selection-relative. */
function placeInSelection(object: fabric.FabricObject) {
  if (object.group === undefined) return;
  const toGroup = fabric.util.invertTransform(object.group.calcTransformMatrix());
  fabric.util.applyTransformToObject(
    object,
    fabric.util.multiplyTransformMatrices(toGroup, object.calcOwnMatrix()),
  );
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

/**
 * Object URLs and decoded elements for every image node on the canvas.
 *
 * Assets live in IndexedDB as bytes, so a node cannot be drawn until its
 * bytes have been read and decoded. Loaded once per asset id and revoked on
 * unmount — an object URL that is never revoked keeps the whole image alive
 * for the life of the tab.
 */
function useImageAssets(nodes: readonly SceneNode[]) {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [elements, setElements] = useState<ReadonlyMap<string, HTMLImageElement>>(new Map());
  const loaded = useRef(new Map<string, string>());

  const ids = renderableNodes(nodes)
    .filter((node): node is Extract<SceneNode, { kind: 'image' }> => node.kind === 'image')
    .map((node) => node.assetId)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const wanted = ids === '' ? [] : ids.split(',');

    void (async () => {
      for (const id of wanted) {
        if (loaded.current.has(id)) continue;

        const asset = await getAsset(id);
        if (cancelled) return;
        if (!isOk(asset)) {
          reportDiagnostic('image', 'error', asset.error);
          continue;
        }

        const url = objectUrlFor(asset.value);
        loaded.current.set(id, url);

        const element = new Image();
        element.src = url;
        await element.decode().catch(() => undefined);
        if (cancelled) return;

        setUrls(new Map(loaded.current));
        setElements((current) => new Map(current).set(url, element));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ids]);

  // Revoked only on unmount: revoking when a node is deleted would break an
  // undo that brings it straight back.
  useEffect(() => {
    const urlsToRevoke = loaded.current;
    return () => {
      for (const url of urlsToRevoke.values()) URL.revokeObjectURL(url);
      urlsToRevoke.clear();
    };
  }, []);

  return { urls, elements };
}

function buildFabricObject(
  node: SceneNode,
  fontsReady: boolean,
  mode: StudioMode,
  row: Record<string, unknown> | null,
  imageUrls: ReadonlyMap<string, string>,
  imageElements: ReadonlyMap<string, HTMLImageElement>,
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
        // Uncached, so the glyphs are drawn on the main context, which is the
        // one carrying geometricPrecision (see resize()). A cache canvas is
        // created per object and would draw with hinted advances on Linux.
        objectCaching: false,
        ...(shown === null ? {} : { fontSize: shown.fontSize }),
      });
      const box = fontsReady ? measuredTextBox(node) : null;
      if (box !== null) text.set({ width: box.width, height: box.height });
      return text;
    }
    case 'image': {
      const url = imageUrls.get(node.assetId);
      // The bytes are loaded asynchronously from IndexedDB; until the object
      // URL exists, a frame stands in so the layout does not jump when it
      // arrives.
      if (url === undefined) {
        return new fabric.Rect({
          ...props,
          fill: 'transparent',
          stroke: '#C7BFB0',
          strokeDashArray: [4, 3],
        });
      }

      const element = imageElements.get(url);
      if (element === undefined) return null;

      const image = new fabric.FabricImage(element, props);
      // The cropped aspect, matching the PDF renderer exactly.
      const aspect = croppedAspect(
        { width: element.naturalWidth, height: element.naturalHeight },
        node.crop,
      );
      const placed = fitBox(node, aspect);
      const scale = { x: 1 / node.crop.width, y: 1 / node.crop.height };
      const drawn = {
        x: placed.x - node.crop.x * placed.width * scale.x,
        y: placed.y - node.crop.y * placed.height * scale.y,
        width: placed.width * scale.x,
        height: placed.height * scale.y,
      };
      const cropped = node.crop.width < 1 || node.crop.height < 1;

      // Scaled from the shared fitBox, so the canvas and the PDF crop to the
      // same rectangle. Two implementations of 'cover' is how a preview and a
      // print stop agreeing.
      image.set({
        scaleX: drawn.width / element.naturalWidth,
        scaleY: drawn.height / element.naturalHeight,
        left: node.x + drawn.x,
        top: node.y + drawn.y,
        // Cover overflows its frame by design; the clip keeps it off the
        // neighbouring artwork, matching the PDF clip path.
        clipPath:
          node.fit === 'cover' || cropped
            ? new fabric.Rect({
                left: -drawn.x,
                top: -drawn.y,
                width: node.width,
                height: node.height,
                originX: 'left',
                originY: 'top',
              })
            : undefined,
      });
      return image;
    }
    case 'group':
      // Groups are a store-level construct; children render flattened.
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
  const [size, setSize] = useState({ width: 0, height: 0 });
  // `pointer`, not `cursor`: the record cursor already owns that name here.
  const pointer = useCursorPosition(containerRef);
  /** Held space turns a left-drag into a pan, as it does in every design tool. */
  const spaceHeld = useRef(false);
  const [spacePanning, setSpacePanning] = useState(false);
  /**
   * The path being drawn with the pen, before it becomes a node.
   *
   * Kept out of the scene graph until it is finished: an in-progress path in
   * `nodes` would push a history entry per click and reach the PDF if the
   * user exported mid-draw.
   */
  const [penDraft, setPenDraft] = useState<PenPath>(EMPTY_PATH);
  /** Held Ctrl suspends snapping. A ref, because it is read inside a Fabric handler. */
  const suspendSnap = useRef(false);
  const [snapMatches, setSnapMatches] = useState<readonly SnapMatch[]>([]);
  const [fontsReady, setFontsReady] = useState(false);

  const nodes = useCanvasStore((s) => s.nodes);
  const { urls: imageUrls, elements: imageElements } = useImageAssets(nodes);
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
          ...sceneTransform(object),
          width: object.width,
          height: object.height,
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
      width: useCanvasStore.getState().artboard.width,
      height: useCanvasStore.getState().artboard.height,
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
      // Resizing a canvas resets its context state, so this is reapplied on
      // every resize. Without it, Chrome on Linux uses FreeType-hinted glyph
      // advances: up to 1.6% off fontkit's, so text drawn on screen stops
      // matching the width auto-fit measured and the PDF prints (P5.3).
      canvas.getContext().textRendering = 'geometricPrecision';
      // Mirrored into state so the rulers span exactly the drawing area; they
      // sit outside it and cannot read the Fabric canvas themselves.
      setSize({ width: host.clientWidth, height: host.clientHeight });
      canvas.requestRenderAll();
    }
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      objectsRef.current.clear();
      void canvas.dispose();
      canvasRef.current = null;
    };
    // Created ONCE. It used to be rebuilt on a change of artboard size, and
    // every listener effect below had already attached to the old canvas —
    // opening the tent-fold template left a canvas that ignored the mouse.
  }, []);

  // ---- artboard size ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const rect = artboardRef.current;
    if (canvas === null || container === null || rect === null) return;

    rect.set({ width: artboard.width, height: artboard.height });
    useCanvasStore
      .getState()
      .zoomToFit({ width: container.clientWidth, height: container.clientHeight });
    canvas.requestRenderAll();
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
        const created = buildFabricObject(
          node,
          fontsReady,
          mode,
          currentRow,
          imageUrls,
          imageElements,
        );
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
        placeInSelection(existing);
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
    // imageUrls and imageElements are dependencies, not incidental reads: the
    // bytes arrive from IndexedDB after the first render, and without them the
    // placeholder frame would never be replaced by the picture.
  }, [nodes, fontsReady, mode, cursor, rows, imageUrls, imageElements]);

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
      // Indicators belong to the gesture; leaving them up afterwards would
      // draw lines through artwork that is no longer moving.
      setSnapMatches([]);
      // The committed node is the source of truth again.
      useCanvasStore.getState().setLiveTransform(null);
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
        // Ctrl suspends snapping for the duration of a drag, which is how
        // every layout tool lets you place something a hair off a guide.
        enabled: store.snapEnabled && !suspendSnap.current,
      });

      target.set({ left: result.rect.x, top: result.rect.y });
      // Drawn by the overlay: `matches` has always been returned and nothing
      // ever showed it, so the canvas snapped silently.
      setSnapMatches(result.matches);

      // VER-5: the inspector reads this so its fields track the drag. It is
      // not the scene graph, so no history entry is pushed per mousemove.
      store.setLiveTransform({
        id: movingId,
        x: result.rect.x,
        y: result.rect.y,
        width: result.rect.width,
        height: result.rect.height,
      });
    }

    /** Live geometry while a corner handle is dragged. */
    function onScaling(event: { target?: fabric.FabricObject }) {
      const target = event.target;
      if (target === undefined) return;

      for (const [id, object] of objectsRef.current) {
        if (object !== target) continue;
        useCanvasStore.getState().setLiveTransform({
          id,
          x: target.left ?? 0,
          y: target.top ?? 0,
          width: (target.width ?? 0) * (target.scaleX ?? 1),
          height: (target.height ?? 0) * (target.scaleY ?? 1),
        });
        return;
      }
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

    /**
     * Space-drag and middle-drag pan.
     *
     * Both are the conventional gestures and neither existed — only the wheel
     * did, which is unusable on a mouse without horizontal scroll. Held space
     * suspends selection so the drag pans instead of marquee-selecting.
     */
    let panning: { x: number; y: number } | null = null;
    // Captured after the null guard above: TypeScript loses the narrowing
    // across a function declaration boundary.
    const surface = canvas;

    function beginPan(event: { e: MouseEvent | TouchEvent }) {
      const native = event.e;
      if (!(native instanceof MouseEvent)) return false;

      // Middle button, or left button while space is held.
      const wants = native.button === 1 || (spaceHeld.current && native.button === 0);
      if (!wants) return false;

      native.preventDefault();
      panning = { x: native.clientX, y: native.clientY };
      surface.setCursor('grabbing');
      return true;
    }

    function onPanMove(event: { e: MouseEvent | TouchEvent }) {
      if (panning === null) return;
      const native = event.e;
      if (!(native instanceof MouseEvent)) return;

      const store = useCanvasStore.getState();
      store.setPan(
        store.panX + (native.clientX - panning.x),
        store.panY + (native.clientY - panning.y),
      );
      panning = { x: native.clientX, y: native.clientY };
    }

    function endPan() {
      panning = null;
    }

    canvas.on('mouse:down:before', beginPan);
    canvas.on('mouse:move', onPanMove);
    canvas.on('mouse:up', endPan);

    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', onSelection);
    canvas.on('object:modified', onModified);
    canvas.on('object:moving', onMoving);
    canvas.on('object:scaling', onScaling);
    canvas.on('mouse:wheel', onWheel);

    return () => {
      canvas.off('mouse:down:before', beginPan);
      canvas.off('mouse:move', onPanMove);
      canvas.off('mouse:up', endPan);
      canvas.off('selection:created', onSelection);
      canvas.off('selection:updated', onSelection);
      canvas.off('selection:cleared', onSelection);
      canvas.off('object:modified', onModified);
      canvas.off('object:moving', onMoving);
      canvas.off('object:scaling', onScaling);
      canvas.off('mouse:wheel', onWheel);
    };
  }, [commitFromFabric]);

  // ---- space-to-pan ------------------------------------------------------
  useEffect(() => {
    function onDown(event: KeyboardEvent) {
      // Not while typing: space belongs to the text, and Fabric's editor is a
      // real textarea.
      if (event.key === 'Control' || event.key === 'Meta') suspendSnap.current = true;
      if (event.code !== 'Space' || isTypingTarget(event.target)) return;
      // Stops the page scrolling under the canvas on every space.
      event.preventDefault();
      spaceHeld.current = true;
      setSpacePanning(true);
    }

    function onUp(event: KeyboardEvent) {
      if (event.key === 'Control' || event.key === 'Meta') suspendSnap.current = false;
      if (event.code !== 'Space') return;
      spaceHeld.current = false;
      setSpacePanning(false);
    }

    // Released on blur as well: alt-tabbing away mid-drag would otherwise
    // leave the canvas stuck in pan mode with no key to let go of.
    function onBlur() {
      spaceHeld.current = false;
      suspendSnap.current = false;
      setSpacePanning(false);
    }

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // While space is held the canvas must not marquee-select under the drag.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const current = useCanvasStore.getState().tool;
    canvas.selection = !spacePanning && current === 'select';
    // skipTargetFind as well as selection: without it a space-drag that starts
    // over an object selects that object instead of panning, so the gesture
    // only works on empty pasteboard — which is where it is least needed.
    canvas.skipTargetFind = spacePanning || current === 'pen';
    canvas.defaultCursor = spacePanning ? 'grab' : current === 'select' ? 'default' : 'crosshair';
  }, [spacePanning]);

  // ---- pen ---------------------------------------------------------------
  const penRef = useRef<PenPath>(EMPTY_PATH);
  penRef.current = penDraft;

  /** Turns the draft into a node, or discards it if it is a lone click. */
  const finishPen = useCallback((closed: boolean) => {
    const draft = { ...penRef.current, closed };
    const node = penToNode(draft, makeId('path'));
    // One addNode for the whole path, so a single undo takes it back.
    if (node !== null) useCanvasStore.getState().addNode(node);
    setPenDraft(EMPTY_PATH);
  }, []);

  const attachPen = useCallback(
    (canvas: fabric.Canvas) => {
      let dragging = false;

      function onDown(event: { scenePoint: fabric.Point; e: MouseEvent | TouchEvent }) {
        // Space held means pan; the pan handler owns this press.
        if (spaceHeld.current) return;
        if (event.e instanceof MouseEvent && event.e.button !== 0) return;

        const point = { x: event.scenePoint.x, y: event.scenePoint.y };
        const zoom = useCanvasStore.getState().zoom;

        if (shouldClose(penRef.current, point, zoom)) {
          finishPen(true);
          return;
        }

        dragging = true;
        setPenDraft((draft) => ({
          ...draft,
          anchors: [...draft.anchors, { x: point.x, y: point.y, handle: null }],
        }));
      }

      function onMove(event: { scenePoint: fabric.Point }) {
        if (!dragging) return;
        setPenDraft((draft) => {
          const last = draft.anchors[draft.anchors.length - 1];
          if (last === undefined) return draft;

          const handle = { x: event.scenePoint.x - last.x, y: event.scenePoint.y - last.y };
          // A few pixels of wobble on a click is not a drag; without this every
          // corner the user meant to click comes out as a tiny curve.
          const pixels = Math.hypot(handle.x, handle.y) * useCanvasStore.getState().zoom;
          const next = { ...last, handle: pixels < 3 ? null : handle };
          return { ...draft, anchors: [...draft.anchors.slice(0, -1), next] };
        });
      }

      function onUp() {
        dragging = false;
      }

      canvas.on('mouse:down', onDown);
      canvas.on('mouse:move', onMove);
      canvas.on('mouse:up', onUp);
      return () => {
        canvas.off('mouse:down', onDown);
        canvas.off('mouse:move', onMove);
        canvas.off('mouse:up', onUp);
      };
    },
    [finishPen],
  );

  // Enter finishes, Escape abandons. Leaving the tool keeps what was drawn,
  // since switching to Select mid-path is how people say "done" in most tools.
  useEffect(() => {
    if (tool !== 'pen') {
      if (penRef.current.anchors.length > 0) finishPen(false);
      return;
    }

    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        finishPen(false);
        useCanvasStore.getState().setTool('select');
      }
      if (event.key === 'Escape') setPenDraft(EMPTY_PATH);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, finishPen]);

  // ---- placement tools ---------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    canvas.selection = tool === 'select';
    canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';

    // INC-35. Fabric's default is the other way round — corners preserve
    // aspect and Shift frees them — which is backwards from every design tool
    // and silently distorts a Stretch-fit photo.
    canvas.uniformScaling = false;
    canvas.uniScaleKey = 'shiftKey';

    // The pen clicks THROUGH existing objects: an anchor placed over a shape
    // must add a point, not select the shape.
    canvas.skipTargetFind = tool === 'pen';

    if (tool === 'select') return;
    if (tool === 'pen') return attachPen(canvas);

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
  }, [tool, attachPen]);

  return (
    <div
      data-testid="canvas-viewport"
      data-fabric-objects={renderedCount}
      data-fonts-ready={fontsReady}
      className="relative h-full w-full overflow-hidden bg-pasteboard"
    >
      <CanvasRulers width={size.width} height={size.height} cursor={pointer} />

      {/* Inset by the rulers rather than overlaid by them: an object hidden
          under a ruler cannot be clicked, and the artboard must fit the space
          that is actually drawable. */}
      <div
        ref={containerRef}
        className="absolute right-0 bottom-0"
        style={{ left: RULER_SIZE, top: RULER_SIZE }}
      >
        <canvas ref={canvasElementRef} />
        <CanvasGuides width={size.width} height={size.height} matches={snapMatches} />
        <PenPreview draft={penDraft} width={size.width} height={size.height} />
      </div>
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
    // The pen builds its node over several clicks; see the pen effect.
    case 'select':
    case 'pen':
      return null;
  }
}
