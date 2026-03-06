jest.mock('drizzle-orm', () => ({
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  isNull: jest.fn((value: unknown) => ({ op: 'isNull', value })),
  or: jest.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { emailProviders } from '../../db/schema';
import { EmailProviderRepository } from './email-provider.repository';

describe('EmailProviderRepository', () => {
  const makeDb = () => {
    const selectBuilder = {
      from: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);

    const insertBuilder = { values: jest.fn(), returning: jest.fn() };
    insertBuilder.values.mockReturnValue(insertBuilder);

    const updateBuilder = { set: jest.fn(), where: jest.fn(), returning: jest.fn() };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);

    const deleteBuilder = { where: jest.fn(), returning: jest.fn() };
    deleteBuilder.where.mockReturnValue(deleteBuilder);

    return {
      selectBuilder,
      insertBuilder,
      updateBuilder,
      deleteBuilder,
      db: {
        select: jest.fn().mockReturnValue(selectBuilder),
        insert: jest.fn().mockReturnValue(insertBuilder),
        update: jest.fn().mockReturnValue(updateBuilder),
        delete: jest.fn().mockReturnValue(deleteBuilder),
      },
    };
  };

  it('findAllForUser returns owner or shared providers sorted by name', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.findAllForUser(21);

    expect(eq).toHaveBeenCalledWith(emailProviders.userId, 21);
    expect(eq).toHaveBeenCalledWith(emailProviders.isShared, true);
    expect(or).toHaveBeenCalledWith({ op: 'eq', left: emailProviders.userId, right: 21 }, { op: 'eq', left: emailProviders.isShared, right: true });
    expect(selectBuilder.orderBy).toHaveBeenCalledWith(emailProviders.name);
  });

  it('findById limits to a single provider', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.findById(8);

    expect(eq).toHaveBeenCalledWith(emailProviders.id, 8);
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);
  });

  it('insert forwards values and returns inserted row', () => {
    const { db, insertBuilder } = makeDb();
    insertBuilder.returning.mockResolvedValue([{ id: 5 }]);
    const repo = new EmailProviderRepository(db as never);

    const payload = {
      userId: 1,
      name: 'SMTP',
      host: 'smtp.example.com',
      port: 587,
      auth: true,
      ssl: false,
      startTls: true,
    };

    void repo.insert(payload as never);

    expect(db.insert).toHaveBeenCalledWith(emailProviders);
    expect(insertBuilder.values).toHaveBeenCalledWith(payload);
    expect(insertBuilder.returning).toHaveBeenCalled();
  });

  it('update scopes by provider id and owner and updates updatedAt', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.update(8, 21, { name: 'Updated' } as never);

    expect(db.update).toHaveBeenCalledWith(emailProviders);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      name: 'Updated',
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });
    expect(and).toHaveBeenCalledWith({ op: 'eq', left: emailProviders.id, right: 8 }, { op: 'eq', left: emailProviders.userId, right: 21 });
    expect(updateBuilder.returning).toHaveBeenCalled();
    expect(sql).toHaveBeenCalled();
  });

  it('clearDefault only clears current owners default rows', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.clearDefault(4);

    expect(db.update).toHaveBeenCalledWith(emailProviders);
    expect(updateBuilder.set).toHaveBeenCalledWith({ isDefault: false });
    expect(updateBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailProviders.userId, right: 4 },
        { op: 'eq', left: emailProviders.isDefault, right: true },
      ],
    });
  });

  it('setDefault marks only owner record and returns updated provider', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.setDefault(9, 4);

    expect(db.update).toHaveBeenCalledWith(emailProviders);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      isDefault: true,
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });
    expect(updateBuilder.returning).toHaveBeenCalled();
  });

  it('setShared allows only system providers or already shared entries', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.setShared(6, true);

    expect(isNull).toHaveBeenCalledWith(emailProviders.userId);
    expect(or).toHaveBeenCalledWith({ op: 'isNull', value: emailProviders.userId }, { op: 'eq', left: emailProviders.isShared, right: true });
    expect(updateBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailProviders.id, right: 6 },
        {
          op: 'or',
          clauses: [
            { op: 'isNull', value: emailProviders.userId },
            { op: 'eq', left: emailProviders.isShared, right: true },
          ],
        },
      ],
    });
  });

  it('setSharedByOwner restricts by owner id', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.setSharedByOwner(6, 77, false);

    expect(updateBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailProviders.id, right: 6 },
        { op: 'eq', left: emailProviders.userId, right: 77 },
      ],
    });
    expect(updateBuilder.returning).toHaveBeenCalled();
  });

  it('delete removes only owner-owned provider', () => {
    const { db, deleteBuilder } = makeDb();
    const repo = new EmailProviderRepository(db as never);

    void repo.delete(6, 77);

    expect(db.delete).toHaveBeenCalledWith(emailProviders);
    expect(deleteBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailProviders.id, right: 6 },
        { op: 'eq', left: emailProviders.userId, right: 77 },
      ],
    });
    expect(deleteBuilder.returning).toHaveBeenCalled();
  });
});
