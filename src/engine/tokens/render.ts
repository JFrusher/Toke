import type { TextNode } from '@/engine/scene/types';
import { autoFit } from '@/engine/text/autoFit';
import type { LoadedFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { isTokenised } from '@/engine/tokens/parser';
import { resolveTokens } from '@/engine/tokens/resolver';
import type { AppError } from '@/lib/errors';
import { isErr } from '@/lib/result';

/**
 * Turns a text node into what should actually be drawn.
 *
 * ONE function, used by the canvas now and the PDF renderer in Phase 8. Two
 * implementations of "what does this text say and how big is it" is exactly
 * how a preview and a print diverge.
 */

export type StudioMode = 'token' | 'live';

export type RenderedText = {
  /** What to draw: the raw template in token mode, resolved values in live. */
  readonly text: string;
  readonly fontSize: number;
  /** Text does not fit its box even at the minimum size. */
  readonly overflow: boolean;
  /** True when the node contains at least one token. */
  readonly bound: boolean;
  /** Resolution or parse failure. Never thrown — it belongs in diagnostics. */
  readonly error: AppError | null;
};

export function renderTextNode(input: {
  node: TextNode;
  font: LoadedFont | null;
  mode: StudioMode;
  row: Record<string, unknown> | null;
}): RenderedText {
  const { node, font, mode, row } = input;
  const bound = isTokenised(node.text);

  // Token mode shows the template verbatim, so the author can see and edit the
  // binding. Auto-fit is deliberately NOT applied: shrinking a long
  // "{{ guests.first_name }}" would misrepresent the size real data prints at.
  if (mode === 'token' || !bound) {
    return {
      text: node.text,
      fontSize: node.fontSize,
      overflow: false,
      bound,
      error: null,
    };
  }

  if (row === null) {
    return { text: node.text, fontSize: node.fontSize, overflow: false, bound, error: null };
  }

  const resolved = resolveTokens(node.text, row, {
    fallback: node.fallback,
    objectId: node.id,
  });

  if (isErr(resolved)) {
    // Fall back to the template so the object stays visible and selectable;
    // a vanished object is harder to diagnose than a wrong one.
    return {
      text: node.text,
      fontSize: node.fontSize,
      overflow: false,
      bound,
      error: resolved.error,
    };
  }

  const text = resolved.value;

  if (font === null || node.autoFit === null) {
    return { text, fontSize: node.fontSize, overflow: false, bound, error: null };
  }

  const fitted = autoFit({
    text,
    font,
    box: { width: node.width, height: node.height },
    fontSize: node.fontSize,
    minFontSize: node.autoFit.minFontSize,
    tracking: node.tracking,
    lineHeight: node.lineHeight,
    mode: node.autoFit.mode,
  });

  return {
    text: fitted.text,
    fontSize: fitted.fontSize,
    overflow: fitted.overflow,
    bound,
    error: null,
  };
}

/** Natural size of a node's current text, for sizing an unbound object. */
export function naturalSize(
  node: TextNode,
  font: LoadedFont,
  text: string,
): { width: number; height: number } {
  const measured = measureText({
    text,
    font,
    fontSize: node.fontSize,
    tracking: node.tracking,
    lineHeight: node.lineHeight,
  });
  return { width: measured.width, height: measured.height };
}
