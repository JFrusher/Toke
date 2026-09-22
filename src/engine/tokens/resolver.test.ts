import { describe, expect, it } from 'vitest';
import { applyFormatters, FORMATTERS } from '@/engine/tokens/formatters';
import { resolveTokens } from '@/engine/tokens/resolver';
import { isErr, isOk } from '@/lib/result';

const ROW = {
  first_name: 'Ada',
  middle_name: null,
  last_name: '  Lovelace  ',
  seat_number: 0,
  is_vegetarian: 0,
  blank: '',
  spaces: '   ',
  title: "o'brien-smith",
};

function resolve(template: string, row: Record<string, unknown> = ROW, fallback = '') {
  const result = resolveTokens(template, row, { fallback });
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
}

describe('formatters', () => {
  it('upper', () => {
    expect(applyFormatters('ada', ['upper'])).toBe('ADA');
  });

  it('lower', () => {
    expect(applyFormatters('ADA', ['lower'])).toBe('ada');
  });

  it('trim', () => {
    expect(applyFormatters('  ada  ', ['trim'])).toBe('ada');
  });

  it('title capitalises each word', () => {
    expect(applyFormatters('ada lovelace', ['title'])).toBe('Ada Lovelace');
  });

  it('title handles an apostrophe', () => {
    // "O'brien" is wrong on a place card, and this is a surname people have.
    expect(applyFormatters("o'brien", ['title'])).toBe("O'Brien");
  });

  it('title handles a hyphen', () => {
    expect(applyFormatters('mary-jane', ['title'])).toBe('Mary-Jane');
  });

  it('title handles both', () => {
    expect(applyFormatters("o'brien-smith", ['title'])).toBe("O'Brien-Smith");
  });

  it('title leaves an already-capitalised name alone', () => {
    expect(applyFormatters('Ada Lovelace', ['title'])).toBe('Ada Lovelace');
  });

  it('title lowercases the rest of a shouted name', () => {
    expect(applyFormatters('ADA LOVELACE', ['title'])).toBe('Ada Lovelace');
  });

  it('applies a chain left to right', () => {
    expect(applyFormatters('  ada  ', ['trim', 'upper'])).toBe('ADA');
  });

  it('is a no-op with no formatters', () => {
    expect(applyFormatters('ada', [])).toBe('ada');
  });

  it('is null-safe on an empty string', () => {
    for (const name of Object.keys(FORMATTERS)) {
      expect(applyFormatters('', [name])).toBe('');
    }
  });
});

describe('resolution', () => {
  it('substitutes a column value', () => {
    expect(resolve('{{ first_name }}')).toBe('Ada');
  });

  it('keeps surrounding literals', () => {
    expect(resolve('Dear {{ first_name }},')).toBe('Dear Ada,');
  });

  it('substitutes several tokens', () => {
    expect(resolve('{{ first_name }} {{ last_name | trim }}')).toBe('Ada Lovelace');
  });

  it('applies formatters', () => {
    expect(resolve('{{ last_name | trim | upper }}')).toBe('LOVELACE');
  });

  it('resolves a table-qualified reference against the flat row', () => {
    // A record source SELECTs columns; the row is flat. "guests.first_name"
    // must still find "first_name".
    expect(resolve('{{ guests.first_name }}')).toBe('Ada');
  });

  it('prefers an exact column match over the unqualified suffix', () => {
    const row = { 'guests.first_name': 'Qualified', first_name: 'Plain' };
    expect(resolve('{{ guests.first_name }}', row)).toBe('Qualified');
  });
});

describe('fallback rules', () => {
  it('fires on NULL', () => {
    expect(resolve('{{ middle_name }}', ROW, 'N/A')).toBe('N/A');
  });

  it('fires on an empty string', () => {
    expect(resolve('{{ blank }}', ROW, 'N/A')).toBe('N/A');
  });

  it('fires on a whitespace-only value', () => {
    // A cell holding three spaces is empty to a reader, and a card printed
    // with three spaces looks like a mistake.
    expect(resolve('{{ spaces }}', ROW, 'N/A')).toBe('N/A');
  });

  it('does NOT fire on numeric zero', () => {
    // Seat 0 and "no seat" are different facts.
    expect(resolve('{{ seat_number }}', ROW, 'N/A')).toBe('0');
  });

  it('does NOT fire on a false-like flag', () => {
    expect(resolve('{{ is_vegetarian }}', ROW, 'N/A')).toBe('0');
  });

  it('defaults to an empty fallback', () => {
    expect(resolve('{{ middle_name }}')).toBe('');
  });

  it('applies formatters to the fallback too', () => {
    expect(resolve('{{ middle_name | upper }}', ROW, 'none')).toBe('NONE');
  });
});

describe('errors', () => {
  it('reports an unknown column by name', () => {
    const result = resolveTokens('{{ nope }}', ROW, { fallback: '' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('TOKEN_UNKNOWN_COLUMN');
      expect(result.error.message).toContain('nope');
    }
  });

  it('carries the object id through for the diagnostics panel', () => {
    const result = resolveTokens('{{ nope }}', ROW, { fallback: '', objectId: 'text-7' });
    if (!isErr(result)) throw new Error('expected an error');
    expect(result.error.objectId).toBe('text-7');
  });

  it('propagates a parse error', () => {
    expect(isErr(resolveTokens('{{ x | shout }}', ROW, { fallback: '' }))).toBe(true);
  });
});

describe('smart space collapsing', () => {
  it('collapses the gap left by an empty middle token', () => {
    expect(resolve('{{ first_name }} {{ middle_name }} {{ last_name | trim }}')).toBe(
      'Ada Lovelace',
    );
  });

  it('trims a leading gap when the first token is empty', () => {
    expect(resolve('{{ middle_name }} {{ first_name }}')).toBe('Ada');
  });

  it('trims a trailing gap when the last token is empty', () => {
    expect(resolve('{{ first_name }} {{ middle_name }}')).toBe('Ada');
  });

  it('collapses two consecutive empty tokens', () => {
    const row = { a: 'A', b: null, c: null, d: 'D' };
    expect(resolve('{{ a }} {{ b }} {{ c }} {{ d }}', row)).toBe('A D');
  });

  it('preserves a deliberate double space in literal text', () => {
    // Only whitespace orphaned by an empty token is collapsed; the author's
    // own spacing is left alone.
    expect(resolve('{{ first_name }}  and  more')).toBe('Ada  and  more');
  });

  it('does not collapse around a token that resolved to a fallback', () => {
    expect(resolve('{{ first_name }} {{ middle_name }} X', ROW, '-')).toBe('Ada - X');
  });

  it('leaves punctuation adjacent to an empty token alone', () => {
    const row = { a: 'A', b: null };
    expect(resolve('{{ a }},{{ b }}', row)).toBe('A,');
  });
});
