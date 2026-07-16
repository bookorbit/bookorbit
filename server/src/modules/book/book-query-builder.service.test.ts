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

vi.mock('../../common/utils/accent-insensitive-search.utils', () => ({
  accentInsensitiveIlike: vi.fn((left: unknown, pattern: string) => ({ type: 'accentInsensitiveIlike', left, pattern })),
}));

import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { EMPTY_CONTENT_FILTER_RULES, FIELD_OPERATORS, type RuleField, type RuleOperator } from '@bookorbit/types';

import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
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

/**
 * Recursively gathers the static SQL text fragments from a (possibly deeply nested)
 * mocked clause tree so tests can assert on keywords composed across nested sql`` templates.
 */
function collectSqlText(node: unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== 'object') return acc;
  const n = node as Record<string, unknown>;
  if (n.type === 'sql' && typeof n.text === 'string') acc.push(n.text);
  for (const key of ['values', 'clauses'] as const) {
    const arr = n[key];
    if (Array.isArray(arr)) arr.forEach((child) => collectSqlText(child, acc));
  }
  for (const key of ['value', 'left', 'right'] as const) {
    if (n[key]) collectSqlText(n[key], acc);
  }
  return acc;
}

function expectPostgresSafeDateArithmetic(node: unknown): void {
  const unsafeFragments = collectSqlText(node).filter((text) => {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ');
    return /::date - (?!::int\b|\d+\b|\()/.test(normalized);
  });
  expect(unsafeFragments).toEqual([]);
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
  const numericFields: RuleField[] = ['publishedYear', 'seriesIndex', 'pageCount', 'rating', 'communityRating', 'metadataScore'];
  const dateFields: RuleField[] = ['publishedDate', 'addedAt', 'startedAt', 'finishedAt'];
  const isNumericField = numericFields.includes(field);

  switch (operator) {
    case 'isEmpty':
    case 'isNotEmpty':
    case 'isMissing':
    case 'isPresent':
    case 'isUnread':
    case 'isInProgress':
    case 'isFinished':
    case 'isLocked':
    case 'isUnlocked':
    case 'isUpNext':
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
      return dateFields.includes(field) ? { value: '2023-01-01', valueTo: '2023-12-31' } : { value: 10, valueTo: 20 };
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
    expect(where.clauses[2].clauses[0]).toMatchObject({ type: 'accentInsensitiveIlike', pattern: '%Dune%' });
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

  it('builds one accent-insensitive author subquery per includesAll value', () => {
    const { builder, db } = makeBuilder();

    builder.buildWhere(wrapRule({ type: 'rule', field: 'author', operator: 'includesAll', value: ['Frank', 'Herbert'] }) as never, {
      accessibleLibraryIds: [1],
      userId: 10,
    });

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(expect.anything(), '%Frank%');
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(expect.anything(), '%Herbert%');
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

describe('communityRating filter field', () => {
  it('matches any provider rating with the requested numeric predicate', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5, provider: 'any' }) as never,
      USER_CTX,
    ) as any;

    const ruleSql = getRuleSql(where) as any;
    expect(ruleSql).toMatchObject({ type: 'sql' });
    expect(ruleSql.values[0].whereClause).toMatchObject({ type: 'and' });
    expect(ruleSql.values[0].whereClause.clauses).toHaveLength(2);
    expect(ruleSql.values[0].whereClause.clauses[1]).toMatchObject({ type: 'gte', right: 4.5 });
  });

  it('defaults omitted provider to any provider for backwards-compatible saved filters', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5 }) as never, USER_CTX) as any;

    const ruleSql = getRuleSql(where) as any;
    expect(ruleSql).toMatchObject({ type: 'sql' });
    expect(ruleSql.values[0].whereClause.clauses).toHaveLength(2);
    expect(ruleSql.values[0].whereClause.clauses[1]).toMatchObject({ type: 'gte', right: 4.5 });
  });

  it('matches a specific provider rating with provider and rating predicates in the same exists subquery', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'communityRating', operator: 'gt', value: 4, provider: 'amazon' }) as never,
      USER_CTX,
    ) as any;

    const ruleSql = getRuleSql(where) as any;
    expect(ruleSql).toMatchObject({ type: 'sql' });
    expect(ruleSql.values[0].whereClause).toMatchObject({ type: 'and' });
    expect(ruleSql.values[0].whereClause.clauses).toHaveLength(3);
    expect(ruleSql.values[0].whereClause.clauses[1]).toMatchObject({ type: 'eq', right: 'amazon' });
    expect(ruleSql.values[0].whereClause.clauses[2]).toMatchObject({ type: 'gt', right: 4 });
  });

  it('supports independent provider predicates through normal AND groups', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(
      {
        type: 'group',
        join: 'AND',
        rules: [
          { type: 'rule', field: 'communityRating', operator: 'gt', value: 4, provider: 'amazon' },
          { type: 'rule', field: 'communityRating', operator: 'lt', value: 3, provider: 'goodreads' },
        ],
      } as never,
      USER_CTX,
    ) as any;

    const filterGroup = where.clauses[1];
    expect(filterGroup).toMatchObject({ type: 'and' });
    expect(filterGroup.clauses).toHaveLength(2);
    expect(filterGroup.clauses[0].values[0].whereClause.clauses[1]).toMatchObject({ type: 'eq', right: 'amazon' });
    expect(filterGroup.clauses[1].values[0].whereClause.clauses[1]).toMatchObject({ type: 'eq', right: 'goodreads' });
  });

  it('treats provider-specific isEmpty as no row for that provider', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'communityRating', operator: 'isEmpty', provider: 'goodreads' }) as never,
      USER_CTX,
    ) as any;

    const ruleSql = getRuleSql(where) as any;
    expect(ruleSql).toMatchObject({ type: 'not' });
    expect(ruleSql.value.values[0].whereClause.clauses[1]).toMatchObject({ type: 'eq', right: 'goodreads' });
  });

  it('requires an actual row for negative comparisons instead of matching missing ratings', () => {
    const { builder } = makeBuilder();

    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'communityRating', operator: 'notEq', value: 4, provider: 'hardcover' }) as never,
      USER_CTX,
    ) as any;

    const ruleSql = getRuleSql(where) as any;
    expect(ruleSql).toMatchObject({ type: 'sql' });
    expect(ruleSql.values[0].whereClause.clauses[1]).toMatchObject({ type: 'eq', right: 'hardcover' });
    expect(ruleSql.values[0].whereClause.clauses[2]).toMatchObject({ type: 'ne', right: 4 });
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

        let where: unknown;
        expect(() => {
          where = builder.buildWhere(wrapRule(rule) as never, USER_CTX);
        }, `field '${field}' operator '${operator}' should not throw`).not.toThrow();
        expectPostgresSafeDateArithmetic(where);
      }
    },
  );
});

describe('buildQuickSearch', () => {
  it('passes an unaccented author query through every accent-insensitive text predicate', () => {
    const { builder } = makeBuilder();
    vi.mocked(accentInsensitiveIlike).mockClear();

    builder.buildQuickSearch('gracian');

    expect(accentInsensitiveIlike).toHaveBeenCalledTimes(5);
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(expect.anything(), '%gracian%');
  });

  it('produces an OR of accent-insensitive title/series matches and author/series/narrator exists subqueries', () => {
    const { builder } = makeBuilder();

    const result = builder.buildQuickSearch('tolkien') as any;

    expect(result).toMatchObject({ type: 'or' });
    expect(result.clauses).toHaveLength(5);
    expect(result.clauses[0]).toMatchObject({ type: 'accentInsensitiveIlike', pattern: '%tolkien%' });
    expect(result.clauses[1]).toMatchObject({ type: 'sql' });
    expect(result.clauses[2]).toMatchObject({ type: 'accentInsensitiveIlike', pattern: '%tolkien%' });
    expect(result.clauses[3]).toMatchObject({ type: 'sql' });
    expect(result.clauses[4]).toMatchObject({ type: 'sql' });
  });

  it('escapes LIKE special characters in q', () => {
    const { builder } = makeBuilder();

    const result = builder.buildQuickSearch('50% off') as any;

    expect(result.clauses[0]).toMatchObject({ type: 'accentInsensitiveIlike', pattern: '%50\\% off%' });
    expect(result.clauses[2]).toMatchObject({ type: 'accentInsensitiveIlike', pattern: '%50\\% off%' });
  });

  it('escapes underscore in q', () => {
    const { builder } = makeBuilder();

    const result = builder.buildQuickSearch('book_one') as any;

    expect(result.clauses[0]).toMatchObject({ type: 'accentInsensitiveIlike', pattern: '%book\\_one%' });
  });

  it('calls db.select three times for author, series membership, and narrator exists subqueries', () => {
    const { builder, db } = makeBuilder();

    builder.buildQuickSearch('dune');

    expect(db.select).toHaveBeenCalledTimes(3);
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
    ['contains', 'Dune', { type: 'accentInsensitiveIlike', pattern: '%Dune%' }],
    ['notContains', 'Dune', { type: 'or' }],
    ['startsWith', 'Dune', { type: 'accentInsensitiveIlike', pattern: 'Dune%' }],
    ['endsWith', 'Dune', { type: 'accentInsensitiveIlike', pattern: '%Dune' }],
    ['eq', 'Dune', { type: 'accentInsensitiveIlike', pattern: 'Dune' }],
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

  it('notContains wraps an accent-insensitive match in or(isNull, not())', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'notContains', value: 'Dune' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'or' });
    expect(clause.clauses[0]).toMatchObject({ type: 'isNull' });
    expect(clause.clauses[1]).toMatchObject({ type: 'not', value: { type: 'accentInsensitiveIlike', pattern: '%Dune%' } });
  });

  it('notEq wraps an exact accent-insensitive match in or(isNull, not())', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'title', operator: 'notEq', value: 'Dune' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'or' });
    expect(clause.clauses[0]).toMatchObject({ type: 'isNull' });
    expect(clause.clauses[1]).toMatchObject({ type: 'not', value: { type: 'accentInsensitiveIlike', pattern: 'Dune' } });
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

  it('throws for unsupported operators', () => {
    const { builder } = makeBuilder();
    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'tag', operator: 'contains', value: 'favourite' }) as never, USER_CTX)).toThrow(
      BadRequestException,
    );
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

  it('throws for unsupported operators', () => {
    const { builder } = makeBuilder();
    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'collection', operator: 'contains', value: 'Reading' }) as never, USER_CTX),
    ).toThrow(BadRequestException);
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

  it('throws for unsupported operators', () => {
    const { builder } = makeBuilder();
    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'library', operator: 'contains', value: 'Main' }) as never, USER_CTX)).toThrow(
      BadRequestException,
    );
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

describe('publishedDateRuleToSql', () => {
  it('filters against full dates with published year fallback', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(
      wrapRule({ type: 'rule', field: 'publishedDate', operator: 'before', value: '1970-01-01' }) as never,
      BASE_CTX,
    ) as any;

    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'sql' });
    expect(collectSqlText(clause).join(' ')).toContain('coalesce(');
    expect(collectSqlText(clause).join(' ')).toContain('make_date(');
    expect(clause.values[1]).toBe('1970-01-01');
  });

  it('treats publishedDate as empty only when both full date and year are missing', () => {
    const { builder } = makeBuilder();
    const emptyWhere = builder.buildWhere(wrapRule({ type: 'rule', field: 'publishedDate', operator: 'isEmpty' }) as never, BASE_CTX) as any;
    const notEmptyWhere = builder.buildWhere(wrapRule({ type: 'rule', field: 'publishedDate', operator: 'isNotEmpty' }) as never, BASE_CTX) as any;

    expect(getRuleSql(emptyWhere)).toMatchObject({
      type: 'and',
      clauses: [{ type: 'isNull' }, { type: 'isNull' }],
    });
    expect(getRuleSql(notEmptyWhere)).toMatchObject({
      type: 'or',
      clauses: [{ type: 'isNotNull' }, { type: 'isNotNull' }],
    });
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

  it.each(['startedAt', 'finishedAt'] as const)('casts withinLast day offset for %s so PostgreSQL keeps date arithmetic typed', (field) => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field, operator: 'withinLast', value: 30 }) as never, {
      ...USER_CTX,
      timeZone: 'America/Chicago',
    }) as any;

    const rule = getRuleSql(where);
    expect(rule).toMatchObject({ type: 'sql' });
    expect(rule.text.toLowerCase()).toContain('::date - ::int');
    expect(rule.values[1]).toBe('America/Chicago');
    expect(rule.values[2]).toBe(29);
    expectPostgresSafeDateArithmetic(rule);
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

  it('throws for unsupported operators', () => {
    const { builder } = makeBuilder();
    expect(() =>
      builder.buildWhere(wrapRule({ type: 'rule', field: 'isbn', operator: 'contains', value: '9780141187761' }) as never, BASE_CTX),
    ).toThrow(BadRequestException);
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

describe('lockStatusRuleToSql', () => {
  it('isLocked produces cardinality(lockedFields) > 0', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'lockStatus', operator: 'isLocked' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'sql' });
    expect(clause.text).toContain('cardinality');
    expect(clause.text).toContain('> 0');
  });

  it('isUnlocked produces cardinality(lockedFields) = 0', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'lockStatus', operator: 'isUnlocked' }) as never, BASE_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'sql' });
    expect(clause.text).toContain('cardinality');
    expect(clause.text).toContain('= 0');
  });

  it('rejects an invalid operator for lockStatus', () => {
    const { builder } = makeBuilder();
    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'lockStatus', operator: 'isPresent' }) as never, BASE_CTX)).toThrow(
      BadRequestException,
    );
  });
});

describe('seriesStatusRuleToSql', () => {
  it('isUpNext builds set membership against the shelf window-function pipeline', () => {
    const { builder } = makeBuilder();
    const where = builder.buildWhere(wrapRule({ type: 'rule', field: 'seriesStatus', operator: 'isUpNext' }) as never, USER_CTX) as any;
    const clause = getRuleSql(where);
    expect(clause).toMatchObject({ type: 'sql' });

    const text = collectSqlText(clause).join(' ').toLowerCase();
    expect(text).toContain(' in (');
    expect(text).toContain('distinct on');
    expect(text).toContain('lag(');
    expect(text).toContain('partition by');
    expect(text).toContain('previous_is_completed');
    expect(text).toContain("'read'");
    expect(text).toContain("'skimmed'");
  });

  it('requires an authenticated user', () => {
    const { builder } = makeBuilder();
    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'seriesStatus', operator: 'isUpNext' }) as never, BASE_CTX)).toThrow(
      'Series status filter requires an authenticated user',
    );
  });

  it('rejects an invalid operator for seriesStatus', () => {
    const { builder } = makeBuilder();
    expect(() => builder.buildWhere(wrapRule({ type: 'rule', field: 'seriesStatus', operator: 'isFinished' }) as never, USER_CTX)).toThrow(
      BadRequestException,
    );
  });
});

describe('BookQueryBuilder.hasSeriesSelectionFilter', () => {
  it('returns false for undefined', () => {
    expect(BookQueryBuilder.hasSeriesSelectionFilter(undefined)).toBe(false);
  });

  it('returns false for a group with no rules', () => {
    expect(BookQueryBuilder.hasSeriesSelectionFilter({ type: 'group', join: 'AND', rules: [] })).toBe(false);
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
    expect(BookQueryBuilder.hasSeriesSelectionFilter(node)).toBe(false);
  });

  it('returns true for a direct series selection rule', () => {
    const node = { type: 'rule' as const, field: 'series' as never, operator: 'contains' as never, value: 'Dune' };
    expect(BookQueryBuilder.hasSeriesSelectionFilter(node)).toBe(true);
  });

  it.each(['isEmpty', 'isNotEmpty'] as const)('returns false for a series presence rule: %s', (operator) => {
    const node = { type: 'rule' as const, field: 'series' as never, operator };
    expect(BookQueryBuilder.hasSeriesSelectionFilter(node)).toBe(false);
  });

  it('returns true when series rule is inside a nested group', () => {
    const inner = {
      type: 'group' as const,
      join: 'OR' as const,
      rules: [{ type: 'rule' as const, field: 'series' as never, operator: 'equals' as never, value: 'Mistborn' }],
    };
    const outer = { type: 'group' as const, join: 'AND' as const, rules: [inner] };
    expect(BookQueryBuilder.hasSeriesSelectionFilter(outer)).toBe(true);
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
    expect(BookQueryBuilder.hasSeriesSelectionFilter(node)).toBe(true);
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

  it('generates publishedDate sort with year fallback', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'publishedDate', dir: 'desc' }], 1)).toBe(
      'coalesce(published_date, make_date(published_year, 1, 1)) DESC NULLS LAST, r.id ASC',
    );
  });

  it('generates rating sort', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'rating', dir: 'desc' }], 1)).toBe('rating DESC NULLS LAST, r.id ASC');
  });

  it('generates publisher sort', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'publisher', dir: 'asc' }], 1)).toBe('publisher ASC NULLS LAST, r.id ASC');
  });

  it('generates pageCount sort', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'pageCount', dir: 'desc' }], 1)).toBe('page_count DESC NULLS LAST, r.id ASC');
  });

  it('generates updatedAt sort', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'updatedAt', dir: 'asc' }], 1)).toBe('updated_at ASC NULLS LAST, r.id ASC');
  });

  it('generates fileSize sort using the primary file', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'fileSize', dir: 'desc' }], 1)).toBe(
      '(SELECT bf.size_bytes FROM book_files bf WHERE bf.id = r.primary_file_id) DESC NULLS LAST, r.id ASC',
    );
  });

  it('generates deterministic random sort scoped to the user and day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00.000Z'));

    try {
      const scopedSeed = Math.floor(Date.now() / 86_400_000) + 7;
      const result = BookQueryBuilder.buildCollapseOrderBy([{ field: 'random', dir: 'asc' }], 7);

      expect(result).toContain(`md5(r.id::text || ':' || ${scopedSeed}::text) ASC`);
      expect(result.endsWith('r.id ASC')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    expect(result).toContain('COALESCE');
    expect(result).toContain("'unread'");
    expect(result).toContain('ASC NULLS LAST');
  });

  it('generates language sort over the representative field', () => {
    expect(BookQueryBuilder.buildCollapseOrderBy([{ field: 'language', dir: 'desc' }], 1)).toBe('r.language DESC NULLS LAST, r.id ASC');
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
