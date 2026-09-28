/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, openDatabase } from '@/engine/db/database';
import { buildRuleQuery, type RuleSet, readRuleQuery, ruleProblems } from '@/engine/db/rules';
import { isOk } from '@/lib/result';

let db: DatabaseHandle;

beforeEach(async () => {
  const opened = await openDatabase();
  if (!isOk(opened)) throw new Error('could not open database');
  db = opened.value;
  db.exec(`CREATE TABLE guests (name TEXT, diet TEXT, age INTEGER, rsvp TEXT)`);
  db.exec(`INSERT INTO guests VALUES
    ('Ada', 'Gluten free', 36, 'Accepted'),
    ('Grace', 'Vegetarian', 85, 'Accepted'),
    ('Alan', NULL, 41, 'Declined'),
    ('Kit', '', 7, 'Accepted')`);
});

function run(sql: string) {
  const result = db.query(sql);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value.rows;
}

const menu: RuleSet = {
  base: "SELECT * FROM guests WHERE rsvp = 'Accepted'",
  columns: [
    {
      name: 'menu',
      rules: [
        { column: 'diet', op: 'contains', value: 'gluten', result: 'menu-gf' },
        { column: 'diet', op: 'is', value: 'vegetarian', result: 'menu-veg' },
        { column: 'age', op: 'less than', value: '12', result: 'menu-child' },
      ],
      otherwise: 'menu-standard',
    },
  ],
};

describe('buildRuleQuery', () => {
  it('computes a column the first matching rule decides', () => {
    expect(run(buildRuleQuery(menu)).map((row) => [row.name, row.menu])).toEqual([
      ['Ada', 'menu-gf'],
      ['Grace', 'menu-veg'],
      ['Kit', 'menu-child'],
    ]);
  });

  it('keeps every column of the base query', () => {
    expect(run(buildRuleQuery(menu))[0]).toMatchObject({ name: 'Ada', diet: 'Gluten free' });
  });

  it('handles empty and not-empty, NULL included', () => {
    const rows = run(
      buildRuleQuery({
        base: 'SELECT * FROM guests',
        columns: [
          {
            name: 'has_diet',
            rules: [{ column: 'diet', op: 'is empty', value: '', result: 'no' }],
            otherwise: 'yes',
          },
        ],
      }),
    );
    expect(rows.map((row) => row.has_diet)).toEqual(['yes', 'yes', 'no', 'no']);
  });

  it('quotes values so a quote in the data cannot break the query', () => {
    const rows = run(
      buildRuleQuery({
        base: 'SELECT * FROM guests',
        columns: [
          {
            name: 'odd',
            rules: [{ column: 'name', op: 'is', value: "O'Brien", result: "it's" }],
            otherwise: '',
          },
        ],
      }),
    );
    expect(rows).toHaveLength(4);
  });
});

describe('readRuleQuery', () => {
  it('reads back what it built', () => {
    expect(readRuleQuery(buildRuleQuery(menu))).toEqual({ status: 'rules', rules: menu });
  });

  it('reports a hand-edited rule query rather than silently discarding the edit', () => {
    const edited = `${buildRuleQuery(menu)} LIMIT 5`;
    expect(readRuleQuery(edited)).toEqual({ status: 'edited' });
  });

  it('treats ordinary SQL as a base to build on', () => {
    expect(readRuleQuery('SELECT * FROM guests')).toEqual({ status: 'plain' });
  });

  it('survives a value containing the comment terminator', () => {
    const tricky: RuleSet = {
      base: 'SELECT * FROM guests',
      columns: [
        {
          name: 'x',
          rules: [{ column: 'name', op: 'is', value: '*/', result: '*/' }],
          otherwise: '',
        },
      ],
    };
    expect(readRuleQuery(buildRuleQuery(tricky))).toEqual({ status: 'rules', rules: tricky });
    expect(run(buildRuleQuery(tricky))).toHaveLength(4);
  });
});

describe('ruleProblems', () => {
  const base = ['name', 'diet'];
  const column = (name: string, testColumn = 'diet') => ({
    name,
    rules: [{ column: testColumn, op: 'is' as const, value: 'x', result: 'y' }],
    otherwise: '',
  });

  it('accepts a complete rule set', () => {
    expect(ruleProblems({ base: '', columns: [column('menu')] }, base)).toEqual([]);
  });

  it('refuses a blank, duplicate or clashing name', () => {
    expect(ruleProblems({ base: '', columns: [column('')] }, base)).toHaveLength(1);
    expect(ruleProblems({ base: '', columns: [column('m'), column('M')] }, base)).toHaveLength(1);
    expect(ruleProblems({ base: '', columns: [column('diet')] }, base)).toHaveLength(1);
  });

  it('refuses a condition on a column the source lacks', () => {
    expect(ruleProblems({ base: '', columns: [column('menu', 'age')] }, base)).toHaveLength(1);
  });

  it('refuses a column with no conditions', () => {
    const empty = { name: 'menu', rules: [], otherwise: '' };
    expect(ruleProblems({ base: '', columns: [empty] }, base)).toHaveLength(1);
  });
});
