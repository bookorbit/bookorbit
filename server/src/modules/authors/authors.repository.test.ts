vi.mock('drizzle-orm', () => ({
  SQL: class {},
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
  desc: vi.fn((value: unknown) => ({ op: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ op: 'gt', left, right })),
  gte: vi.fn((left: unknown, right: unknown) => ({ op: 'gte', left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ op: 'ilike', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
  max: vi.fn((value: unknown) => ({ op: 'max', value })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { eq, sql } from 'drizzle-orm';

import { AuthorsRepository } from './authors.repository';

describe('AuthorsRepository', () => {
  it('updateAuthorDescriptionIfEmpty treats whitespace-only descriptions as empty', async () => {
    const updateBuilder = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    updateBuilder.returning.mockResolvedValue([{ id: 11 }]);

    const db = {
      update: vi.fn().mockReturnValue(updateBuilder),
    };

    const repo = new AuthorsRepository(db as never);
    await expect(repo.updateAuthorDescriptionIfEmpty(11, 'New bio')).resolves.toBe(true);

    expect(sql).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith(expect.objectContaining({ op: 'sql' }), '');
    expect(updateBuilder.returning).toHaveBeenCalled();
  });
});
