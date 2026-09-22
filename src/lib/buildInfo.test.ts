import { afterEach, describe, expect, it } from 'vitest';
import { type BuildInfo, formatBuildInfo, getBuildInfo } from '@/lib/buildInfo';

/* Doubles as the P0.2 harness smoke test: if the `@/` alias, jsdom environment
   or vitest projects config were broken, this file could not run at all. */

const ENV_KEYS = ['NEXT_PUBLIC_VERCEL_ENV', 'NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA'] as const;
const original = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('test harness', () => {
  it('provides a DOM (jsdom environment)', () => {
    expect(typeof document).toBe('object');
    expect(document.createElement('canvas').tagName).toBe('CANVAS');
  });
});

describe('getBuildInfo', () => {
  it('falls back to development when Vercel vars are absent', () => {
    delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

    expect(getBuildInfo()).toEqual({ env: 'development', commit: null });
  });

  it('reads a recognised deployment environment', () => {
    process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
    expect(getBuildInfo().env).toBe('preview');
  });

  it('rejects an unrecognised environment rather than trusting it', () => {
    process.env.NEXT_PUBLIC_VERCEL_ENV = 'staging-ish-nonsense';
    expect(getBuildInfo().env).toBe('development');
  });

  it('shortens the commit sha to 7 characters', () => {
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = '1ffdf0a9c3e4b5a6d7e8f90123456789abcdef01';
    expect(getBuildInfo().commit).toBe('1ffdf0a');
  });

  it('treats an empty sha as absent', () => {
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = '';
    expect(getBuildInfo().commit).toBeNull();
  });
});

describe('formatBuildInfo', () => {
  it('marks a local build', () => {
    const info: BuildInfo = { env: 'development', commit: null };
    expect(formatBuildInfo(info)).toBe('development (local)');
  });

  it('names the commit when there is one', () => {
    const info: BuildInfo = { env: 'production', commit: '6402349' };
    expect(formatBuildInfo(info)).toBe('production @ 6402349');
  });
});
