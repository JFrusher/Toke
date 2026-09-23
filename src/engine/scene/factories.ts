import type {
  AutoFitConfig,
  CropRect,
  EllipseNode,
  Fill,
  FontWeight,
  GroupNode,
  ImageFit,
  ImageNode,
  LineNode,
  NodeBase,
  NodeId,
  PathNode,
  RectNode,
  SceneNode,
  Stroke,
  TextAlign,
  TextNode,
} from '@/engine/scene/types';
import { FULL_CROP, NO_FILL, NO_STROKE } from '@/engine/scene/types';
import { type Points, points } from '@/engine/units/types';

/**
 * Node constructors. Every node is created through one of these so defaults
 * live in exactly one place — a node assembled by hand somewhere else is how
 * an object ends up with `opacity: undefined` and vanishes from the PDF.
 */

const INK = '#1a1815';

type BaseInput = {
  id: NodeId;
  x: Points;
  y: Points;
  width: Points;
  height: Points;
  name?: string;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
};

function base(input: BaseInput, defaultName: string): NodeBase {
  return {
    id: input.id,
    name: input.name ?? defaultName,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    rotation: input.rotation ?? 0,
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
  };
}

export function rectNode(
  input: BaseInput & { fill?: Fill; stroke?: Stroke; cornerRadius?: Points },
): RectNode {
  return {
    ...base(input, 'Rectangle'),
    kind: 'rect',
    fill: input.fill ?? NO_FILL,
    stroke: input.stroke ?? NO_STROKE,
    cornerRadius: input.cornerRadius ?? points(0),
  };
}

export function ellipseNode(input: BaseInput & { fill?: Fill; stroke?: Stroke }): EllipseNode {
  return {
    ...base(input, 'Ellipse'),
    kind: 'ellipse',
    fill: input.fill ?? NO_FILL,
    stroke: input.stroke ?? NO_STROKE,
  };
}

export function lineNode(input: BaseInput & { stroke?: Stroke }): LineNode {
  return {
    ...base(input, 'Line'),
    kind: 'line',
    stroke: input.stroke ?? { kind: 'solid', color: INK, width: points(1) },
  };
}

export function pathNode(input: BaseInput & { d: string; fill?: Fill; stroke?: Stroke }): PathNode {
  return {
    ...base(input, 'Path'),
    kind: 'path',
    d: input.d,
    fill: input.fill ?? NO_FILL,
    stroke: input.stroke ?? { kind: 'solid', color: INK, width: points(1) },
  };
}

export function textNode(
  input: BaseInput & {
    text: string;
    fontFamily?: string;
    fontSize?: Points;
    fontWeight?: FontWeight;
    italic?: boolean;
    align?: TextAlign;
    tracking?: number;
    lineHeight?: number;
    fill?: Fill;
    fallback?: string;
    autoFit?: AutoFitConfig | null;
  },
): TextNode {
  return {
    ...base(input, 'Text'),
    kind: 'text',
    text: input.text,
    fontFamily: input.fontFamily ?? 'IBM Plex Sans',
    fontSize: input.fontSize ?? points(12),
    fontWeight: input.fontWeight ?? 400,
    italic: input.italic ?? false,
    align: input.align ?? 'left',
    tracking: input.tracking ?? 0,
    lineHeight: input.lineHeight ?? 1.2,
    // Text is painted, not outlined. A default stroke would double every
    // glyph edge in the PDF.
    fill: input.fill ?? { kind: 'solid', color: INK },
    fallback: input.fallback ?? '',
    // Shrink by default: silently overflowing the trim is the worse failure,
    // and it is invisible until the cards are printed.
    autoFit:
      input.autoFit === undefined ? { mode: 'shrink', minFontSize: points(6) } : input.autoFit,
  };
}

export function imageNode(
  input: BaseInput & { assetId: string; fit?: ImageFit; crop?: CropRect },
): ImageNode {
  return {
    ...base(input, 'Image'),
    kind: 'image',
    assetId: input.assetId,
    fit: input.fit ?? 'contain',
    crop: input.crop ?? FULL_CROP,
  };
}

export function groupNode(input: BaseInput & { children: readonly SceneNode[] }): GroupNode {
  return {
    ...base(input, 'Group'),
    kind: 'group',
    children: input.children,
  };
}
