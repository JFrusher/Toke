import type { NodeId, SceneNode, TextNode } from '@/engine/scene/types';
import { walk } from '@/engine/scene/types';
import { autoFit } from '@/engine/text/autoFit';
import { getFont } from '@/engine/text/fontLoader';
import { hasTokenSyntax } from '@/engine/tokens/parser';
import { resolveTokens } from '@/engine/tokens/resolver';
import { isErr } from '@/lib/result';

/**
 * Scans every record before export and reports what will go wrong.
 *
 * The point is to find problems while they are still cheap. An overflowing
 * name is invisible in the editor unless you happen to cycle to that record,
 * and completely invisible until the cards come back from the printer.
 *
 * Findings WARN; they never block. A planner who knows one name is tight and
 * accepts it should not be stopped from printing.
 */

export type FindingKind = 'overflow' | 'unresolved' | 'empty' | 'font' | 'asset';

export type Finding = {
  readonly kind: FindingKind;
  readonly nodeId: NodeId;
  readonly nodeName: string;
  /** 0-based index into the record set. -1 when the problem is not
   *  record-specific (a misspelled column fails for every record). */
  readonly recordIndex: number;
  readonly detail: string;
};

export type PreflightReport = {
  readonly findings: readonly Finding[];
  readonly recordCount: number;
  readonly clean: boolean;
};

function textNodes(nodes: readonly SceneNode[]): TextNode[] {
  const found: TextNode[] = [];
  for (const node of walk(nodes)) {
    if (node.kind === 'text') found.push(node);
  }
  return found;
}

/**
 * Structural checks that do not depend on the record: every node either has
 * what it needs to print or it does not, whichever guest is on the card.
 */
function structuralFindings(
  nodes: readonly SceneNode[],
  assetIds: ReadonlySet<string> | undefined,
): Finding[] {
  const findings: Finding[] = [];

  for (const node of walk(nodes)) {
    if (node.kind === 'text') {
      const font = getFont(node.fontFamily, node.fontWeight, node.italic);
      const wanted = `${node.fontFamily} ${node.fontWeight}${node.italic ? ' italic' : ''}`;

      if (font === null) {
        findings.push({
          kind: 'font',
          nodeId: node.id,
          nodeName: node.name,
          recordIndex: -1,
          detail: `${wanted} is not loaded. Export will refuse rather than substitute a face.`,
        });
        continue;
      }

      // getFont falls back to the nearest weight so canvas and PDF agree, which
      // makes a substitution invisible: the proof and the print match each
      // other, and both are lighter or heavier than the design asked for.
      if (font.weight !== node.fontWeight || font.italic !== node.italic) {
        const got = `${font.weight}${font.italic ? ' italic' : ''}`;
        findings.push({
          kind: 'font',
          nodeId: node.id,
          nodeName: node.name,
          recordIndex: -1,
          detail: `${wanted} is not loaded; printing in ${node.fontFamily} ${got} instead.`,
        });
      }
    }

    // Only checked when the caller knows what exists. No set means "unknown",
    // and reporting every image as missing would be a false alarm on every run.
    if (node.kind === 'image' && assetIds !== undefined && !assetIds.has(node.assetId)) {
      findings.push({
        kind: 'asset',
        nodeId: node.id,
        nodeName: node.name,
        recordIndex: -1,
        detail: 'The image file is not in this project. Export will stop at this object.',
      });
    }
  }

  return findings;
}

export function preflight(input: {
  nodes: readonly SceneNode[];
  rows: readonly Record<string, unknown>[];
  /** Asset ids present in the store. Omit when unknown to skip the check. */
  assetIds?: ReadonlySet<string>;
}): PreflightReport {
  const findings: Finding[] = structuralFindings(input.nodes, input.assetIds);
  // hasTokenSyntax, not isTokenised: a malformed token does not parse, so
  // isTokenised reports false and the node would be skipped — hiding the
  // bindings most likely to be broken.
  const bound = textNodes(input.nodes).filter((node) => hasTokenSyntax(node.text));

  for (const node of bound) {
    const font = getFont(node.fontFamily, node.fontWeight, node.italic);
    // Reported once per node, not once per record: a misspelled column fails
    // on all 150 records, and 150 identical findings bury everything else.
    let reportedStructuralFailure = false;

    for (const [index, row] of input.rows.entries()) {
      const resolved = resolveTokens(node.text, row, {
        fallback: node.fallback,
        objectId: node.id,
      });

      if (isErr(resolved)) {
        if (!reportedStructuralFailure) {
          reportedStructuralFailure = true;
          findings.push({
            kind: 'unresolved',
            nodeId: node.id,
            nodeName: node.name,
            recordIndex: -1,
            detail: resolved.error.message,
          });
        }
        continue;
      }

      const text = resolved.value;

      if (text === '') {
        findings.push({
          kind: 'empty',
          nodeId: node.id,
          nodeName: node.name,
          recordIndex: index,
          detail: 'Resolves to nothing, and no fallback is set.',
        });
        continue;
      }

      // Auto-fit off means the author accepted whatever happens, so there is
      // nothing to warn about.
      if (node.autoFit === null || font === null) continue;

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

      if (fitted.overflow) {
        findings.push({
          kind: 'overflow',
          nodeId: node.id,
          nodeName: node.name,
          recordIndex: index,
          // The value, not just the record number: "record 3 overflows" sends
          // the user hunting through the grid for what is wrong with it.
          detail: `"${text}" does not fit at ${node.autoFit.minFontSize}pt.`,
        });
      }
    }
  }

  return {
    findings,
    recordCount: input.rows.length,
    clean: findings.length === 0,
  };
}

export type PreflightSummary = {
  readonly overflow: number;
  readonly unresolved: number;
  readonly empty: number;
  readonly font: number;
  readonly asset: number;
  readonly affectedRecords: number;
};

export function summarise(report: PreflightReport): PreflightSummary {
  const records = new Set<number>();
  let overflow = 0;
  let unresolved = 0;
  let empty = 0;
  let font = 0;
  let asset = 0;

  for (const finding of report.findings) {
    if (finding.recordIndex >= 0) records.add(finding.recordIndex);
    if (finding.kind === 'overflow') overflow += 1;
    if (finding.kind === 'unresolved') unresolved += 1;
    if (finding.kind === 'empty') empty += 1;
    if (finding.kind === 'font') font += 1;
    if (finding.kind === 'asset') asset += 1;
  }

  return { overflow, unresolved, empty, font, asset, affectedRecords: records.size };
}
