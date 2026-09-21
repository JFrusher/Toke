import { describe, expect, it } from 'vitest';
import { formatLength, formatNumber } from '@/engine/units/format';
import { points } from '@/engine/units/types';

describe('formatLength', () => {
  it('renders a place-card width in millimetres', () => {
    expect(formatLength(points(240.94488188976382), 'mm')).toBe('85mm');
  });

  it('renders points unchanged', () => {
    expect(formatLength(points(24), 'pt')).toBe('24pt');
  });

  it('renders inches', () => {
    expect(formatLength(points(72), 'in')).toBe('1in');
  });

  it('trims trailing zeros rather than padding to fixed precision', () => {
    // "85.00mm" in a dense numeric field is noise.
    expect(formatLength(points(240.94488188976382), 'mm')).not.toContain('.00');
  });

  it('keeps significant decimals', () => {
    expect(formatLength(points(241.9448818897638), 'mm')).toBe('85.35mm');
  });

  it('rounds to the unit default precision', () => {
    // 2dp for mm — finer than any cutting tolerance.
    expect(formatLength(points(240.96), 'mm')).toBe('85.01mm');
  });

  it('accepts an explicit precision', () => {
    expect(formatLength(points(240.94488188976382), 'mm', 4)).toBe('85mm');
    expect(formatLength(points(240.96), 'mm', 4)).toBe('85.0053mm');
  });

  it('renders zero without a sign', () => {
    expect(formatLength(points(0), 'mm')).toBe('0mm');
  });

  it('renders negatives', () => {
    expect(formatLength(points(-8.503937007874017), 'mm')).toBe('-3mm');
  });

  it('does not produce negative zero', () => {
    expect(formatLength(points(-0.0001), 'mm')).toBe('0mm');
  });
});

describe('formatNumber', () => {
  it('formats without a unit suffix, for numeric input fields', () => {
    expect(formatNumber(points(240.94488188976382), 'mm')).toBe('85');
  });

  it('trims trailing zeros', () => {
    expect(formatNumber(points(72), 'in')).toBe('1');
  });
});
