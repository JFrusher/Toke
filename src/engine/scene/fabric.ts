import type { Fill, SceneNode, Stroke } from '@/engine/scene/types';
import { assertNever } from '@/engine/scene/types';
import { points } from '@/engine/units/types';

/**
 * SceneNode ⇄ Fabric option objects.
 *
 * Deliberately structural: these functions produce and consume plain objects
 * rather than live Fabric instances. Fabric needs a canvas context, which
 * jsdom does not provide, and instantiating it here would test Fabric instead
 * of this mapping. The live construction happens in the canvas wrapper (P3.2)
 * and is covered by browser tests.
 *
 * Two conversions matter and are the usual source of bugs:
 *
 *   rotation  radians (engine) ⇄ degrees (Fabric)
 *   size      width/height (engine) ⇄ width/height × scale (Fabric)
 *
 * Fabric expresses a resize as a SCALE, not a new width. Left alone, the PDF
 * renderer would draw every resized object at its original size.
 */

const DEG_PER_RAD = 180 / Math.PI;

export type FabricProps = {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  visible: boolean;
  selectable: boolean;
  evented: boolean;
  originX: 'left';
  originY: 'top';
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  strokeDashArray?: number[] | null;
  strokeUniform?: boolean;
  paintFirst?: 'fill' | 'stroke';
  rx?: number;
  ry?: number;
  path?: string;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  textAlign?: string;
  charSpacing?: number;
  lineHeight?: number;
};

/** What we read back off a Fabric object. Everything is optional: Fabric omits defaults. */
export type FabricReadback = {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  opacity?: number;
  visible?: boolean;
  text?: string;
};

function fillValue(fill: Fill): string | null {
  // null, not '' or 'transparent': Fabric treats those inconsistently across
  // object types, and null is the documented "do not paint".
  return fill.kind === 'none' ? null : fill.color;
}

function strokeProps(stroke: Stroke) {
  if (stroke.kind === 'none') {
    return { stroke: null, strokeWidth: 0, strokeDashArray: null };
  }
  return {
    stroke: stroke.color,
    strokeWidth: stroke.width,
    strokeDashArray: stroke.dash === undefined ? null : [...stroke.dash],
  };
}

function common(node: SceneNode): FabricProps {
  return {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    // Size lives in width/height only. Keeping it in one place is what makes
    // the round trip exact.
    scaleX: 1,
    scaleY: 1,
    angle: node.rotation * DEG_PER_RAD,
    opacity: node.opacity,
    visible: node.visible,
    selectable: !node.locked,
    evented: !node.locked,
    // Fabric defaults to a centre origin, which would make left/top mean the
    // centre point and every inspector coordinate wrong.
    originX: 'left',
    originY: 'top',
  };
}

/** Stops a stroke inflating the bounding box — an 85mm card with a 1pt border
 *  must still measure 85mm, or it imposes incorrectly. */
const STROKE_GEOMETRY = { strokeUniform: true, paintFirst: 'fill' } as const;

export function toFabricProps(node: SceneNode): FabricProps {
  const shared = common(node);

  switch (node.kind) {
    case 'rect':
      return {
        ...shared,
        ...STROKE_GEOMETRY,
        fill: fillValue(node.fill),
        ...strokeProps(node.stroke),
        rx: node.cornerRadius,
        ry: node.cornerRadius,
      };

    case 'ellipse':
      return {
        ...shared,
        ...STROKE_GEOMETRY,
        fill: fillValue(node.fill),
        ...strokeProps(node.stroke),
      };

    case 'line':
      return { ...shared, ...STROKE_GEOMETRY, fill: null, ...strokeProps(node.stroke) };

    case 'path':
      return {
        ...shared,
        ...STROKE_GEOMETRY,
        path: node.d,
        fill: fillValue(node.fill),
        ...strokeProps(node.stroke),
      };

    case 'text':
      return {
        ...shared,
        fill: fillValue(node.fill),
        stroke: null,
        strokeWidth: 0,
        text: node.text,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        fontStyle: node.italic ? 'italic' : 'normal',
        textAlign: node.align,
        // Fabric measures charSpacing in 1/1000 em, not points.
        charSpacing: node.fontSize === 0 ? 0 : (node.tracking / node.fontSize) * 1000,
        lineHeight: node.lineHeight,
      };

    case 'image':
      return shared;

    case 'group':
      return shared;

    default:
      return assertNever(node, 'scene node kind');
  }
}

/**
 * Rebuild a node from what Fabric reports, using `source` for everything
 * Fabric does not own (identity, kind, paint, typography).
 */
export function fromFabricObject(readback: FabricReadback, source: SceneNode): SceneNode {
  const scaleX = readback.scaleX ?? 1;
  const scaleY = readback.scaleY ?? 1;

  const geometry = {
    x: points(readback.left ?? source.x),
    y: points(readback.top ?? source.y),
    // Bake the scale back into the size. A resize handle produces scale, and
    // leaving it there would desynchronise canvas from PDF.
    width: points((readback.width ?? source.width) * scaleX),
    height: points((readback.height ?? source.height) * scaleY),
    rotation: (readback.angle ?? source.rotation * DEG_PER_RAD) / DEG_PER_RAD,
    opacity: readback.opacity ?? source.opacity,
    visible: readback.visible ?? source.visible,
  };

  if (source.kind === 'text' && readback.text !== undefined) {
    return { ...source, ...geometry, text: readback.text };
  }

  return { ...source, ...geometry };
}
