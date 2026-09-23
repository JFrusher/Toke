/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { preflight, summarise } from '@/engine/preflight/preflight';
import { groupNode, imageNode, rectNode, textNode } from '@/engine/scene/factories';
import type { SceneNode } from '@/engine/scene/types';
import { fontBytes, PLEX_SANS_REGULAR } from '@/engine/text/fixtures';
import { clearFonts, loadFont, registerFont } from '@/engine/text/fontLoader';
import { points } from '@/engine/units/types';
import { isOk } from '@/lib/result';

const p = points;

clearFonts();
const loaded = loadFont(fontBytes(PLEX_SANS_REGULAR), { family: 'IBM Plex Sans' });
if (!isOk(loaded)) throw new Error('fixture font failed to load');
registerFont(loaded.value);

/** A narrow box, so a long name overflows and a short one does not. */
function boundText(id: string, template: string, width = 60): SceneNode {
  return textNode({
    id,
    x: p(0),
    y: p(0),
    width: p(width),
    height: p(24),
    text: template,
    fontSize: p(18),
    autoFit: { mode: 'shrink', minFontSize: p(14) },
  });
}

const ROWS = [
  { first_name: 'Ada', last_name: 'Lovelace' },
  { first_name: 'Grace', last_name: 'Hopper' },
  { first_name: 'Bartholomew', last_name: 'Winterbourne-Fitzgerald' },
];

describe('clean run', () => {
  it('reports no findings when everything fits', () => {
    const report = preflight({
      nodes: [boundText('t1', '{{ first_name }}', 400)],
      rows: ROWS,
    });

    expect(report.findings).toEqual([]);
    expect(report.clean).toBe(true);
  });

  it('counts the records scanned', () => {
    const report = preflight({ nodes: [boundText('t1', '{{ first_name }}', 400)], rows: ROWS });
    expect(report.recordCount).toBe(3);
  });

  it('is clean for a design with no bound text', () => {
    const report = preflight({
      nodes: [rectNode({ id: 'r', x: p(0), y: p(0), width: p(10), height: p(10) })],
      rows: ROWS,
    });
    expect(report.clean).toBe(true);
  });

  it('is clean with no records', () => {
    const report = preflight({ nodes: [boundText('t1', '{{ first_name }}')], rows: [] });
    expect(report.clean).toBe(true);
    expect(report.recordCount).toBe(0);
  });
});

describe('overflow', () => {
  it('flags the records whose text will not fit', () => {
    // minFontSize 14 in a 60pt box: "Bartholomew" cannot shrink far enough.
    const report = preflight({ nodes: [boundText('t1', '{{ first_name }}')], rows: ROWS });

    const overflow = report.findings.filter((finding) => finding.kind === 'overflow');
    expect(overflow).toHaveLength(1);
    expect(overflow[0]).toMatchObject({ recordIndex: 2, nodeId: 't1' });
  });

  it('names the value that overflowed, not just the record number', () => {
    // "Record 3 overflows" sends the user hunting; the value tells them why.
    const report = preflight({ nodes: [boundText('t1', '{{ first_name }}')], rows: ROWS });
    expect(report.findings[0]?.detail).toContain('Bartholomew');
  });

  it('does not flag records that fit', () => {
    const report = preflight({ nodes: [boundText('t1', '{{ first_name }}')], rows: ROWS });
    const indices = report.findings.map((finding) => finding.recordIndex);
    expect(indices).not.toContain(0);
    expect(indices).not.toContain(1);
  });

  it('flags every offending node separately', () => {
    const report = preflight({
      nodes: [boundText('a', '{{ first_name }}'), boundText('b', '{{ last_name }}')],
      rows: ROWS,
    });
    const nodes = report.findings.map((finding) => finding.nodeId);
    expect(new Set(nodes)).toEqual(new Set(['a', 'b']));
  });

  it('ignores a node with auto-fit switched off', () => {
    // Overflow is the author's explicit choice there, not a surprise.
    const node = textNode({
      id: 't1',
      x: p(0),
      y: p(0),
      width: p(20),
      height: p(24),
      text: '{{ first_name }}',
      fontSize: p(18),
      autoFit: null,
    });
    expect(preflight({ nodes: [node], rows: ROWS }).findings).toEqual([]);
  });
});

describe('unresolved tokens', () => {
  it('flags an unknown column once, not once per record', () => {
    // A misspelled column fails on every one of 150 records; reporting it 150
    // times buries every other finding.
    const report = preflight({
      nodes: [boundText('t1', '{{ nope }}')],
      rows: ROWS,
    });

    const unresolved = report.findings.filter((finding) => finding.kind === 'unresolved');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.detail).toContain('nope');
  });

  it('flags a malformed token', () => {
    const report = preflight({ nodes: [boundText('t1', '{{ x | shout }}')], rows: ROWS });
    expect(report.findings.some((finding) => finding.kind === 'unresolved')).toBe(true);
  });

  it('is not clean when a token cannot resolve', () => {
    expect(preflight({ nodes: [boundText('t1', '{{ nope }}')], rows: ROWS }).clean).toBe(false);
  });
});

describe('empty values', () => {
  it('flags a record where a bound field is blank and there is no fallback', () => {
    const rows = [{ first_name: 'Ada' }, { first_name: '' }];
    const report = preflight({ nodes: [boundText('t1', '{{ first_name }}', 400)], rows });

    const empty = report.findings.filter((finding) => finding.kind === 'empty');
    expect(empty).toHaveLength(1);
    expect(empty[0]?.recordIndex).toBe(1);
  });

  it('does not flag an empty value when a fallback is set', () => {
    const node = textNode({
      id: 't1',
      x: p(0),
      y: p(0),
      width: p(400),
      height: p(24),
      text: '{{ first_name }}',
      fallback: '—',
    });
    const rows = [{ first_name: '' }];
    expect(preflight({ nodes: [node], rows }).findings).toEqual([]);
  });
});

describe('grouped nodes', () => {
  it('scans text inside a group', () => {
    const report = preflight({
      nodes: [
        {
          ...rectNode({ id: 'g', x: p(0), y: p(0), width: p(100), height: p(100) }),
          kind: 'group',
          children: [boundText('inner', '{{ first_name }}')],
        } as SceneNode,
      ],
      rows: ROWS,
    });
    expect(report.findings.some((finding) => finding.nodeId === 'inner')).toBe(true);
  });
});

describe('summarise', () => {
  it('counts findings by kind', () => {
    const report = preflight({
      nodes: [boundText('t1', '{{ first_name }}'), boundText('t2', '{{ nope }}')],
      rows: ROWS,
    });

    const counts = summarise(report);
    expect(counts.overflow).toBeGreaterThan(0);
    expect(counts.unresolved).toBe(1);
  });

  it('reports how many distinct records are affected', () => {
    const report = preflight({ nodes: [boundText('t1', '{{ first_name }}')], rows: ROWS });
    expect(summarise(report).affectedRecords).toBe(1);
  });
});

describe('performance', () => {
  it('scans 150 records well inside the two second budget', () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      first_name: index % 7 === 0 ? 'Bartholomew' : 'Ada',
      last_name: 'Lovelace',
    }));

    const started = Date.now();
    const report = preflight({
      nodes: [boundText('a', '{{ first_name }}'), boundText('b', '{{ last_name }}')],
      rows,
    });
    const elapsed = Date.now() - started;

    expect(report.recordCount).toBe(150);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('INC-31 — font availability', () => {
  // Only Plex Sans 400 upright is registered in this file.

  it('reports a face that is not loaded at all', () => {
    const report = preflight({
      nodes: [
        textNode({
          id: 't',
          x: points(0),
          y: points(0),
          width: points(100),
          height: points(20),
          text: 'Static',
          fontFamily: 'Garamond',
        }),
      ],
      rows: [{}],
    });

    const finding = report.findings.find((f) => f.kind === 'font');
    expect(finding?.nodeId).toBe('t');
    expect(finding?.recordIndex).toBe(-1);
  });

  it('reports a substituted weight, which would otherwise be silent', () => {
    // getFont falls back to the nearest weight so the canvas and PDF agree,
    // but the cards then print a weight lighter than the design asked for.
    const report = preflight({
      nodes: [
        textNode({
          id: 't',
          x: points(0),
          y: points(0),
          width: points(100),
          height: points(20),
          text: 'Static',
          fontWeight: 600,
        }),
      ],
      rows: [{}],
    });

    const finding = report.findings.find((f) => f.kind === 'font');
    expect(finding).toBeDefined();
    expect(finding?.detail).toContain('600');
    expect(finding?.detail).toContain('400');
  });

  it('checks unbound text too, since static text prints in a face as well', () => {
    const report = preflight({
      nodes: [
        textNode({
          id: 't',
          x: points(0),
          y: points(0),
          width: points(100),
          height: points(20),
          text: 'Table',
          italic: true,
        }),
      ],
      rows: [{}],
    });
    expect(report.findings.some((f) => f.kind === 'font')).toBe(true);
  });

  it('is clean when the exact face is loaded', () => {
    const report = preflight({
      nodes: [
        textNode({
          id: 't',
          x: points(0),
          y: points(0),
          width: points(100),
          height: points(20),
          text: 'Static',
        }),
      ],
      rows: [{}],
    });
    expect(report.findings.filter((f) => f.kind === 'font')).toHaveLength(0);
  });
});

describe('INC-22 — missing assets', () => {
  const photo = imageNode({
    id: 'photo',
    x: points(0),
    y: points(0),
    width: points(50),
    height: points(50),
    assetId: 'abc123',
  });

  it('reports an image whose bytes are not in the store', () => {
    const report = preflight({ nodes: [photo], rows: [{}], assetIds: new Set() });
    const finding = report.findings.find((f) => f.kind === 'asset');
    expect(finding?.nodeId).toBe('photo');
    expect(finding?.recordIndex).toBe(-1);
  });

  it('is clean when the asset is present', () => {
    const report = preflight({ nodes: [photo], rows: [{}], assetIds: new Set(['abc123']) });
    expect(report.findings.filter((f) => f.kind === 'asset')).toHaveLength(0);
  });

  it('skips the asset check when the caller cannot say what exists', () => {
    // No set means "unknown", not "empty" — reporting every image as missing
    // would be a false alarm on every run.
    const report = preflight({ nodes: [photo], rows: [{}] });
    expect(report.findings.filter((f) => f.kind === 'asset')).toHaveLength(0);
  });

  it('finds images inside groups', () => {
    const report = preflight({
      nodes: [
        groupNode({
          id: 'g',
          x: points(0),
          y: points(0),
          width: points(50),
          height: points(50),
          children: [photo],
        }),
      ],
      rows: [{}],
      assetIds: new Set(),
    });
    expect(report.findings.some((f) => f.kind === 'asset')).toBe(true);
  });
});
