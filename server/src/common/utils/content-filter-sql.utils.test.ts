vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ type: 'and', clauses })),
  or: vi.fn((...clauses: unknown[]) => ({ type: 'or', clauses })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ type: 'inArray', left, right })),
  exists: vi.fn((subquery: unknown) => ({ type: 'exists', subquery })),
  notExists: vi.fn((subquery: unknown) => ({ type: 'notExists', subquery })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', text: strings.join(''), values })),
}));

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import { buildContentFilterClauses } from './content-filter-sql.utils';

function makeDb() {
  const where = vi.fn((clause: unknown) => ({ type: 'subquery', clause }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select },
    select,
    from,
    where,
  };
}

describe('buildContentFilterClauses', () => {
  it('returns no clauses for empty filters', () => {
    const { db, select } = makeDb();

    expect(buildContentFilterClauses(EMPTY_CONTENT_FILTER_RULES, db as any)).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('builds a single exists clause for includeTagIds only', () => {
    const { db, where } = makeDb();

    const clauses = buildContentFilterClauses({ ...EMPTY_CONTENT_FILTER_RULES, includeTagIds: [1, 2] }, db as any);

    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({ type: 'exists' });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('builds a single exists clause for includeGenreIds only', () => {
    const { db, where } = makeDb();

    const clauses = buildContentFilterClauses({ ...EMPTY_CONTENT_FILTER_RULES, includeGenreIds: [4] }, db as any);

    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({ type: 'exists' });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('combines includeTagIds and includeGenreIds with OR when both are set', () => {
    const { db, where } = makeDb();

    const clauses = buildContentFilterClauses({ ...EMPTY_CONTENT_FILTER_RULES, includeTagIds: [1], includeGenreIds: [4] }, db as any);

    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({ type: 'or' });
    expect(where).toHaveBeenCalledTimes(2);
  });

  it('builds a notExists clause for excludeTagIds', () => {
    const { db, where } = makeDb();

    const clauses = buildContentFilterClauses({ ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [3] }, db as any);

    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({ type: 'notExists' });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('builds a notExists clause for excludeGenreIds', () => {
    const { db, where } = makeDb();

    const clauses = buildContentFilterClauses({ ...EMPTY_CONTENT_FILTER_RULES, excludeGenreIds: [5] }, db as any);

    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({ type: 'notExists' });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('returns 3 clauses when all four lists are active (OR for includes, notExists each for excludes)', () => {
    const { db, where } = makeDb();

    const clauses = buildContentFilterClauses({ includeTagIds: [1], excludeTagIds: [2], includeGenreIds: [3], excludeGenreIds: [4] }, db as any);

    expect(clauses).toHaveLength(3);
    expect((clauses[0] as { type: string }).type).toBe('or');
    expect((clauses[1] as { type: string }).type).toBe('notExists');
    expect((clauses[2] as { type: string }).type).toBe('notExists');
    expect(where).toHaveBeenCalledTimes(4);
  });

  it('exclude rules are independent - notExists for each exclude list regardless of includes', () => {
    const { db } = makeDb();

    const clauses = buildContentFilterClauses({ ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [2], excludeGenreIds: [5] }, db as any);

    expect(clauses).toHaveLength(2);
    expect(clauses.map((c) => (c as { type: string }).type)).toEqual(['notExists', 'notExists']);
  });
});
