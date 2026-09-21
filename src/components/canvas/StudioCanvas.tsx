'use client';

import * as fabric from 'fabric';
import { useCallback, useEffect, useRef } from 'react';
import { snap, snapTargets } from '@/engine/canvas/snapping';
import { fromFabricObject, toFabricProps } from '@/engine/scene/fabric';
import { ellipseNode, lineNode, rectNode, textNode } from '@/engine/scene/factories';
import type { NodeId, SceneNode } from '@/engine/scene/types';
import { MAX_ZOOM, MIN_ZOOM, type Tool, useCanvasStore } from '@/engine/store/useCanvasStore';
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

function buildFabricObject(node: SceneNode): fabric.FabricObject | null {
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
    case 'text':
      return new fabric.IText(node.text, props);
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

  const nodes = useCanvasStore((s) => s.nodes);
  const selection = useCanvasStore((s) => s.selection);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const tool = useCanvasStore((s) => s.tool);
  const artboard = useCanvasStore((s) => s.artboard);

  const commitFromFabric = useCallback((label: string, coalesceKey?: string) => {
    const store = useCanvasStore.getState();
    const updated = store.nodes.map((node) => {
      const object = objectsRef.current.get(node.id);
      if (object === undefined) return node;
      return fromFabricObject(
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
    const live = new Set(nodes.map((node) => node.id));

    for (const [id, object] of objects) {
      if (!live.has(id)) {
        canvas.remove(object);
        objects.delete(id);
      }
    }

    for (const node of nodes) {
      const existing = objects.get(node.id);
      if (existing === undefined) {
        const created = buildFabricObject(node);
        if (created === null) continue;
        created.set({ nodeId: node.id } as Partial<fabric.FabricObject>);
        objects.set(node.id, created);
        canvas.add(created);
      } else {
        existing.set(toFabricProps(node));
        existing.setCoords();
      }
    }

    // Array order is z-order; the artboard stays at the bottom.
    const artboardRect = artboardRef.current;
    if (artboardRect !== null) canvas.moveObjectTo(artboardRect, 0);
    nodes.forEach((node, index) => {
      const object = objects.get(node.id);
      if (object !== undefined) canvas.moveObjectTo(object, index + 1);
    });

    canvas.requestRenderAll();
  }, [nodes]);

  // ---- selection: store → fabric ----------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const wanted = selection
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
    case 'text':
      return textNode({
        id: makeId('text'),
        x,
        y,
        width: points(160),
        height: points(24),
        text: 'Text',
        fontSize: points(18),
      });
    case 'select':
      return null;
  }
}
