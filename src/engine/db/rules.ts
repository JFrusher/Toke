/**
 * The rule builder's model, and the SQL it writes.
 *
 * Rules do not run anywhere themselves: they compile to a CASE column over the
 * design's record source, so the record source stays the only rule engine and
 * a user who reads SQL sees exactly what the builder did.
 *
 * The rule set travels as a JSON comment at the top of the query it produced.
 * The builder reopens a query only if rebuilding that JSON gives the same SQL
 * back; a query edited by hand stays hand-written, never silently overwritten.
 */

export const RULE_OPS = [
  'is',
  'is not',
  'contains',
  'is empty',
  'is not empty',
  'greater than',
  'less than',
] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export type Rule = {
  readonly column: string;
  readonly op: RuleOp;
  /** Ignored by 'is empty' and 'is not empty'. */
  readonly value: string;
  readonly result: string;
};

export type RuleColumn = {
  readonly name: string;
  /** First match wins, as in a CASE. */
  readonly rules: readonly Rule[];
  readonly otherwise: string;
};

export type RuleSet = {
  /** The query the computed columns are added to. */
  readonly base: string;
  readonly columns: readonly RuleColumn[];
};

export type ReadRules =
  | { readonly status: 'rules'; readonly rules: RuleSet }
  | { readonly status: 'edited' }
  | { readonly status: 'plain' };

const MARKER = '/* toke rules ';

function identifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function text(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A number compares as a number; anything else as text. */
function operand(value: string): string {
  return /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? value.trim() : text(value);
}

function condition(rule: Rule): string {
  const column = identifier(rule.column);
  switch (rule.op) {
    case 'is':
      return `${column} = ${text(rule.value)} COLLATE NOCASE`;
    case 'is not':
      return `COALESCE(${column}, '') <> ${text(rule.value)} COLLATE NOCASE`;
    case 'contains':
      // instr, not LIKE: a % or _ in the value is then just a character.
      return `instr(lower(${column}), lower(${text(rule.value)})) > 0`;
    case 'is empty':
      return `TRIM(COALESCE(${column}, '')) = ''`;
    case 'is not empty':
      return `TRIM(COALESCE(${column}, '')) <> ''`;
    case 'greater than':
      return `${column} > ${operand(rule.value)}`;
    case 'less than':
      return `${column} < ${operand(rule.value)}`;
  }
}

function caseColumn(column: RuleColumn): string {
  const branches = column.rules.map(
    (rule) => `    WHEN ${condition(rule)} THEN ${text(rule.result)}`,
  );
  return [
    '  CASE',
    ...branches,
    `    ELSE ${text(column.otherwise)}`,
    `  END AS ${identifier(column.name)}`,
  ].join('\n');
}

export function buildRuleQuery(rules: RuleSet): string {
  // JSON.stringify never emits "*/" unescaped once "/" is escaped, which keeps
  // the comment closed exactly where it should be.
  const json = JSON.stringify(rules).replace(/\//g, '\\/');
  const columns = rules.columns.filter((column) => column.rules.length > 0).map(caseColumn);
  return [
    `${MARKER}${json} */`,
    `SELECT *${columns.length === 0 ? '' : ','}`,
    columns.join(',\n'),
    `FROM (\n${rules.base.trim().replace(/;\s*$/, '')}\n)`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function isRuleSet(value: unknown): value is RuleSet {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RuleSet>;
  return typeof candidate.base === 'string' && Array.isArray(candidate.columns);
}

export function readRuleQuery(sql: string): ReadRules {
  const trimmed = sql.trim();
  if (!trimmed.startsWith(MARKER)) return { status: 'plain' };

  const end = trimmed.indexOf(' */');
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(MARKER.length, end));
    if (isRuleSet(parsed) && buildRuleQuery(parsed) === trimmed) {
      return { status: 'rules', rules: parsed };
    }
  } catch {
    // Unreadable JSON is a hand edit like any other; reported as 'edited' below.
  }
  return { status: 'edited' };
}

/** Why a rule set cannot be used yet; empty when it can. */
export function ruleProblems(rules: RuleSet, baseColumns: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const column of rules.columns) {
    const name = column.name.trim();
    const key = name.toLowerCase();
    if (name === '') problems.push('Every computed column needs a name.');
    else if (seen.has(key)) problems.push(`Two computed columns are called ${name}.`);
    else if (baseColumns.some((base) => base.toLowerCase() === key))
      problems.push(`${name} is already a column of the record source.`);
    seen.add(key);
    if (column.rules.length === 0) problems.push(`${name || 'A column'} has no conditions yet.`);
    if (column.rules.some((rule) => !baseColumns.includes(rule.column)))
      problems.push(`${name || 'A column'} tests a column the record source does not return.`);
  }
  return problems;
}
