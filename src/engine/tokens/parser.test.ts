import { describe, expect, it } from 'vitest';
import { isTokenised, parseTokens, tokenColumns } from '@/engine/tokens/parser';
import { isErr, isOk } from '@/lib/result';

function parse(input: string) {
  const result = parseTokens(input);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
}

describe('literals', () => {
  it('returns a single literal for plain text', () => {
    expect(parse('Ada Lovelace')).toEqual([{ kind: 'literal', text: 'Ada Lovelace' }]);
  });

  it('returns nothing for an empty string', () => {
    expect(parse('')).toEqual([]);
  });

  it('keeps whitespace exactly', () => {
    expect(parse('  a  b  ')).toEqual([{ kind: 'literal', text: '  a  b  ' }]);
  });
});

describe('tokens', () => {
  it('parses a bare token', () => {
    expect(parse('{{ first_name }}')).toEqual([
      { kind: 'token', reference: 'first_name', formatters: [], raw: '{{ first_name }}' },
    ]);
  });

  it('parses a table-qualified reference', () => {
    expect(parse('{{ guests.first_name }}')[0]).toMatchObject({
      kind: 'token',
      reference: 'guests.first_name',
    });
  });

  it('tolerates missing whitespace', () => {
    expect(parse('{{first_name}}')[0]).toMatchObject({ reference: 'first_name' });
  });

  it('tolerates extra whitespace', () => {
    expect(parse('{{   first_name   }}')[0]).toMatchObject({ reference: 'first_name' });
  });

  it('parses literal and token together', () => {
    expect(parse('Dear {{ first_name }},')).toEqual([
      { kind: 'literal', text: 'Dear ' },
      { kind: 'token', reference: 'first_name', formatters: [], raw: '{{ first_name }}' },
      { kind: 'literal', text: ',' },
    ]);
  });

  it('parses several tokens in one string', () => {
    const segments = parse('{{ first_name }} {{ last_name }}');
    expect(segments.filter((s) => s.kind === 'token')).toHaveLength(2);
  });
});

describe('formatters', () => {
  it('parses one formatter', () => {
    expect(parse('{{ last_name | upper }}')[0]).toMatchObject({
      reference: 'last_name',
      formatters: ['upper'],
    });
  });

  it('parses a chain, left to right', () => {
    expect(parse('{{ last_name | trim | upper }}')[0]).toMatchObject({
      formatters: ['trim', 'upper'],
    });
  });

  it('lowercases formatter names', () => {
    expect(parse('{{ x | UPPER }}')[0]).toMatchObject({ formatters: ['upper'] });
  });

  it('rejects an unknown formatter, naming it', () => {
    // Silently ignoring it would print unformatted text across a whole run
    // with no indication anything was wrong.
    const result = parseTokens('{{ x | shout }}');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('TOKEN_UNKNOWN_FORMATTER');
      expect(result.error.message).toContain('shout');
    }
  });

  it('rejects an empty formatter in a chain', () => {
    expect(isErr(parseTokens('{{ x | | upper }}'))).toBe(true);
  });
});

describe('malformed input', () => {
  it('treats an unclosed token as literal text rather than failing', () => {
    // Mid-typing state. Erroring here would make the inspector flash red on
    // the way to a valid token.
    expect(parse('{{ first_name')).toEqual([{ kind: 'literal', text: '{{ first_name' }]);
  });

  it('treats a stray closing brace as literal', () => {
    expect(parse('first_name }}')).toEqual([{ kind: 'literal', text: 'first_name }}' }]);
  });

  it('rejects an empty token', () => {
    const result = parseTokens('{{}}');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('TOKEN_EMPTY');
  });

  it('rejects a whitespace-only token', () => {
    expect(isErr(parseTokens('{{   }}'))).toBe(true);
  });

  it('rejects a reference with invalid characters', () => {
    expect(isErr(parseTokens('{{ first name }}'))).toBe(true);
    expect(isErr(parseTokens('{{ first-name! }}'))).toBe(true);
  });
});

describe('escaping', () => {
  it('renders an escaped opening brace as literal braces', () => {
    expect(parse('\\{{ not a token }}')).toEqual([{ kind: 'literal', text: '{{ not a token }}' }]);
  });

  it('keeps a backslash that is not an escape', () => {
    expect(parse('back\\slash')).toEqual([{ kind: 'literal', text: 'back\\slash' }]);
  });
});

describe('round trip', () => {
  it('reassembles the original string from raw segments', () => {
    const input = 'Dear {{ first_name | title }}, table {{ table_id }}.';
    const rebuilt = parse(input)
      .map((segment) => (segment.kind === 'literal' ? segment.text : segment.raw))
      .join('');

    expect(rebuilt).toBe(input);
  });
});

describe('isTokenised', () => {
  it('is false for plain text', () => {
    expect(isTokenised('Ada Lovelace')).toBe(false);
  });

  it('is true when a token is present', () => {
    expect(isTokenised('{{ first_name }}')).toBe(true);
  });

  it('is false for an unclosed brace', () => {
    expect(isTokenised('{{ first_name')).toBe(false);
  });
});

describe('tokenColumns', () => {
  it('lists every referenced column once', () => {
    expect(tokenColumns('{{ a }} {{ b }} {{ a }}')).toEqual(['a', 'b']);
  });

  it('is empty for plain text', () => {
    expect(tokenColumns('nothing here')).toEqual([]);
  });
});
