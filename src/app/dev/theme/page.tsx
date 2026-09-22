'use client';

import { useEffect, useState } from 'react';
import { contrastRatio } from '@/engine/theme/contrast';

/* Design-system reference sheet. Reads COMPUTED custom-property values from
   the document rather than a TypeScript copy, so it proves the tokens actually
   resolve in the browser — P0.5's acceptance criterion.

   The audit that gates CI is src/engine/theme/contrast.test.ts. This page is
   for looking at the thing. */

const SURFACES = ['paper', 'pasteboard', 'panel', 'panel-raised'] as const;
const LINES = ['hairline', 'hairline-strong', 'border-control'] as const;
const INKS = ['ink', 'ink-muted', 'ink-subtle', 'ink-disabled'] as const;
const ACCENTS = ['accent', 'accent-weak'] as const;
const SEMANTIC = ['bound', 'overflow', 'conditional', 'ok'] as const;

const TEXT_SURFACES = ['panel', 'panel-raised', 'paper'] as const;

type Resolved = Record<string, string>;

function readTokens(names: readonly string[]): Resolved {
  const style = getComputedStyle(document.documentElement);
  const out: Resolved = {};
  for (const name of names) {
    out[name] = style.getPropertyValue(`--${name}`).trim();
  }
  return out;
}

const ALL = [...SURFACES, ...LINES, ...INKS, ...ACCENTS, ...SEMANTIC];

function Verdict({ ratio, threshold }: { ratio: number; threshold: number }) {
  const passes = ratio >= threshold;
  return (
    <span
      data-numeric
      style={{ color: passes ? 'var(--ok)' : 'var(--overflow)' }}
      title={passes ? `meets ${threshold}:1` : `below ${threshold}:1`}
    >
      {ratio.toFixed(2)}
      {passes ? '' : ' ✕'}
    </span>
  );
}

export default function ThemeReference() {
  const [tokens, setTokens] = useState<Resolved | null>(null);

  useEffect(() => {
    setTokens(readTokens(ALL));
  }, []);

  if (tokens === null) {
    return <main style={{ padding: 24 }}>Reading computed tokens…</main>;
  }

  const missing = ALL.filter((name) => !tokens[name]);

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Theme reference</h1>
      <p style={{ color: 'var(--ink-muted)', margin: '0 0 24px' }}>
        Values read from{' '}
        <code style={{ fontFamily: 'var(--font-plex-mono)' }}>getComputedStyle</code>, contrast
        computed live.
      </p>

      {missing.length > 0 && (
        <p style={{ color: 'var(--overflow)' }}>Unresolved tokens: {missing.join(', ')}</p>
      )}

      {(
        [
          ['Surfaces', SURFACES],
          ['Lines', LINES],
          ['Ink', INKS],
          ['Accent', ACCENTS],
          ['Semantic — colour is data', SEMANTIC],
        ] as const
      ).map(([heading, group]) => (
        <section key={heading} style={{ marginBottom: 28 }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--ink-muted)',
              margin: '0 0 8px',
            }}
          >
            {heading}
          </h2>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--ink-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px 4px 0', fontWeight: 500 }} />
                <th style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>token</th>
                <th style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>value</th>
                {TEXT_SURFACES.map((s) => (
                  <th key={s} style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>
                    on {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.map((name) => {
                const value = tokens[name] ?? '';
                return (
                  <tr key={name} style={{ borderTop: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '6px 8px 6px 0', width: 40 }}>
                      <span
                        style={{
                          display: 'block',
                          width: 32,
                          height: 20,
                          background: value,
                          border: '1px solid var(--border-control)',
                          borderRadius: 'var(--radius-control)',
                        }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px 6px 0', fontFamily: 'var(--font-plex-mono)' }}>
                      --{name}
                    </td>
                    <td
                      data-numeric
                      style={{
                        padding: '6px 8px 6px 0',
                        fontFamily: 'var(--font-plex-mono)',
                        color: 'var(--ink-muted)',
                      }}
                    >
                      {value}
                    </td>
                    {TEXT_SURFACES.map((surface) => {
                      const bg = tokens[surface];
                      const ok = value && bg;
                      return (
                        <td
                          key={surface}
                          style={{
                            padding: '6px 8px 6px 0',
                            fontFamily: 'var(--font-plex-mono)',
                          }}
                        >
                          {ok ? (
                            <Verdict
                              ratio={contrastRatio(value, bg)}
                              threshold={name === 'border-control' ? 3 : 4.5}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <section>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-muted)',
            margin: '0 0 8px',
          }}
        >
          Type
        </h2>
        <div style={{ display: 'grid', gap: 6 }}>
          {[11, 12, 13, 15, 18, 24].map((size) => (
            <div key={size} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span
                data-numeric
                style={{
                  width: 32,
                  color: 'var(--ink-muted)',
                  fontFamily: 'var(--font-plex-mono)',
                  fontSize: 11,
                }}
              >
                {size}
              </span>
              <span style={{ fontSize: size }}>Trim 85 × 55mm · bleed 3mm · 10-up on A4</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
            <span
              style={{
                width: 32,
                color: 'var(--ink-muted)',
                fontFamily: 'var(--font-plex-mono)',
                fontSize: 11,
              }}
            >
              mono
            </span>
            <span data-numeric style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 13 }}>
              240.945pt 841.890pt 0123456789
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
