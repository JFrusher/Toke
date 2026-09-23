'use client';

import { useEffect, useState } from 'react';
import { ensureFontsLoaded, getFont } from '@/engine/text/fontLoader';
import { measureText } from '@/engine/text/measure';
import { points } from '@/engine/units/types';

/**
 * P5.3 — the measurement agreement check.
 *
 * Renders the browser's own advance width beside fontkit's for the same
 * string, font and size. These MUST agree: canvas auto-fit trusts fontkit,
 * and if the browser draws to a different width then text that fits on screen
 * lands outside the trim on every card in a run.
 *
 * The browser side deliberately uses ctx.measureText — the one place in the
 * codebase allowed to, and the reason the fitness test exempts this file.
 * Everywhere else, measuring through anything but engine/text/measure.ts is
 * how the two sides drift apart.
 */

const STRINGS = [
  'Ada',
  'Ada Lovelace',
  'Grace Hopper',
  'Eleanor Winterbourne',
  'Bartholomew Fitzgerald-Smythe',
  'iiiiiiiiii',
  'WWWWWWWWWW',
  'Mr & Mrs Ainsworth',
  'Table 12',
  'Jean Bartik',
  'Katherine Johnson',
  'Dorothy Vaughan',
  'Mary Jackson',
  'Annie Easley',
  'Evelyn Boyd Granville',
  'Hedy Lamarr',
  'Radia Perlman',
  'Barbara Liskov',
  'Frances Allen',
  'Margaret Hamilton',
] as const;

const SIZES = [8, 11, 14, 18, 24] as const;

type Row = {
  readonly text: string;
  readonly size: number;
  readonly weight: number;
  readonly italic: boolean;
  readonly browser: number;
  readonly fontkit: number;
  readonly delta: number;
};

const TOLERANCE = 0.5;

export default function MeasureAgreement() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      await ensureFontsLoaded();
      // Without this the first measurement can land before the face is live
      // and silently fall back to a system font.
      await document.fonts.ready;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        setFailure('No 2D context available.');
        return;
      }
      // What the studio canvas uses. Without it Chrome on Linux measures
      // hinted advances and disagrees with fontkit by up to 5pt at 24px.
      ctx.textRendering = 'geometricPrecision';

      const faces = [
        { weight: 400 as const, italic: false },
        { weight: 600 as const, italic: false },
        { weight: 400 as const, italic: true },
      ];

      const collected: Row[] = [];

      for (const face of faces) {
        const font = getFont('IBM Plex Sans', face.weight, face.italic);
        if (font === null) {
          setFailure(`Font not registered: ${face.weight} ${face.italic ? 'italic' : 'normal'}`);
          return;
        }

        for (const size of SIZES) {
          ctx.font = `${face.italic ? 'italic ' : ''}${face.weight} ${size}px "IBM Plex Sans"`;

          for (const text of STRINGS) {
            const browser = ctx.measureText(text).width;
            const measured = measureText({
              text,
              font,
              fontSize: points(size),
              tracking: 0,
              lineHeight: 1.2,
            }).width;

            collected.push({
              text,
              size,
              weight: face.weight,
              italic: face.italic,
              browser,
              fontkit: measured,
              delta: Math.abs(browser - measured),
            });
          }
        }
      }

      if (!cancelled) setRows(collected);
    }

    void run().catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (failure !== null) {
    return (
      <main style={{ padding: 24 }} data-testid="measure-failure">
        <p style={{ color: 'var(--overflow)' }}>{failure}</p>
      </main>
    );
  }

  if (rows === null) {
    return <main style={{ padding: 24 }}>Measuring…</main>;
  }

  const worst = rows.reduce((max, row) => Math.max(max, row.delta), 0);
  const failures = rows.filter((row) => row.delta > TOLERANCE);
  const worstRow = rows.find((row) => row.delta === worst);

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>
        Canvas ⇄ fontkit measurement agreement
      </h1>
      <p style={{ color: 'var(--ink-muted)', margin: '0 0 16px', fontSize: 12 }}>
        {rows.length} comparisons · 20 strings × 5 sizes × 3 faces. Tolerance {TOLERANCE}pt.
      </p>

      <p
        data-testid="agreement-summary"
        data-worst={worst.toFixed(4)}
        data-failures={failures.length}
        data-total={rows.length}
        style={{
          padding: '8px 12px',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 4,
          background: failures.length === 0 ? 'var(--accent-weak)' : 'transparent',
          color: failures.length === 0 ? 'var(--ok)' : 'var(--overflow)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {failures.length === 0
          ? `All ${rows.length} agree. Worst delta ${worst.toFixed(4)}pt.`
          : `${failures.length} of ${rows.length} exceed ${TOLERANCE}pt. Worst ${worst.toFixed(4)}pt${worstRow === undefined ? '' : ` ("${worstRow.text}" ${worstRow.weight}${worstRow.italic ? ' italic' : ''} ${worstRow.size}px: browser ${worstRow.browser.toFixed(2)}, fontkit ${worstRow.fontkit.toFixed(2)})`}.`}
      </p>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 11,
          marginTop: 16,
          fontFamily: 'var(--font-plex-mono)',
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--ink-muted)' }}>
            <th style={{ padding: '4px 8px 4px 0' }}>string</th>
            <th style={{ padding: '4px 8px 4px 0' }}>face</th>
            <th style={{ padding: '4px 8px 4px 0' }}>size</th>
            <th style={{ padding: '4px 8px 4px 0' }}>browser</th>
            <th style={{ padding: '4px 8px 4px 0' }}>fontkit</th>
            <th style={{ padding: '4px 8px 4px 0' }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => b.delta - a.delta)
            .slice(0, 25)
            .map((row) => (
              <tr
                key={`${row.text}-${row.size}-${row.weight}-${row.italic}`}
                style={{ borderTop: '1px solid var(--hairline)' }}
              >
                <td style={{ padding: '3px 8px 3px 0' }}>{row.text}</td>
                <td style={{ padding: '3px 8px 3px 0', color: 'var(--ink-muted)' }}>
                  {row.weight}
                  {row.italic ? 'i' : ''}
                </td>
                <td data-numeric style={{ padding: '3px 8px 3px 0' }}>
                  {row.size}
                </td>
                <td data-numeric style={{ padding: '3px 8px 3px 0' }}>
                  {row.browser.toFixed(3)}
                </td>
                <td data-numeric style={{ padding: '3px 8px 3px 0' }}>
                  {row.fontkit.toFixed(3)}
                </td>
                <td
                  data-numeric
                  style={{
                    padding: '3px 8px 3px 0',
                    color: row.delta > TOLERANCE ? 'var(--overflow)' : 'var(--ok)',
                  }}
                >
                  {row.delta.toFixed(4)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </main>
  );
}
