import { describe, expect, it } from 'vitest';
import { parseLength } from '@/engine/units/parse';
import { isErr, isOk } from '@/lib/result';

function expectPoints(input: string, defaultUnit: 'mm' | 'in' | 'pt', expected: number) {
  const result = parseLength(input, defaultUnit);
  if (!isOk(result)) {
    throw new Error(`expected ok, got error: ${result.error.message}`);
  }
  expect(Math.abs(result.value - expected)).toBeLessThan(1e-9);
}

describe('parseLength — explicit units', () => {
  it('parses millimetres', () => {
    expectPoints('85mm', 'mm', 240.94488188976382);
  });

  it('parses inches', () => {
    expectPoints('3.5in', 'mm', 252);
  });

  it('parses points', () => {
    expectPoints('24pt', 'mm', 24);
  });

  it('honours the explicit unit over the default unit', () => {
    expectPoints('1in', 'mm', 72);
  });
});

describe('parseLength — bare numbers use the default unit', () => {
  it('reads a bare number as millimetres when mm is the display unit', () => {
    expectPoints('85', 'mm', 240.94488188976382);
  });

  it('reads a bare number as points when pt is the display unit', () => {
    expectPoints('85', 'pt', 85);
  });

  it('reads a bare number as inches when in is the display unit', () => {
    expectPoints('1', 'in', 72);
  });
});

describe('parseLength — tolerated input', () => {
  it('tolerates surrounding whitespace', () => {
    expectPoints('  85mm  ', 'mm', 240.94488188976382);
  });

  it('tolerates a space before the unit', () => {
    expectPoints('85 mm', 'mm', 240.94488188976382);
  });

  it('is case insensitive', () => {
    expectPoints('85MM', 'mm', 240.94488188976382);
    expectPoints('1IN', 'mm', 72);
  });

  it('parses negatives', () => {
    expectPoints('-3mm', 'mm', -8.503937007874017);
  });

  it('parses a leading decimal point', () => {
    expectPoints('.5in', 'mm', 36);
  });

  it('parses a decimal value', () => {
    expectPoints('0.125in', 'mm', 9);
  });
});

describe('parseLength — rejected input returns Err, never throws', () => {
  const bad = [
    ['', 'empty string'],
    ['   ', 'whitespace only'],
    ['abc', 'letters'],
    ['85xyz', 'unknown unit'],
    ['85mmm', 'malformed unit'],
    ['mm', 'unit with no number'],
    ['.', 'bare decimal point'],
    ['85.', 'trailing decimal point'],
    ['8 5mm', 'internal space in number'],
    ['1e3mm', 'scientific notation'],
    ['NaN', 'NaN literal'],
    ['Infinity', 'Infinity literal'],
    ['--5mm', 'double negative'],
    ['85cm', 'unsupported unit'],
  ] as const;

  it.each(bad)('rejects %p (%s)', (input) => {
    const result = parseLength(input, 'mm');
    expect(isErr(result)).toBe(true);
  });

  it('reports a structured error naming the offending input', () => {
    const result = parseLength('85xyz', 'mm');
    if (!isErr(result)) {
      throw new Error('expected an error');
    }
    expect(result.error.code).toBe('INVALID_LENGTH');
    expect(result.error.message).toContain('85xyz');
  });

  it('suggests the supported units in the hint', () => {
    const result = parseLength('85cm', 'mm');
    if (!isErr(result)) {
      throw new Error('expected an error');
    }
    expect(result.error.hint).toMatch(/mm/);
  });
});

describe('parseLength — round trips with formatLength', () => {
  it.each(['mm', 'in', 'pt'] as const)('%s survives format then parse', async (unit) => {
    const { formatLength } = await import('@/engine/units/format');
    const { points } = await import('@/engine/units/types');

    const original = points(240.94488188976382);
    const parsed = parseLength(formatLength(original, unit, 9), unit);

    if (!isOk(parsed)) {
      throw new Error('expected ok');
    }
    expect(Math.abs(parsed.value - original)).toBeLessThan(1e-6);
  });
});
