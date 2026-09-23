import type { Points } from '@/engine/units/types';

/**
 * The scene graph.
 *
 * This is the single serialisation format for a design, and it has three
 * consumers that must all agree (CLAUDE.md §2.1):
 *
 *   1. Fabric, on the main thread, for editing.
 *   2. The PDF renderer, in a worker, for export.
 *   3. The .toke project file, on disk.
 *
 * It must therefore stay structured-cloneable: plain objects, primitives and
 * typed arrays only. No class instances, no functions, no Fabric references.
 *
 * Geometry is in Points with the origin at the top-left of the artboard.
 * Rotation is in RADIANS — Fabric uses degrees and converts at the boundary,
 * because everything else in the engine (matrices, fold panels) is radians and
 * two conventions in one codebase is how sign errors get in.
 */

export type NodeId = string;

export type Fill = { readonly kind: 'none' } | { readonly kind: 'solid'; readonly color: string };

export type Stroke =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'solid';
      readonly color: string;
      readonly width: Points;
      readonly dash?: readonly number[];
    };

export const NO_FILL: Fill = { kind: 'none' };
export const NO_STROKE: Stroke = { kind: 'none' };

/** Properties every node carries. Geometry is the unrotated bounding box. */
export type NodeBase = {
  readonly id: NodeId;
  readonly name: string;
  readonly x: Points;
  readonly y: Points;
  readonly width: Points;
  readonly height: Points;
  /** Radians, clockwise, about the node's own centre. */
  readonly rotation: number;
  /** 0–1. Multiplies through group nesting. */
  readonly opacity: number;
  readonly visible: boolean;
  readonly locked: boolean;
};

export type TextAlign = 'left' | 'center' | 'right';
export type FontWeight = 400 | 500 | 600;

export type AutoFitConfig = {
  readonly mode: 'shrink' | 'truncate' | 'wrap';
  readonly minFontSize: Points;
};

export type TextNode = NodeBase & {
  readonly kind: 'text';
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: Points;
  readonly fontWeight: FontWeight;
  readonly italic: boolean;
  readonly align: TextAlign;
  /** Letter spacing, in Points. */
  readonly tracking: number;
  /** Multiple of font size. */
  readonly lineHeight: number;
  readonly fill: Fill;
  /**
   * Shown when a token resolves to nothing. The token syntax in `text` IS the
   * binding — there is no separate binding object to keep in sync with it.
   */
  readonly fallback: string;
  /** null means render at the authored size and let it overflow. */
  readonly autoFit: AutoFitConfig | null;
};

export type RectNode = NodeBase & {
  readonly kind: 'rect';
  readonly fill: Fill;
  readonly stroke: Stroke;
  readonly cornerRadius: Points;
};

export type EllipseNode = NodeBase & {
  readonly kind: 'ellipse';
  readonly fill: Fill;
  readonly stroke: Stroke;
};

export type LineNode = NodeBase & {
  readonly kind: 'line';
  readonly stroke: Stroke;
};

export type PathNode = NodeBase & {
  readonly kind: 'path';
  /** SVG path data, in the node's local space. */
  readonly d: string;
  readonly fill: Fill;
  readonly stroke: Stroke;
};

export type ImageFit = 'fill' | 'contain' | 'cover';

/**
 * The visible region of an image, as fractions of its natural size.
 *
 * Fractions rather than pixels so a crop survives the picture being replaced
 * with a different resolution of the same shot, which is exactly what happens
 * when someone swaps a proof for a print-quality file.
 *
 * `{ x: 0, y: 0, width: 1, height: 1 }` is the whole image.
 */
export type CropRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export type ImageNode = NodeBase & {
  readonly kind: 'image';
  /** Content hash into the asset store (P4.1), never a data URI. */
  readonly assetId: string;
  readonly fit: ImageFit;
  /** Visible region of the source. Absent means the whole image. */
  readonly crop: CropRect;
};

export type GroupNode = NodeBase & {
  readonly kind: 'group';
  /** Array order IS z-order: later entries paint on top. */
  readonly children: readonly SceneNode[];
};

export type SceneNode =
  | TextNode
  | RectNode
  | EllipseNode
  | LineNode
  | PathNode
  | ImageNode
  | GroupNode;

export type SceneNodeKind = SceneNode['kind'];

/**
 * A whole design's contents. Array order is z-order, bottom to top — the same
 * convention as a PDF content stream, so export needs no reversal.
 */
export type Scene = {
  readonly nodes: readonly SceneNode[];
};

/**
 * Exhaustiveness guard. Adding a node kind without handling it somewhere makes
 * the `never` assignment a compile error rather than a silent fallthrough that
 * drops the object from the PDF.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}

export function isGroup(node: SceneNode): node is GroupNode {
  return node.kind === 'group';
}

/** Depth-first walk in paint order. */
export function* walk(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    if (isGroup(node)) yield* walk(node.children);
  }
}

export function findNode(nodes: readonly SceneNode[], id: NodeId): SceneNode | null {
  for (const node of walk(nodes)) {
    if (node.id === id) return node;
  }
  return null;
}
