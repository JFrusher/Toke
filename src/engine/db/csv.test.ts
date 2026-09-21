import { describe, expect, it } from 'vitest';
import { inferType, parseCsv, proposeMapping } from '@/engine/db/csv';
import { isErr, isOk } from '@/lib/result';

function parse(input: string) {
  const result = parseCsv(input);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
}

describe('parseCsv — structure', () => {
  it('reads a header row and data rows', () => {
    const csv = parse('first_name,last_name\nAda,Lovelace\nGrace,Hopper');
    expect(csv.columns.map((c) => c.name)).toEqual(['first_name', 'last_name']);
    expect(csv.rowCount).toBe(2);
    expect(csv.rows[0]).toEqual(['Ada', 'Lovelace']);
  });

  it('handles CRLF line endings', () => {
    const csv = parse('a,b\r\n1,2\r\n3,4');
    expect(csv.rowCount).toBe(2);
    expect(csv.rows[1]).toEqual(['3', '4']);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    // Excel writes a BOM by default; without stripping, the first column is
    // named "﻿first_name" and silently fails to map.
    const csv = parse('﻿first_name,last_name\nAda,Lovelace');
    expect(csv.columns[0]?.name).toBe('first_name');
  });

  it('detects a semicolon delimiter', () => {
    const csv = parse('a;b\n1;2');
    expect(csv.columns.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('detects a tab delimiter', () => {
    const csv = parse('a\tb\n1\t2');
    expect(csv.columns.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('keeps a quoted field containing the delimiter intact', () => {
    const csv = parse('name,note\n"Lovelace, Ada",fine');
    expect(csv.rows[0]).toEqual(['Lovelace, Ada', 'fine']);
  });

  it('keeps a quoted field containing a newline intact', () => {
    const csv = parse('name,note\n"Ada","line one\nline two"');
    expect(csv.rows[0]?.[1]).toBe('line one\nline two');
  });

  it('trims surrounding whitespace from header names', () => {
    const csv = parse(' first_name , last_name \nAda,Lovelace');
    expect(csv.columns.map((c) => c.name)).toEqual(['first_name', 'last_name']);
  });
});

describe('parseCsv — malformed input', () => {
  it('rejects an empty file', () => {
    const result = parseCsv('');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('CSV_EMPTY');
  });

  it('rejects a whitespace-only file', () => {
    expect(isErr(parseCsv('   \n  \n'))).toBe(true);
  });

  it('accepts a header-only file as zero rows, not an error', () => {
    const csv = parse('first_name,last_name');
    expect(csv.columns).toHaveLength(2);
    expect(csv.rowCount).toBe(0);
  });

  it('rejects duplicate header names', () => {
    // Two columns called "name" would silently overwrite each other on import.
    const result = parseCsv('name,name\na,b');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toMatch(/name/);
  });

  it('rejects an empty header name', () => {
    expect(isErr(parseCsv('first_name,,last_name\na,b,c'))).toBe(true);
  });

  it('reports ragged rows rather than silently padding them', () => {
    // Padding would import a guest with a blank surname and no warning.
    const csv = parse('a,b,c\n1,2,3\n4,5\n6,7,8');
    expect(csv.ragged).toEqual([{ row: 2, got: 2, expected: 3 }]);
  });

  it('still returns the good rows alongside a ragged report', () => {
    const csv = parse('a,b\n1,2\n3');
    expect(csv.rowCount).toBe(2);
    expect(csv.ragged).toHaveLength(1);
  });
});

describe('inferType', () => {
  it('infers integer', () => {
    expect(inferType(['1', '2', '300'])).toBe('integer');
  });

  it('infers real', () => {
    expect(inferType(['1.5', '2', '3.25'])).toBe('real');
  });

  it('infers boolean from 0/1', () => {
    expect(inferType(['0', '1', '1'])).toBe('boolean');
  });

  it('infers boolean from true/false', () => {
    expect(inferType(['true', 'false', 'TRUE'])).toBe('boolean');
  });

  it('infers boolean from yes/no', () => {
    expect(inferType(['yes', 'no', 'Yes'])).toBe('boolean');
  });

  it('infers text for a leading-zero value', () => {
    // "007" is an identifier, not the number 7. Coercing it to integer loses
    // the zeros permanently and cannot be undone after import.
    expect(inferType(['007', '012', '345'])).toBe('text');
  });

  it('infers text when any value is non-numeric', () => {
    expect(inferType(['1', '2', 'n/a'])).toBe('text');
  });

  it('ignores blanks when inferring', () => {
    expect(inferType(['1', '', '3'])).toBe('integer');
  });

  it('falls back to text for an all-blank column', () => {
    expect(inferType(['', '', ''])).toBe('text');
  });

  it('infers text for values with leading plus or spaces', () => {
    expect(inferType(['+44 7700 900000', '+44 7700 900001'])).toBe('text');
  });

  it('does not infer boolean from a single distinct value', () => {
    // A column of all "1" is far more likely a count than a flag.
    expect(inferType(['1', '1', '1'])).toBe('integer');
  });
});

describe('proposeMapping', () => {
  const target = [
    { name: 'id', declaredType: 'INTEGER', notNull: false },
    { name: 'first_name', declaredType: 'TEXT', notNull: true },
    { name: 'last_name', declaredType: 'TEXT', notNull: true },
    { name: 'is_vegetarian', declaredType: 'BOOLEAN', notNull: false },
  ];

  it('maps exact name matches', () => {
    const csv = parse('first_name,last_name\nAda,Lovelace');
    const mapping = proposeMapping(csv.columns, target);
    expect(mapping.map((m) => [m.source, m.action, m.target])).toEqual([
      ['first_name', 'map', 'first_name'],
      ['last_name', 'map', 'last_name'],
    ]);
  });

  it('matches case-insensitively and across separators', () => {
    const csv = parse('First Name,LAST-NAME\nAda,Lovelace');
    const mapping = proposeMapping(csv.columns, target);
    expect(mapping.map((m) => m.target)).toEqual(['first_name', 'last_name']);
  });

  it('proposes creating a column for an unmatched header', () => {
    const csv = parse('first_name,nickname\nAda,Addy');
    const mapping = proposeMapping(csv.columns, target);
    const nickname = mapping.find((m) => m.source === 'nickname');
    expect(nickname).toMatchObject({ action: 'create', target: 'nickname' });
  });

  it('sanitises a created column name into a valid identifier', () => {
    const csv = parse('first_name,Dietary Requirements?\nAda,None');
    const mapping = proposeMapping(csv.columns, target);
    const created = mapping.find((m) => m.action === 'create');
    expect(created?.target).toBe('dietary_requirements');
  });

  it('never proposes writing to the primary key', () => {
    // An imported id would collide with AUTOINCREMENT and fail unpredictably.
    const csv = parse('id,first_name\n1,Ada');
    const mapping = proposeMapping(csv.columns, target);
    expect(mapping.find((m) => m.source === 'id')?.action).toBe('ignore');
  });

  it('carries the inferred type through to the proposal', () => {
    const csv = parse('first_name,is_vegetarian\nAda,1\nGrace,0');
    const mapping = proposeMapping(csv.columns, target);
    expect(mapping.find((m) => m.source === 'is_vegetarian')?.type).toBe('boolean');
  });
});
