import type { BindableProperty, SceneNode } from '@/engine/scene/types';
import { lookup } from '@/engine/tokens/resolver';
import { parseLength } from '@/engine/units/parse';
import { type AppError, appError } from '@/lib/errors';
import { err, isErr, ok, type Result } from '@/lib/result';

/**
 * Column-bound properties, resolved against one record-source row.
 *
 * SQL is the rule language: the record source computes a column — a CASE, a
 * join, anything SQLite can say — and an object's property reads it. There is
 * deliberately no second expression language on the canvas.
 *
 * Canvas (live mode), pre-flight and PDF export all call `bindTree`, so the
 * three cannot disagree about what a row looks like.
 */

export type BindContext = {
  readonly row: Record<string, unknown>;
  /** Image library, `imageKey(name)` → asset id. */
  readonly images: ReadonlyMap<string, string>;
};

export type BoundTree = {
  readonly nodes: readonly SceneNode[];
  /**
   * One per failing node. A failing node is kept exactly as authored, so the
   * canvas still draws; export refuses if this is non-empty.
   */
  readonly errors: readonly AppError[];
};

/** Case-insensitive, extension-free: "Gluten Free.PNG" and "gluten free" are one image. */
export function imageKey(name: string): string {
  return name
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase();
}

// Anything else counts as true, so a label column ("GF") works as a flag.
const FALSY = new Set(['', '0', 'false', 'no', 'n', 'f']);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isEmpty(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}

function invalid(node: SceneNode, property: BindableProperty, column: string, detail: string) {
  return appError('BINDING_INVALID_VALUE', `${node.name}: ${property} from "${column}" ${detail}`, {
    hint: 'Fix the value in the data, or compute a valid one in the record source.',
    objectId: node.id,
  });
}

function applyOne(
  node: SceneNode,
  property: BindableProperty,
  column: string,
  context: BindContext,
): Result<SceneNode> {
  const found = lookup(context.row, column);
  if (!found.found) {
    return err(
      appError(
        'BINDING_UNKNOWN_COLUMN',
        `${node.name}: the record source has no column "${column}".`,
        {
          hint: `Return ${column} from the record source, or change what ${property} is bound to.`,
          objectId: node.id,
        },
      ),
    );
  }
  const value = found.value;

  if (property === 'visible') {
    // Hide-only: data can hide an object, but never reveal one the author hid.
    const shown =
      typeof value === 'boolean'
        ? value
        : !FALSY.has(
            String(value ?? '')
              .trim()
              .toLowerCase(),
          );
    return ok({ ...node, visible: node.visible && shown });
  }

  // Every other property: an empty cell means "as designed".
  if (isEmpty(value)) return ok(node);
  const text = String(value).trim();

  switch (property) {
    case 'fill':
    case 'stroke': {
      if (!HEX.test(text))
        return err(invalid(node, property, column, `is "${text}", not a hex colour like #3D6B4A.`));
      if (property === 'fill') {
        return 'fill' in node
          ? ok({ ...node, fill: { kind: 'solid', color: text } } as SceneNode)
          : ok(node);
      }
      if (!('stroke' in node)) return ok(node);
      const stroke =
        node.stroke.kind === 'solid'
          ? { ...node.stroke, color: text }
          : { kind: 'solid' as const, color: text, width: 1 };
      return ok({ ...node, stroke } as SceneNode);
    }

    case 'asset': {
      if (node.kind !== 'image') return ok(node);
      const assetId = context.images.get(imageKey(text));
      if (assetId === undefined) {
        return err(
          appError(
            'BINDING_UNKNOWN_IMAGE',
            `${node.name}: no image called "${text}" in the library.`,
            {
              hint: 'Add it to the image library, or correct the name in the data.',
              objectId: node.id,
            },
          ),
        );
      }
      return ok({ ...node, assetId });
    }

    case 'x':
    case 'y':
    case 'width':
    case 'height': {
      // Millimetres when no unit is given: a spreadsheet of positions for a
      // printed card is written in mm far more often than in points.
      const length = parseLength(text, 'mm');
      if (isErr(length)) return err(invalid(node, property, column, `is "${text}", not a length.`));
      if ((property === 'width' || property === 'height') && length.value <= 0) {
        return err(invalid(node, property, column, `is ${text}; a size must be above zero.`));
      }
      return ok({ ...node, [property]: length.value });
    }
  }
}

function bindNode(node: SceneNode, context: BindContext, errors: AppError[]): SceneNode {
  let current: SceneNode =
    node.kind === 'group'
      ? { ...node, children: node.children.map((child) => bindNode(child, context, errors)) }
      : node;
  if (node.bind === undefined) return current;

  for (const [property, column] of Object.entries(node.bind) as [BindableProperty, string][]) {
    const applied = applyOne(current, property, column, context);
    if (isErr(applied)) {
      errors.push(applied.error);
      // All-or-nothing per node: half a binding is a card nobody designed.
      return node.kind === 'group'
        ? { ...node, children: (current as typeof node).children }
        : node;
    }
    current = applied.value;
  }
  return current;
}

export function bindTree(nodes: readonly SceneNode[], context: BindContext): BoundTree {
  const errors: AppError[] = [];
  const bound = nodes.map((node) => {
    const hasBinding = node.bind !== undefined || node.kind === 'group';
    return hasBinding ? bindNode(node, context, errors) : node;
  });
  return { nodes: bound, errors };
}

/** True when any node picks its image from the data, so the whole library may print. */
export function bindsImages(nodes: readonly SceneNode[]): boolean {
  return nodes.some(
    (node) =>
      node.bind?.asset !== undefined || (node.kind === 'group' && bindsImages(node.children)),
  );
}

/**
 * Puts an edited node's bound properties back to their authored values.
 *
 * In live mode the canvas shows the BOUND node, so a drag commits whatever
 * the data put there — writing a row's x, or its hidden state, into the
 * design. Bound properties belong to the data; the edit keeps everything else.
 */
export function keepAuthored(edited: SceneNode, authored: SceneNode): SceneNode {
  const bind = authored.bind;
  if (bind === undefined) return edited;

  const restored: Record<string, unknown> = { ...edited };
  for (const property of Object.keys(bind) as BindableProperty[]) {
    const key = property === 'asset' ? 'assetId' : property;
    if (key in authored) restored[key] = (authored as Record<string, unknown>)[key];
  }
  return restored as SceneNode;
}
