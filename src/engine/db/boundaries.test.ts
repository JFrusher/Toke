/**
 * @vitest-environment node
 *
 * Architectural fitness test for CLAUDE.md §2.1 rule 1: the database worker
 * owns the SQLite handle and nothing else imports sql.js.
 *
 * This is the kind of rule that erodes the first time someone wants "just one
 * quick query" from a component, so it is enforced rather than documented.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DbReply, DbRequestEnvelope } from '@/engine/db/protocol';

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const FILES = sourceFiles(SRC).map((file) => ({
  path: relative(SRC, file).split(sep).join('/'),
  source: readFileSync(file, 'utf8'),
}));

describe('sql.js containment', () => {
  it('finds source files to check', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('is imported only by engine/db/database.ts', () => {
    const importers = FILES.filter(
      ({ source }) =>
        /from\s+['"]sql\.js['"]/.test(source) || /require\(['"]sql\.js['"]\)/.test(source),
    ).map(({ path }) => path);

    expect(importers).toEqual(['engine/db/database.ts']);
  });

  it('keeps raw SQL out of components', () => {
    const sqlKeyword = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE)\b/;
    const offenders = FILES.filter(
      ({ path, source }) =>
        path.startsWith('components/') && !path.includes('.test.') && sqlKeyword.test(source),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe('single text-measurement path', () => {
  // CLAUDE.md §2.1 rule 3. Canvas auto-fit and PDF layout must measure through
  // engine/text/measure.ts and nothing else. Two measurement sources disagree
  // by a fraction of a point — invisible on screen, and enough to put text
  // outside the trim on every card in a run.
  const ALLOWED = new Set([
    // The agreement harness compares the browser against fontkit; measuring
    // both sides is its entire purpose.
    'app/dev/measure/page.tsx',
  ]);

  it('ctx.measureText appears only in the agreement harness', () => {
    const offenders = FILES.filter(
      ({ path, source }) => !ALLOWED.has(path) && /\.measureText\s*\(/.test(source),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('measureText is exported from exactly one module', () => {
    const exporters = FILES.filter(
      ({ path, source }) =>
        !path.includes('.test.') && /export\s+function\s+measureText/.test(source),
    ).map(({ path }) => path);

    expect(exporters).toEqual(['engine/text/measure.ts']);
  });

  it('fontkit is imported only by the text engine and the harness', () => {
    const importers = FILES.filter(
      ({ path, source }) => !path.includes('.test.') && /from\s+['"]fontkit['"]/.test(source),
    ).map(({ path }) => path);

    expect(importers).toEqual(['engine/text/fontLoader.ts']);
  });
});

describe('worker boundary', () => {
  it('round trips every request shape through structuredClone', () => {
    // Behavioural, not textual. A non-cloneable value in the protocol fails at
    // runtime with a DataCloneError that is hard to trace back to its cause,
    // so the actual clone is exercised here.
    const requests: DbRequestEnvelope[] = [
      { id: 1, payload: { op: 'init' } },
      { id: 2, payload: { op: 'init', bytes: new Uint8Array([1, 2, 3]) } },
      { id: 3, payload: { op: 'query', sql: 'SELECT 1' } },
      { id: 4, payload: { op: 'query', sql: 'SELECT ?', params: ['a', 1, null] } },
      { id: 5, payload: { op: 'exec', sql: 'DELETE FROM t' } },
      { id: 6, payload: { op: 'export' } },
    ];

    for (const request of requests) {
      expect(structuredClone(request)).toEqual(request);
    }
  });

  it('round trips every reply shape through structuredClone', () => {
    const replies: DbReply[] = [
      { id: 1, ok: true, result: { op: 'init' } },
      {
        id: 2,
        ok: true,
        result: { op: 'query', rows: [{ a: 1, b: 'x', c: null }], columns: [{ name: 'a' }] },
      },
      { id: 3, ok: true, result: { op: 'exec', rowsModified: 4 } },
      { id: 4, ok: true, result: { op: 'export', bytes: new Uint8Array([9, 9]) } },
      { id: 5, ok: false, error: { code: 'SQL_ERROR', message: 'boom', hint: 'SELECT' } },
    ];

    for (const reply of replies) {
      expect(structuredClone(reply)).toEqual(reply);
    }
  });

  it('keeps the worker thin — behaviour belongs in database.ts', () => {
    const worker = FILES.find(({ path }) => path === 'engine/db/db.worker.ts');
    expect(worker).toBeDefined();
    const lines = (worker?.source ?? '').split('\n').length;
    expect(lines).toBeLessThan(120);
  });
});
