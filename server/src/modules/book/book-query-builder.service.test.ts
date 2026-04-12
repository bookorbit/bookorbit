vi.mock('drizzle-orm', () => {
  const sqlTag = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', text: strings.join(''), values })),
    {
      raw: vi.fn((value: string) => ({ type: 'raw', value })),
    },
  );

  return {
    and: vi.fn((...clauses: unknown[]) => ({ type: 'and', clauses })),
    or: vi.fn((...clauses: unknown[]) => ({ type: 'or', clauses })),
    eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
    ne: vi.fn((left: unknown, right: unknown) => ({ type: 'ne', left, right })),
    gt: vi.fn((left: unknown, right: unknown) => ({ type: 'gt', left, right })),
    gte: vi.fn((left: unknown, right: unknown) => ({ type: 'gte', left, right })),
    lt: vi.fn((left: unknown, right: unknown) => ({ type: 'lt', left, right })),
    lte: vi.fn((left: unknown, right: unknown) => ({ type: 'lte', left, right })),
    ilike: vi.fn((left: unknown, pattern: string) => ({ type: 'ilike', left, pattern })),
    inArray: vi.fn((left: unknown, right: unknown) => ({ type: 'inArray', left, right })),
    isNull: vi.fn((value: unknown) => ({ type: 'isNull', value })),
    isNotNull: vi.fn((value: unknown) => ({ type: 'isNotNull', value })),
    not: vi.fn((value: unknown) => ({ type: 'not', value })),
    sql: sqlTag,
  };
});

import { BadRequestException } from '@nestjs/common';
import { ilike, sql } from 'drizzle-orm';

import { FIELD_OPERATORS, type RuleField, type RuleOperator } from '@projectx/types';

import { BookQueryBuilder } from './book-query-builder.service';

function makeBuilder() {
  const sqWhere = vi.fn((whereClause?: unknown) => ({ type: 'subquery', whereClause }));
  const sqInnerJoin = vi.fn().mockReturnValue({ where: sqWhere });
  const sqFrom = vi.fn().mockReturnValue({ innerJoin: sqInnerJoin, where: sqWhere });
  const db = {
    select: vi.fn().mockReturnValue({ from: sqFrom }),
  };
  return { builder: new BookQueryBuilder(db as never), db };
}

function wrapRule(rule: Record<string, unknown>) {
  return {
    type: 'group' as const,
    join: 'AND' as const,
    rules: [rule],
  };
}

/**
 * Extracts the SQL fragment produced by the innermost rule from a single-rule
 * AND group built with accessibleLibraryIds:[1] and no implicitLibraryId.
 *
 * Shape: and(libraryScope, and(ruleSql)) → clauses[1].clauses[0] = ruleSql
 */
function getRuleSql(where: Record<string, unknown>): Record<string, unknown> {
  const outer = where as { clauses: { clauses: unknown[] }[] };
  return outer.clauses[1].clauses[0] as Record<string, unknown>;
}

const BASE_CTX = { accessibleLibraryIds: [1] as number[] };
const USER_CTX = { accessibleLibraryIds: [1] as number[], userId: 10 };

/**
 * Returns a minimal valid { value, valueTo } pair for a given operator+field
 * combination that satisfies the query builder's runtime assertions (e.g. numeric
 * operators need a finite number; date operators need a parseable date string).
 *
 * The exhaustive `never` default ensures TypeScript raises a compile error when a
 * new operator is added to RuleOperator but not handled here.
 */
function buildValueFor(operator: RuleOperator, field: RuleField): { value?: unknown; valueTo?: unknown } {
  const numericFields: RuleField[] = ['publishedYear', 'seriesIndex', 'pageCount', 'rating', 'metadataScore'];
  const isNumericField = numericFields.includes(field);

  switch (operator) {
    case 'isEmpty':
    case 'isNotEmpty':
    case 'isMissing':
    case 'isPresent':
    case 'isUnread':
    case 'isInProgress':
    case 'isFinished':
      return {};
    case 'contains':
    case 'notContains':
    case 'startsWith':
    case 'endsWith':
      return { value: 'test' };
    case 'eq':
    case 'notEq':
      return { value: isNumericField ? 10 : 'test' };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { value: 10 };
    case 'between':
      return field === 'addedAt' ? { value: '2023-01-01', valueTo: '2023-12-31' } : { value: 10, valueTo: 20 };
    case 'before':
    case 'after':
      return { value: '2023-01-01' };
    case 'withinLast':
      return { value: 7 };
    case 'includesAny':
    case 'includesAll':
    case 'excludesAll':
      return { value: ['test'] };
    default: {
      const _exhaustive: never = operator;
      return _exhaustive;
    }
  }
}

describe('BookQueryBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an always-false where clause when no accessible libraries are provided', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(undefined, { accessibleLibraryIds: [] }) as any;

    expect(where).toMatchObject({ type: 'sql', text: '1 = 0' });
  });

  it('combines library scope, implicit library, and filter rules into one AND clause', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }) as never, {
      accessibleLibraryIds: [1, 2],
      implicitLibraryId: 2,
      userId: 10,
    }) as any;

    expect(where).toMatchObject({ type: 'and' });
    expect(where.clauses).toHaveLength(3);
    expect(where.clauses[2]).toMatchObject({ type: 'and' });
    expect(where.clauses[2].clauses[0]).toMatchObject({ type: 'ilike', pattern: '%Dune%' });
  });

  it('throws for filters nested deeper than supported limit', () => {
    const { builder } = makeBuilder();

    const deepGroup = {
      type: 'group',
      join: 'AND',
      rules: [
        {
          type: 'group',
          join: 'AND',
          rules: [
            {
              type: 'group',
              join: 'AND',
              rules: [
                {
                  type: 'group',
                  join: 'AND',
                  rules: [
                    {
                      type: 'group',
                      join: 'AND',
                      rules: [
                        {
                          type: 'group',
                          join: 'AND',
                          rules: [{ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(() => builder.buildWhere(deepGroup as never, { accessibleLibraryIds: [1], userId: 10 })).toThrow(BadRequestException);
  });

  it('rejects missing value for text operators that require input', () => {
    const { builder } = makeBuilder();

    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'contains' }) as never, {
        accessibleLibraryIds: [1],
        userId: 10,
      }),
    ).toThrow("Operator 'contains' requires a non-empty value");
  });

  it('rejects numeric between without both numeric bounds', () => {
    const { builder } = makeBuilder();

    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'pageCount', operator: 'between', value: 100 }) as never, {
        accessibleLibraryIds: [1],
        userId: 10,
      }),
    ).toThrow("Operator 'between' requires a valid numeric valueTo");
  });

  it('rejects invalid date input instead of producing invalid SQL date values', () => {
    const { builder } = makeBuilder();

    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'addedAt', operator: 'before', value: 'not-a-date' }) as never, {
        accessibleLibraryIds: [1],
        userId: 10,
      }),
    ).toThrow("Operator 'before' requires a valid date value");
  });

  it('rejects negative withinLast values', () => {
    const { builder } = makeBuilder();

    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'addedAt', operator: 'withinLast', value: -3 }) as never, {
        accessibleLibraryIds: [1],
        userId: 10,
      }),
    ).toThrow("Operator 'withinLast' requires a non-negative value");
  });

  it('requires authenticated user for readProgress filters', () => {
    const { builder } = makeBuilder();

    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'readProgress', operator: 'isUnread' }) as never, {
        accessibleLibraryIds: [1],
      }),
    ).toThrow('Reading progress filter requires an authenticated user');
  });

  it('requires authenticated user for collection filters', () => {
    const { builder } = makeBuilder();

    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'collection', operator: 'isEmpty' }) as never, {
        accessibleLibraryIds: [1],
      }),
    ).toThrow('Collection filter requires an authenticated user');
  });

  it('builds default order when no sort fields are provided', () => {
    const { builder } = makeBuilder();

    const result = builder.buildOrderBy([]);

    expect(result).toHaveLength(1);
  });

  it('adds series fallback sort when sorting by seriesIndex without explicit series sort', () => {
    const { builder } = makeBuilder();
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = builder.buildOrderBy([{ field: 'seriesIndex', dir: 'desc' }]);

    expect(result).toHaveLength(2);
    expect(raw).toHaveBeenCalledTimes(2);
    expect(raw).toHaveBeenNthCalledWith(1, 'DESC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('falls back to default order when runtime direction is invalid', () => {
    const { builder } = makeBuilder();
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = builder.buildOrderBy([{ field: 'title', dir: 'asc; DROP TABLE books' } as never]);

    expect(result).toHaveLength(1);
    expect(raw).not.toHaveBeenCalledWith(expect.stringContaining('DROP TABLE'));
  });

  it('builds one author subquery per includesAll value and uses ilike patterns', () => {
    const { builder, db } = makeBuilder();

    builder.buildWhere(wrapRule({ type: 'rule', field: 'author', operator: 'includesAll', value: ['Frank', 'Herbert'] }) as never, {
      accessibleLibraryIds: [1],
      userId: 10,
    });

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(ilike).toHaveBeenCalledWith(expect.anything(), '%Frank%');
    expect(ilike).toHaveBeenCalledWith(expect.anything(), '%Herbert%');
  });

  it('handles empty includesAny sets by generating an always-false branch', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'publisher', operator: 'includesAny', value: [] }) as never, {
      accessibleLibraryIds: [1],
      userId: 10,
    }) as any;

    expect(where.clauses[1].clauses[0]).toMatchObject({ type: 'sql', text: '1 = 0' });
  });
});

describe('field coverage smoke tests', () => {
  it.each(Object.entries(FIELD_OPERATORS) as [RuleField, RuleOperator[]][])(
    'field %s: every valid operator resolves without throwing',
    (field, operators) => {
      const { builder } = makeBuilder();
      for (const operator of operators) {
        const { value, valueTo } = buildValueFor(operator, field);
        const rule: Record<string, unknown> = { type: 'rule', field, operator };
        if (value !== undefined) rule.value = value;
        if (valueTo !== undefined) rule.valueTo = valueTo;

        expect(() => builder.buildWhere(wrapRule(rule) as never, USER_CTX), `field '${field}' operator '${operator}' should not throw`).not.toThrow();
      }
    },
  );
});

describe('textRuleToSql (via title)', () => {
  it.each([
    ['contains', 'Dune', { type: 'ilike', pattern: '%Dune%' }],
    ['notContains', 'Dune', { type: 'not' }],
    ['startsWith', 'Dune', { type: 'ilike', pattern: 'Dune%' }],
    ['endsWith', 'Dune', { type: 'ilike', pattern: '%Dune' }],
    ['eq', 'Dune', { type: 'ilike', pattern: 'Dune' }],
    ['notEq', 'Dune', { type: 'not' }],
    ['isEmpty', undefined, { type: 'or' }],
    ['isNotEmpty', undefined, { type: 'and' }],
  ] as const)('operator %s produces the correct SQL shape', (operator, value, expected) => {
    const { builder } = makeBuilder();
    const rule: Record<string, unknown> = { type: 'rule', field: 'title', operator };
    if (value !== undefined) rule.value = value;

    const where = builder.buildWhere(wrapRule(rule) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject(expected);
  });

  it('notContains wraps an ilike in not()', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'notContains', value: 'Dune' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'not', value: { type: 'ilike', pattern: '%Dune%' } });
  });

  it('notEq wraps an exact ilike in not()', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'notEq', value: 'Dune' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'not', value: { type: 'ilike', pattern: 'Dune' } });
  });
});

describe('textSetRuleToSql (via publisher with array values)', () => {
  it('includesAny produces inArray on the column directly', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'publisher', operator: 'includesAny', value: ['Penguin', 'TOR'] }) as never,
      BASE_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'inArray' });
  });

  it('excludesAll with values produces or(isNull, not(inArray))', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'publisher', operator: 'excludesAll', value: ['Penguin'] }) as never,
      BASE_CTX,
    ) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'or' });
    expect(clause.clauses[0]).toMatchObject({ type: 'isNull' });
    expect(clause.clauses[1]).toMatchObject({ type: 'not', value: { type: 'inArray' } });
  });

  it('excludesAll with empty array produces always-true branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'publisher', operator: 'excludesAll', value: [] }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 1' });
  });
});

describe('numericRuleToSql (via pageCount and publishedYear)', () => {
  it.each([
    ['gt', { type: 'gt' }],
    ['gte', { type: 'gte' }],
    ['lt', { type: 'lt' }],
    ['lte', { type: 'lte' }],
    ['isEmpty', { type: 'isNull' }],
    ['isNotEmpty', { type: 'isNotNull' }],
  ] as const)('pageCount %s produces %o', (operator, expected) => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'pageCount', operator, value: 100 }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject(expected);
  });

  it('between produces and(gte, lte)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'pageCount', operator: 'between', value: 100, valueTo: 500 }) as never,
      BASE_CTX,
    ) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'and' });
    expect(clause.clauses[0]).toMatchObject({ type: 'gte' });
    expect(clause.clauses[1]).toMatchObject({ type: 'lte' });
  });

  it('publishedYear eq produces eq(col, value)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'publishedYear', operator: 'eq', value: 2001 }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'eq' });
  });

  it('publishedYear notEq produces ne(col, value)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'publishedYear', operator: 'notEq', value: 2001 }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'ne' });
  });
});

describe('authorRuleToSql', () => {
  it('includesAny with values produces an EXISTS subquery', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'author', operator: 'includesAny', value: ['Tolkien'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('excludesAll with values produces not(EXISTS subquery)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'author', operator: 'excludesAll', value: ['Tolkien'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('excludesAll with empty array produces always-true branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'author', operator: 'excludesAll', value: [] }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 1' });
  });

  it('isEmpty produces not(EXISTS subquery with no where clause)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'author', operator: 'isEmpty' }) as never, USER_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('isNotEmpty produces EXISTS subquery with no where clause', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'author', operator: 'isNotEmpty' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });
});

describe('genreRuleToSql', () => {
  it('includesAny produces an EXISTS subquery with eq filters', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'genre', operator: 'includesAny', value: ['Fiction'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('includesAll produces one subquery per value', () => {
    const { builder, db } = makeBuilder();
    builder.buildWhere(wrapRule({ type: 'rule', field: 'genre', operator: 'includesAll', value: ['Fiction', 'Sci-Fi'] }) as never, USER_CTX);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('excludesAll with values produces not(EXISTS subquery)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'genre', operator: 'excludesAll', value: ['Fiction'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('excludesAll with empty array produces always-true branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'genre', operator: 'excludesAll', value: [] }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 1' });
  });

  it('isEmpty produces not(EXISTS subquery)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'genre', operator: 'isEmpty' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('isNotEmpty produces EXISTS subquery', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'genre', operator: 'isNotEmpty' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });
});

describe('tagRuleToSql', () => {
  it('includesAny produces an EXISTS subquery', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'tag', operator: 'includesAny', value: ['favourite'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('includesAll produces one subquery per value', () => {
    const { builder, db } = makeBuilder();
    builder.buildWhere(wrapRule({ type: 'rule', field: 'tag', operator: 'includesAll', value: ['a', 'b'] }) as never, USER_CTX);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('excludesAll with values produces not(EXISTS subquery)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'tag', operator: 'excludesAll', value: ['favourite'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('excludesAll with empty array produces always-true branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'tag', operator: 'excludesAll', value: [] }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 1' });
  });

  it('isEmpty produces not(EXISTS subquery)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'tag', operator: 'isEmpty' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('isNotEmpty produces EXISTS subquery', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'tag', operator: 'isNotEmpty' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });
});

describe('collectionRuleToSql', () => {
  it('includesAny produces user-scoped EXISTS subquery', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'collection', operator: 'includesAny', value: ['Reading'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('excludesAll with values produces not(EXISTS)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'collection', operator: 'excludesAll', value: ['Reading'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('excludesAll with empty array produces always-true branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'collection', operator: 'excludesAll', value: [] }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 1' });
  });

  it('isEmpty produces not(EXISTS)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'collection', operator: 'isEmpty' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('isNotEmpty produces EXISTS', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'collection', operator: 'isNotEmpty' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });
});

describe('libraryRuleToSql', () => {
  it('includesAny produces an EXISTS subquery scoped by library name', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'library', operator: 'includesAny', value: ['Main'] }) as never,
      USER_CTX,
    ) as any;

    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('excludesAll with values produces not(EXISTS)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'library', operator: 'excludesAll', value: ['Archive'] }) as never,
      USER_CTX,
    ) as any;

    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('includesAny with empty array produces always-false branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'library', operator: 'includesAny', value: [] }) as never, USER_CTX) as any;

    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 0' });
  });
});

describe('formatRuleToSql', () => {
  it('includesAny produces EXISTS subquery with format filter', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'format', operator: 'includesAny', value: ['PDF', 'EPUB'] }) as never,
      USER_CTX,
    ) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('includesAny with empty array produces always-false branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'format', operator: 'includesAny', value: [] }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 0' });
  });

  it('excludesAll with values produces not(EXISTS)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'format', operator: 'excludesAll', value: ['PDF'] }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('excludesAll with empty array produces always-true branch', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'format', operator: 'excludesAll', value: [] }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql', text: '1 = 1' });
  });
});

describe('dateRuleToSql (addedAt)', () => {
  it('before produces lt(books.addedAt, parsedDate)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'addedAt', operator: 'before', value: '2023-01-01' }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'lt' });
    expect(getRuleSql(where).right).toBeInstanceOf(Date);
  });

  it('after produces gt(books.addedAt, parsedDate)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'addedAt', operator: 'after', value: '2023-01-01' }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'gt' });
    expect(getRuleSql(where).right).toBeInstanceOf(Date);
  });

  it('between produces and(gte, lte) with parsed dates', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'addedAt', operator: 'between', value: '2023-01-01', valueTo: '2023-12-31' }) as never,
      BASE_CTX,
    ) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'and' });
    expect(clause.clauses[0]).toMatchObject({ type: 'gte' });
    expect(clause.clauses[1]).toMatchObject({ type: 'lte' });
  });

  it('withinLast produces a sql interval expression', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'addedAt', operator: 'withinLast', value: 30 }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('withinLast with zero days is valid (produces sql expression)', () => {
    const { builder } = makeBuilder();
    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'addedAt', operator: 'withinLast', value: 0 }) as never, BASE_CTX)).not.toThrow();
  });

  it('between with invalid second date throws', () => {
    const { builder } = makeBuilder();
    expect(() =>
      builder.buildWhere(
        wrapRule({ type: 'rule', field: 'addedAt', operator: 'between', value: '2023-01-01', valueTo: 'not-a-date' }) as never,
        BASE_CTX,
      ),
    ).toThrow(BadRequestException);
  });
});

describe('statusRuleToSql (fileAvailability)', () => {
  it('isMissing produces eq(books.status, "missing")', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'fileAvailability', operator: 'isMissing' }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'eq', right: 'missing' });
  });

  it('isPresent produces eq(books.status, "present")', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'fileAvailability', operator: 'isPresent' }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'eq', right: 'present' });
  });
});

describe('readProgressRuleToSql', () => {
  it('isUnread produces not(EXISTS subquery)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'readProgress', operator: 'isUnread' }) as never, USER_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'not', value: { type: 'sql' } });
  });

  it('isInProgress produces EXISTS subquery with percentage between 0 and 100', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'readProgress', operator: 'isInProgress' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });

  it('isFinished produces EXISTS subquery with percentage >= 100', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'readProgress', operator: 'isFinished' }) as never, USER_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'sql' });
  });
});

describe('isbnRuleToSql', () => {
  it('isEmpty produces and(isNull(isbn13), isNull(isbn10))', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'isbn', operator: 'isEmpty' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'and' });
    expect(clause.clauses[0]).toMatchObject({ type: 'isNull' });
    expect(clause.clauses[1]).toMatchObject({ type: 'isNull' });
  });

  it('isNotEmpty produces or(isNotNull(isbn13), isNotNull(isbn10))', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'isbn', operator: 'isNotEmpty' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'or' });
    expect(clause.clauses[0]).toMatchObject({ type: 'isNotNull' });
    expect(clause.clauses[1]).toMatchObject({ type: 'isNotNull' });
  });

  it('eq produces or(eq(isbn13, val), eq(isbn10, val))', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'isbn', operator: 'eq', value: '9780141187761' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'or' });
    expect(clause.clauses[0]).toMatchObject({ type: 'eq', right: '9780141187761' });
    expect(clause.clauses[1]).toMatchObject({ type: 'eq', right: '9780141187761' });
  });

  it('eq with missing value throws BadRequestException', () => {
    const { builder } = makeBuilder();
    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'isbn', operator: 'eq' }) as never, BASE_CTX)).toThrow(BadRequestException);
  });
});
