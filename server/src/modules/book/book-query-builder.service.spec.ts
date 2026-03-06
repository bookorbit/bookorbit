jest.mock('drizzle-orm', () => {
  const sqlTag = Object.assign(
    jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', text: strings.join(''), values })),
    {
      raw: jest.fn((value: string) => ({ type: 'raw', value })),
    },
  );

  return {
    and: jest.fn((...clauses: unknown[]) => ({ type: 'and', clauses })),
    or: jest.fn((...clauses: unknown[]) => ({ type: 'or', clauses })),
    eq: jest.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
    ne: jest.fn((left: unknown, right: unknown) => ({ type: 'ne', left, right })),
    gt: jest.fn((left: unknown, right: unknown) => ({ type: 'gt', left, right })),
    gte: jest.fn((left: unknown, right: unknown) => ({ type: 'gte', left, right })),
    lt: jest.fn((left: unknown, right: unknown) => ({ type: 'lt', left, right })),
    lte: jest.fn((left: unknown, right: unknown) => ({ type: 'lte', left, right })),
    ilike: jest.fn((left: unknown, pattern: string) => ({ type: 'ilike', left, pattern })),
    inArray: jest.fn((left: unknown, right: unknown) => ({ type: 'inArray', left, right })),
    isNull: jest.fn((value: unknown) => ({ type: 'isNull', value })),
    isNotNull: jest.fn((value: unknown) => ({ type: 'isNotNull', value })),
    not: jest.fn((value: unknown) => ({ type: 'not', value })),
    sql: sqlTag,
  };
});

import { BadRequestException } from '@nestjs/common';
import { ilike, sql } from 'drizzle-orm';

import { BookQueryBuilder } from './book-query-builder.service';

function makeBuilder() {
  const sqWhere = jest.fn((whereClause?: unknown) => ({ type: 'subquery', whereClause }));
  const sqInnerJoin = jest.fn().mockReturnValue({ where: sqWhere });
  const sqFrom = jest.fn().mockReturnValue({ innerJoin: sqInnerJoin, where: sqWhere });
  const db = {
    select: jest.fn().mockReturnValue({ from: sqFrom }),
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

describe('BookQueryBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    const raw = (sql as unknown as { raw: jest.Mock }).raw;

    const result = builder.buildOrderBy([{ field: 'seriesIndex', dir: 'desc' }]);

    expect(result).toHaveLength(2);
    expect(raw).toHaveBeenCalledTimes(2);
    expect(raw).toHaveBeenNthCalledWith(1, 'DESC');
    expect(raw).toHaveBeenNthCalledWith(2, 'DESC');
  });

  it('falls back to default order when runtime direction is invalid', () => {
    const { builder } = makeBuilder();
    const raw = (sql as unknown as { raw: jest.Mock }).raw;

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
