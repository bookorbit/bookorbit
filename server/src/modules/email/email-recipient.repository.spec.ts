jest.mock('drizzle-orm', () => ({
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
}));

import { and, eq } from 'drizzle-orm';

import { emailRecipients } from '../../db/schema';
import { EmailRecipientRepository } from './email-recipient.repository';

describe('EmailRecipientRepository', () => {
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
    insertBuilder.returning.mockResolvedValue([]);

    const updateBuilder = { set: jest.fn(), where: jest.fn(), returning: jest.fn() };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    updateBuilder.returning.mockResolvedValue([]);

    const deleteBuilder = { where: jest.fn(), returning: jest.fn() };
    deleteBuilder.where.mockReturnValue(deleteBuilder);
    deleteBuilder.returning.mockResolvedValue([]);

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

  it('filters list queries by owner and sorts by name', () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.orderBy.mockResolvedValue([{ id: 1 }]);

    const repo = new EmailRecipientRepository(db as never);

    void repo.findAllForUser(5);

    expect(eq).toHaveBeenCalledWith(emailRecipients.userId, 5);
    expect(selectBuilder.where).toHaveBeenCalledWith({ op: 'eq', left: emailRecipients.userId, right: 5 });
    expect(selectBuilder.orderBy).toHaveBeenCalledWith(emailRecipients.name);
  });

  it('findById limits to one result', () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.limit.mockResolvedValue([{ id: 99 }]);

    const repo = new EmailRecipientRepository(db as never);

    void repo.findById(99);

    expect(eq).toHaveBeenCalledWith(emailRecipients.id, 99);
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);
  });

  it('inserts provided values and returns inserted rows', async () => {
    const { db, insertBuilder } = makeDb();
    const inserted = [{ id: 7 }];
    insertBuilder.returning.mockResolvedValue(inserted);
    const repo = new EmailRecipientRepository(db as never);

    const payload = { userId: 1, name: 'Kindle', email: 'kindle@example.com', isDefault: false };
    const result = repo.insert(payload as never);

    expect(db.insert).toHaveBeenCalledWith(emailRecipients);
    expect(insertBuilder.values).toHaveBeenCalledWith(payload);
    expect(insertBuilder.returning).toHaveBeenCalled();
    await expect(result).resolves.toBe(inserted);
  });

  it('updates only when id and owner both match', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailRecipientRepository(db as never);

    void repo.update(2, 10, { preferredFormat: 'mobi' } as never);

    expect(db.update).toHaveBeenCalledWith(emailRecipients);
    expect(updateBuilder.set).toHaveBeenCalledWith({ preferredFormat: 'mobi' });
    expect(eq).toHaveBeenCalledWith(emailRecipients.id, 2);
    expect(eq).toHaveBeenCalledWith(emailRecipients.userId, 10);
    expect(and).toHaveBeenCalledWith({ op: 'eq', left: emailRecipients.id, right: 2 }, { op: 'eq', left: emailRecipients.userId, right: 10 });
    expect(updateBuilder.returning).toHaveBeenCalled();
  });

  it('clears default recipient only for the owner', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailRecipientRepository(db as never);

    void repo.clearDefault(3);

    expect(db.update).toHaveBeenCalledWith(emailRecipients);
    expect(updateBuilder.set).toHaveBeenCalledWith({ isDefault: false });
    expect(eq).toHaveBeenCalledWith(emailRecipients.userId, 3);
    expect(eq).toHaveBeenCalledWith(emailRecipients.isDefault, true);
    expect(updateBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailRecipients.userId, right: 3 },
        { op: 'eq', left: emailRecipients.isDefault, right: true },
      ],
    });
  });

  it('sets default recipient only for the owner and returns row', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailRecipientRepository(db as never);

    void repo.setDefault(11, 3);

    expect(db.update).toHaveBeenCalledWith(emailRecipients);
    expect(updateBuilder.set).toHaveBeenCalledWith({ isDefault: true });
    expect(updateBuilder.returning).toHaveBeenCalled();
  });

  it('deletes only matching owner rows', () => {
    const { db, deleteBuilder } = makeDb();
    const repo = new EmailRecipientRepository(db as never);

    void repo.delete(11, 3);

    expect(db.delete).toHaveBeenCalledWith(emailRecipients);
    expect(deleteBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailRecipients.id, right: 11 },
        { op: 'eq', left: emailRecipients.userId, right: 3 },
      ],
    });
    expect(deleteBuilder.returning).toHaveBeenCalled();
  });
});
