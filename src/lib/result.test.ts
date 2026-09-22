import { describe, expect, it } from 'vitest';
import { type AppError, appError } from '@/lib/errors';
import { err, isErr, isOk, ok, type Result, unwrapOr } from '@/lib/result';

describe('ok / err', () => {
  it('wraps a success value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('wraps an error value', () => {
    const e = appError('INVALID_LENGTH', 'nope');
    expect(err(e)).toEqual({ ok: false, error: e });
  });

  it('treats a falsy success value as success', () => {
    // The classic Result bug: `if (result.value)` instead of `if (result.ok)`.
    expect(isOk(ok(0))).toBe(true);
    expect(isOk(ok(''))).toBe(true);
    expect(isOk(ok(null))).toBe(true);
  });
});

describe('isOk / isErr', () => {
  it('narrows a success result', () => {
    const r: Result<number> = ok(1);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) {
      expect(r.value).toBe(1);
    }
  });

  it('narrows an error result', () => {
    const r: Result<number> = err(appError('INVALID_LENGTH', 'bad'));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('INVALID_LENGTH');
    }
  });
});

describe('unwrapOr', () => {
  it('returns the value when ok', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
  });

  it('returns the fallback when err', () => {
    expect(unwrapOr(err(appError('INVALID_LENGTH', 'bad')), 0)).toBe(0);
  });

  it('returns a falsy value rather than the fallback', () => {
    expect(unwrapOr(ok(0), 99)).toBe(0);
  });
});

describe('appError', () => {
  it('carries a code and message', () => {
    const e = appError('INVALID_LENGTH', 'Cannot parse "abc"');
    expect(e).toEqual({ code: 'INVALID_LENGTH', message: 'Cannot parse "abc"' });
  });

  it('carries an optional hint and objectId for the diagnostics panel', () => {
    const e: AppError = appError('INVALID_LENGTH', 'Cannot parse "abc"', {
      hint: 'Try 85mm',
      objectId: 'node-3',
    });
    expect(e.hint).toBe('Try 85mm');
    expect(e.objectId).toBe('node-3');
  });

  it('omits absent optional fields rather than setting them undefined', () => {
    // exactOptionalPropertyTypes is on; an explicit undefined is not the same
    // as an absent key, and `toEqual` would not catch the difference.
    expect(Object.hasOwn(appError('INVALID_LENGTH', 'x'), 'hint')).toBe(false);
  });
});
