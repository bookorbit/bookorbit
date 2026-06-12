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
    exists: vi.fn((subquery: unknown) => ({ type: 'exists', subquery })),
    notExists: vi.fn((subquery: unknown) => ({ type: 'notExists', subquery })),
    isNull: vi.fn((value: unknown) => ({ type: 'isNull', value })),
    isNotNull: vi.fn((value: unknown) => ({ type: 'isNotNull', value })),
    not: vi.fn((value: unknown) => ({ type: 'not', value })),
    sql: sqlTag,
  };
});

import { BadRequestException } from '@nestjs/common';
import { ilike, sql } from 'drizzle-orm';

import { EMPTY_CONTENT_FILTER_RULES, FIELD_OPERATORS, type RuleField, type RuleOperator } from '@bookorbit/types';

import { BookQueryBuilder } from './book-query-builder.service';
import { BookSortBuilder } from './book-sort-builder.service';

function makeBuilder() {
  const sqWhere = vi.fn((whereClause?: unknown) => ({ type: 'subquery', whereClause }));
  const sqInnerJoin = vi.fn().mockReturnValue({ where: sqWhere });
  const sqFrom = vi.fn().mockReturnValue({ innerJoin: sqInnerJoin, where: sqWhere });
  const db = {
    select: vi.fn().mockReturnValue({ from: sqFrom }),
  };
  return { builder: new BookQueryBuilder(db as never, new BookSortBuilder()), db };
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
      return field === 'addedAt' || field === 'startedAt' || field === 'finishedAt'
        ? { value: '2023-01-01', valueTo: '2023-12-31' }
        : { value: 10, valueTo: 20 };
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

  it('applies content filter clauses when filters are active', () => {
    const { builder, db } = makeBuilder();

    const where = builder.buildWhere(undefined, {
      accessibleLibraryIds: [1],
      contentFilters: {
        ...EMPTY_CONTENT_FILTER_RULES,
        includeTagIds: [7],
        excludeGenreIds: [9],
      },
    }) as any;

    expect(where.clauses).toHaveLength(3);
    expect(where.clauses[1]).toMatchObject({ type: 'exists' });
    expect(where.clauses[2]).toMatchObject({ type: 'notExists' });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('does not apply content filter clauses when filters are undefined', () => {
    const { builder, db } = makeBuilder();

    const where = builder.buildWhere(undefined, { accessibleLibraryIds: [1] }) as any;

    expect(where.clauses).toHaveLength(1);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('does not apply content filter clauses when filters are empty', () => {
    const { builder, db } = makeBuilder();

    const where = builder.buildWhere(undefined, {
      accessibleLibraryIds: [1],
      contentFilters: EMPTY_CONTENT_FILTER_RULES,
    }) as any;

    expect(where.clauses).toHaveLength(1);
    expect(db.select).not.toHaveBeenCalled();
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

    expect(result).toHaveLength(2);
  });

  it('adds series fallback sort when sorting by seriesIndex without explicit series sort', () => {
    const { builder } = makeBuilder();
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = builder.buildOrderBy([{ field: 'seriesIndex', dir: 'desc' }]);

    expect(result).toHaveLength(3);
    expect(raw).toHaveBeenCalledTimes(2);
    expect(raw).toHaveBeenNthCalledWith(1, 'DESC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('falls back to default order when runtime direction is invalid', () => {
    const { builder } = makeBuilder();
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = builder.buildOrderBy([{ field: 'title', dir: 'asc; DROP TABLE books' } as never]);

    expect(result).toHaveLength(2);
    expect(raw).not.toHaveBeenCalledWith(expect.stringContaining('DROP TABLE'));
  });

  it('builds order clauses for language and metadataScore', () => {
    const { builder } = makeBuilder();
    const raw = (sql as unknown as { raw: vi.Mock }).raw;

    const result = builder.buildOrderBy([
      { field: 'language', dir: 'asc' },
      { field: 'metadataScore', dir: 'desc' },
    ]);

    expect(result).toHaveLength(3);
    expect(raw).toHaveBeenNthCalledWith(1, 'ASC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('builds readStatus sort with subquery', () => {
    const { builder } = makeBuilder();

    const result = builder.buildOrderBy([{ field: 'readStatus', dir: 'asc' }], 1);

    expect(result).toHaveLength(2);
  });

  it('builds format sort with subquery', () => {
    const { builder } = makeBuilder();

    const result = builder.buildOrderBy([{ field: 'format', dir: 'desc' }]);

    expect(result).toHaveLength(2);
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

describe('readStatus filter field', () => {
  it('includesAny generates exists with inArray', () => {
    const { builder, db } = makeBuilder();

    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['reading', 'read'] }) as never,
      USER_CTX,
    ) as any;

    const ruleSql = getRuleSql(where);
    expect(ruleSql).toMatchObject({ type: 'sql' });
    expect(db.select).toHaveBeenCalled();
  });

  it('excludesAll generates not(exists) with inArray', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'readStatus', operator: 'excludesAll', value: ['abandoned'] }) as never,
      USER_CTX,
    ) as any;

    const ruleSql = getRuleSql(where);
    expect(ruleSql).toMatchObject({ type: 'not' });
  });

  it('isEmpty generates not(exists)', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'readStatus', operator: 'isEmpty' }) as never, USER_CTX) as any;

    const ruleSql = getRuleSql(where);
    expect(ruleSql).toMatchObject({ type: 'not' });
  });

  it('isNotEmpty generates exists', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'readStatus', operator: 'isNotEmpty' }) as never, USER_CTX) as any;

    const ruleSql = getRuleSql(where);
    expect(ruleSql).toMatchObject({ type: 'sql' });
  });

  it('includesAny with empty array returns always-false', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'readStatus', operator: 'includesAny', value: [] }) as never, USER_CTX) as any;

    const ruleSql = getRuleSql(where);
    expect(ruleSql).toMatchObject({ type: 'sql', text: '1 = 0' });
  });

  it('excludesAll with empty array returns always-true', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'readStatus', operator: 'excludesAll', value: [] }) as never, USER_CTX) as any;

    const ruleSql = getRuleSql(where);
    expect(ruleSql).toMatchObject({ type: 'sql', text: '1 = 1' });
  });

  it('throws when userId is undefined', () => {
    const { builder } = makeBuilder();

    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['read'] }) as never, {
        accessibleLibraryIds: [1],
      }),
    ).toThrow(BadRequestException);
  });

  it('throws for invalid operator', () => {
    const { builder } = makeBuilder();

    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'readStatus', operator: 'contains', value: 'read' }) as never, USER_CTX)).toThrow(
      BadRequestException,
    );
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

describe('buildQuickSearch', () => {
  it('produces an OR of title/series ilike and author/narrator exists subqueries', () => {
    const { builder } = makeBuilder();

    const result = builder.buildQuickSearch('tolkien') as any;

    expect(result).toMatchObject({ type: 'or' });
    expect(result.clauses).toHaveLength(4);
    expect(result.clauses[0]).toMatchObject({ type: 'ilike', pattern: '%tolkien%' });
    expect(result.clauses[1]).toMatchObject({ type: 'sql' });
    expect(result.clauses[2]).toMatchObject({ type: 'ilike', pattern: '%tolkien%' });
    expect(result.clauses[3]).toMatchObject({ type: 'sql' });
  });

  it('escapes LIKE special characters in q', () => {
    const { builder } = makeBuilder();

    const result = builder.buildQuickSearch('50% off') as any;

    expect(result.clauses[0]).toMatchObject({ type: 'ilike', pattern: '%50\\% off%' });
    expect(result.clauses[2]).toMatchObject({ type: 'ilike', pattern: '%50\\% off%' });
  });

  it('escapes underscore in q', () => {
    const { builder } = makeBuilder();

    const result = builder.buildQuickSearch('book_one') as any;

    expect(result.clauses[0]).toMatchObject({ type: 'ilike', pattern: '%book\\_one%' });
  });

  it('calls db.select twice (once for authors, once for narrators)', () => {
    const { builder, db } = makeBuilder();

    builder.buildQuickSearch('dune');

    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

describe('buildWhere with q', () => {
  it('ANDs q condition with library scope when q is present', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(undefined, { accessibleLibraryIds: [1], q: 'tolkien' }) as any;

    expect(where).toMatchObject({ type: 'and' });
    expect(where.clauses).toHaveLength(2);
    expect(where.clauses[1]).toMatchObject({ type: 'or' });
  });

  it('ANDs q condition with existing filter', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }) as never, {
      accessibleLibraryIds: [1],
      q: 'frank',
    }) as any;

    expect(where.clauses).toHaveLength(3);
    expect(where.clauses[2]).toMatchObject({ type: 'or' });
  });

  it('ignores q when empty string', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(undefined, { accessibleLibraryIds: [1], q: '' }) as any;

    expect(where.clauses).toHaveLength(1);
  });

  it('ignores q when whitespace only', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(undefined, { accessibleLibraryIds: [1], q: '   ' }) as any;

    expect(where.clauses).toHaveLength(1);
  });

  it('ignores q when undefined', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(undefined, { accessibleLibraryIds: [1] }) as any;

    expect(where.clauses).toHaveLength(1);
  });
});

describe('textRuleToSql (via title)', () => {
  it.each([
    ['contains', 'Dune', { type: 'ilike', pattern: '%Dune%' }],
    ['notContains', 'Dune', { type: 'or' }],
    ['startsWith', 'Dune', { type: 'ilike', pattern: 'Dune%' }],
    ['endsWith', 'Dune', { type: 'ilike', pattern: '%Dune' }],
    ['eq', 'Dune', { type: 'ilike', pattern: 'Dune' }],
    ['notEq', 'Dune', { type: 'or' }],
    ['isEmpty', undefined, { type: 'or' }],
    ['isNotEmpty', undefined, { type: 'and' }],
  ] as const)('operator %s produces the correct SQL shape', (operator, value, expected) => {
    const { builder } = makeBuilder();
    const rule: Record<string, unknown> = { type: 'rule', field: 'title', operator };
    if (value !== undefined) rule.value = value;

    const where = builder.buildWhere(wrapRule(rule) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject(expected);
  });

  it('notContains wraps an ilike in or(isNull, not())', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'notContains', value: 'Dune' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'or' });
    expect(clause.clauses[0]).toMatchObject({ type: 'isNull' });
    expect(clause.clauses[1]).toMatchObject({ type: 'not', value: { type: 'ilike', pattern: '%Dune%' } });
  });

  it('notEq wraps an exact ilike in or(isNull, not())', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'notEq', value: 'Dune' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'or' });
    expect(clause.clauses[0]).toMatchObject({ type: 'isNull' });
    expect(clause.clauses[1]).toMatchObject({ type: 'not', value: { type: 'ilike', pattern: 'Dune' } });
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

describe('read status date filters (startedAt / finishedAt)', () => {
  it('requires an authenticated user', () => {
    const { builder } = makeBuilder();
    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'startedAt', operator: 'before', value: '2026-01-01' }) as never, BASE_CTX),
    ).toThrow('startedAt filter requires an authenticated user');
  });

  it('builds before/after expressions using user-scoped date subqueries', () => {
    const { builder } = makeBuilder();
    const beforeWhere = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'startedAt', operator: 'before', value: '2026-01-01' }) as never,
      USER_CTX,
    ) as any;
    const afterWhere = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'finishedAt', operator: 'after', value: '2026-02-01' }) as never,
      USER_CTX,
    ) as any;

    const beforeRule = getRuleSql(beforeWhere);
    const afterRule = getRuleSql(afterWhere);
    expect(beforeRule).toMatchObject({ type: 'sql' });
    expect(afterRule).toMatchObject({ type: 'sql' });
    expect(beforeRule.values[1]).toBe('2026-01-01');
    expect(afterRule.values[1]).toBe('2026-02-01');
  });

  it('builds inclusive between and calendar-day withinLast expressions', () => {
    const { builder } = makeBuilder();
    const betweenWhere = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'startedAt', operator: 'between', value: '2026-01-01', valueTo: '2026-01-31' }) as never,
      USER_CTX,
    ) as any;
    const withinLastWhere = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'finishedAt', operator: 'withinLast', value: 7 }) as never,
      USER_CTX,
    ) as any;

    const betweenRule = getRuleSql(betweenWhere);
    const withinLastRule = getRuleSql(withinLastWhere);
    expect(betweenRule).toMatchObject({ type: 'sql' });
    expect(betweenRule.values[1]).toBe('2026-01-01');
    expect(betweenRule.values[3]).toBe('2026-01-31');
    expect(withinLastRule).toMatchObject({ type: 'sql' });
    expect(withinLastRule.text.toLowerCase()).toContain('timezone(');
  });

  it('supports isEmpty / isNotEmpty operators', () => {
    const { builder } = makeBuilder();
    const emptyWhere = builder.buildWhere(wrapRule({ type: 'rule', field: 'startedAt', operator: 'isEmpty' }) as never, USER_CTX) as any;
    const notEmptyWhere = builder.buildWhere(wrapRule({ type: 'rule', field: 'finishedAt', operator: 'isNotEmpty' }) as never, USER_CTX) as any;

    const emptyRule = getRuleSql(emptyWhere);
    const notEmptyRule = getRuleSql(notEmptyWhere);
    expect(emptyRule).toMatchObject({ type: 'sql' });
    expect(notEmptyRule).toMatchObject({ type: 'sql' });
    expect(emptyRule.text.toLowerCase()).toContain('is null');
    expect(notEmptyRule.text.toLowerCase()).toContain('is not null');
  });

  it('normalizes ISO date values using the provided timezone', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'startedAt', operator: 'before', value: '2026-01-01T02:30:00.000Z' }) as never, {
      ...USER_CTX,
      timeZone: 'America/New_York',
    }) as any;
    const rule = getRuleSql(where);
    expect(rule.values[1]).toBe('2025-12-31');
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

describe('ILIKE pattern escaping (SEC-013)', () => {
  it('escapes literal percent signs in contains patterns', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'contains', value: '100%' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause.pattern).toBe('%100\\%%');
  });

  it('escapes literal underscores in contains patterns', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'contains', value: 'a_b' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause.pattern).toBe('%a\\_b%');
  });

  it('escapes backslashes before other special characters', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'contains', value: 'a\\%b' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause.pattern).toBe('%a\\\\\\%b%');
  });

  it('escapes percent signs in startsWith patterns', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'startsWith', value: '50%off' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause.pattern).toBe('50\\%off%');
  });

  it('escapes underscores in endsWith patterns', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'endsWith', value: '_end' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause.pattern).toBe('%\\_end');
  });

  it('does not alter patterns with no special characters', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause.pattern).toBe('%Dune%');
  });
});

describe('coverRuleToSql', () => {
  it('isMissing produces isNull(bookMetadata.coverSource)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'cover', operator: 'isMissing' }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'isNull' });
  });

  it('isPresent produces isNotNull(bookMetadata.coverSource)', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'cover', operator: 'isPresent' }) as never, BASE_CTX) as any;
    expect(getRuleSql(where)).toMatchObject({ type: 'isNotNull' });
  });
});

describe('BookQueryBuilder.hasSeriesFilter', () => {
  it('returns false for undefined', () => {
    expect(BookQueryBuilder.hasSeriesFilter(undefined)).toBe(false);
  });

  it('returns false for a group with no rules', () => {
    expect(BookQueryBuilder.hasSeriesFilter({ type: 'group', join: 'AND', rules: [] })).toBe(false);
  });

  it('returns false when no series rule is present', () => {
    const node = {
      type: 'group' as const,
      join: 'AND' as const,
      rules: [
        { type: 'rule' as const, field: 'title' as never, operator: 'contains' as never, value: 'Dune' },
        { type: 'rule' as const, field: 'author' as never, operator: 'contains' as never, value: 'Frank' },
      ],
    };
    expect(BookQueryBuilder.hasSeriesFilter(node)).toBe(false);
  });

  it('returns true for a direct series rule', () => {
    const node = { type: 'rule' as const, field: 'series' as never, operator: 'contains' as never, value: 'Dune' };
    expect(BookQueryBuilder.hasSeriesFilter(node)).toBe(true);
  });

  it('returns true when series rule is inside a nested group', () => {
    const inner = {
      type: 'group' as const,
      join: 'OR' as const,
      rules: [{ type: 'rule' as const, field: 'series' as never, operator: 'equals' as never, value: 'Mistborn' }],
    };
    const outer = { type: 'group' as const, join: 'AND' as const, rules: [inner] };
    expect(BookQueryBuilder.hasSeriesFilter(outer)).toBe(true);
  });

  it('returns true when series rule is alongside other rules in a group', () => {
    const node = {
      type: 'group' as const,
      join: 'AND' as const,
      rules: [
        { type: 'rule' as const, field: 'title' as never, operator: 'contains' as never, value: 'book' },
        { type: 'rule' as const, field: 'series' as never, operator: 'equals' as never, value: 'Stormlight' },
      ],
    };
    expect(BookQueryBuilder.hasSeriesFilter(node)).toBe(true);
  });
});

describe('BookQueryBuilder.buildCollapseOrderBy', () => {
  it('returns default sort when sort array is empty', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([], 1)).toBe('sort_title ASC NULLS LAST, r.id ASC');
  });

  it('returns default sort when all directions are invalid', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'title', dir: 'invalid' as never }], 1);
    expect(result).toBe('sort_title ASC NULLS LAST, r.id ASC');
  });

  it('generates sort_title for title field', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'title', dir: 'asc' }], 1)).toBe('sort_title ASC NULLS LAST, r.id ASC');
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'title', dir: 'desc' }], 1)).toBe('sort_title DESC NULLS LAST, r.id ASC');
  });

  it('generates sort_title for series field', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'series', dir: 'asc' }], 1)).toBe('sort_title ASC NULLS LAST, r.id ASC');
  });

  it('generates sort_added_at for addedAt field', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'addedAt', dir: 'desc' }], 1)).toBe('sort_added_at DESC NULLS LAST, r.id ASC');
  });

  it('generates seriesIndex with sort_title fallback when series is not in sort', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'seriesIndex', dir: 'asc' }], 1);
    expect(result).toBe('series_index ASC NULLS LAST, sort_title ASC NULLS LAST, r.id ASC');
  });

  it('does not add sort_title fallback when series field is already in sort', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy(
      [
        { field: 'seriesIndex', dir: 'asc' },
        { field: 'series', dir: 'asc' },
      ],
      1,
    );
    expect(result).toBe('series_index ASC NULLS LAST, sort_title ASC NULLS LAST, r.id ASC');
  });

  it('generates user-scoped subquery for readProgress', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'readProgress', dir: 'desc' }], 42);
    expect(result).toContain('rp.user_id = 42');
    expect(result).toContain('bf.book_id = r.id');
    expect(result).toContain('DESC NULLS LAST');
  });

  it('generates user-scoped subquery for lastReadAt', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'lastReadAt', dir: 'asc' }], 7);
    expect(result).toContain('rp.user_id = 7');
    expect(result).toContain('bf.book_id = r.id');
    expect(result).toContain('ASC NULLS LAST');
  });

  it('generates user-scoped subquery for finishedAt', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'finishedAt', dir: 'desc' }], 5);
    expect(result).toContain('ubs.user_id = 5');
    expect(result).toContain('ubs.book_id = r.id');
    expect(result).toContain('DESC NULLS LAST');
  });

  it('generates user-scoped subquery for startedAt', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'startedAt', dir: 'asc' }], 5);
    expect(result).toContain('ubs.user_id = 5');
    expect(result).toContain('ubs.book_id = r.id');
    expect(result).toContain('ASC NULLS LAST');
  });

  it('generates author sort using the representative author sort key', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'author', dir: 'asc' }], 1);
    expect(result).toBe('author_sort_name ASC NULLS LAST, r.id ASC');
  });

  it('generates publishedYear sort', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'publishedYear', dir: 'asc' }], 1)).toBe('published_year ASC NULLS LAST, r.id ASC');
  });

  it('generates rating sort', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'rating', dir: 'desc' }], 1)).toBe('rating DESC NULLS LAST, r.id ASC');
  });

  it('joins multiple sort parts with comma', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy(
      [
        { field: 'addedAt', dir: 'desc' },
        { field: 'title', dir: 'asc' },
      ],
      1,
    );
    expect(result).toBe('sort_added_at DESC NULLS LAST, sort_title ASC NULLS LAST, r.id ASC');
  });

  it('skips unrecognised sort fields silently', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'unknownField' as never, dir: 'asc' }], 1);
    expect(result).toBe('sort_title ASC NULLS LAST, r.id ASC');
  });

  it('generates readStatus sort using subquery', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'readStatus', dir: 'asc' }], 1);
    expect(result).toContain('user_book_status');
    expect(result).toContain('ASC NULLS LAST');
  });

  it('generates format sort using subquery', () => {
    const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'format', dir: 'desc' }], 1);
    expect(result).toContain('book_files');
    expect(result).toContain('DESC NULLS LAST');
  });

  it('throws for non-integer userId', () => {
    expect(() => BookQueryBuilder.buildCollapseOrderBy([{ field: 'readProgress', dir: 'asc' }], 1.5)).toThrow('Invalid userId');
    expect(() => BookQueryBuilder.buildCollapseOrderBy([{ field: 'readProgress', dir: 'asc' }], NaN)).toThrow('Invalid userId');
    expect(() => BookQueryBuilder.buildCollapseOrderBy([{ field: 'readProgress', dir: 'asc' }], Infinity)).toThrow('Invalid userId');
  });
});
