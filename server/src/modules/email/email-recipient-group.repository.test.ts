vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({ op: 'inArray', left, values })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { eq, inArray, sql } from 'drizzle-orm';

import { emailRecipientGroupMembers, emailRecipientGroups, emailRecipients } from '../../db/schema';
import { EmailRecipientGroupRepository } from './email-recipient-group.repository';

describe('EmailRecipientGroupRepository', () => {
  const makeDb = () => {
    const selectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      innerJoin: vi.fn(),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);
    selectBuilder.innerJoin.mockReturnValue(selectBuilder);

    const insertBuilder = {
      values: vi.fn(),
      returning: vi.fn(),
      onConflictDoNothing: vi.fn(),
    };
    insertBuilder.values.mockReturnValue(insertBuilder);
    insertBuilder.onConflictDoNothing.mockReturnValue(insertBuilder);

    const updateBuilder = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);

    const deleteBuilder = { where: vi.fn(), returning: vi.fn() };
    deleteBuilder.where.mockReturnValue(deleteBuilder);

    return {
      selectBuilder,
      insertBuilder,
      updateBuilder,
      deleteBuilder,
      db: {
        select: vi.fn().mockReturnValue(selectBuilder),
        insert: vi.fn().mockReturnValue(insertBuilder),
        update: vi.fn().mockReturnValue(updateBuilder),
        delete: vi.fn().mockReturnValue(deleteBuilder),
      },
    };
  };

  it('findAllForUser scopes groups by owner and sorts by name', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailRecipientGroupRepository(db as never);

    void repo.findAllForUser(8);

    expect(selectBuilder.from).toHaveBeenCalledWith(emailRecipientGroups);
    expect(eq).toHaveBeenCalledWith(emailRecipientGroups.userId, 8);
    expect(selectBuilder.orderBy).toHaveBeenCalledWith(emailRecipientGroups.name);
  });

  it('findById fetches one row by id', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailRecipientGroupRepository(db as never);

    void repo.findById(10);

    expect(eq).toHaveBeenCalledWith(emailRecipientGroups.id, 10);
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);
  });

  it('findMembers joins recipients through group membership', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailRecipientGroupRepository(db as never);

    void repo.findMembers(12);

    expect(db.select).toHaveBeenCalledWith({ recipient: emailRecipients });
    expect(selectBuilder.from).toHaveBeenCalledWith(emailRecipientGroupMembers);
    expect(selectBuilder.innerJoin).toHaveBeenCalledWith(emailRecipients, {
      op: 'eq',
      left: emailRecipients.id,
      right: emailRecipientGroupMembers.recipientId,
    });
    expect(selectBuilder.where).toHaveBeenCalledWith({
      op: 'eq',
      left: emailRecipientGroupMembers.groupId,
      right: 12,
    });
  });

  it('findMembersForGroupIds batches membership lookup by group ids', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailRecipientGroupRepository(db as never);

    void repo.findMembersForGroupIds([1, 2]);

    expect(inArray).toHaveBeenCalledWith(emailRecipientGroupMembers.groupId, [1, 2]);
    expect(selectBuilder.where).toHaveBeenCalledWith({
      op: 'inArray',
      left: emailRecipientGroupMembers.groupId,
      values: [1, 2],
    });
  });

  it('insert/update/delete enforce owner scoping and return rows', () => {
    const { db, insertBuilder, updateBuilder, deleteBuilder } = makeDb();
    const repo = new EmailRecipientGroupRepository(db as never);

    void repo.insert({ userId: 8, name: 'Kobo' } as never);
    expect(insertBuilder.values).toHaveBeenCalledWith({ userId: 8, name: 'Kobo' });
    expect(insertBuilder.returning).toHaveBeenCalled();

    void repo.update(2, 8, { name: 'Updated' } as never);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      name: 'Updated',
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });
    expect(updateBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailRecipientGroups.id, right: 2 },
        { op: 'eq', left: emailRecipientGroups.userId, right: 8 },
      ],
    });

    void repo.delete(2, 8);
    expect(deleteBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailRecipientGroups.id, right: 2 },
        { op: 'eq', left: emailRecipientGroups.userId, right: 8 },
      ],
    });
    expect(deleteBuilder.returning).toHaveBeenCalled();
    expect(sql).toHaveBeenCalled();
  });

  it('addMember uses conflict-safe insert and removeMember deletes exact pair', () => {
    const { db, insertBuilder, deleteBuilder } = makeDb();
    const repo = new EmailRecipientGroupRepository(db as never);

    void repo.addMember(3, 4);
    expect(db.insert).toHaveBeenCalledWith(emailRecipientGroupMembers);
    expect(insertBuilder.values).toHaveBeenCalledWith({ groupId: 3, recipientId: 4 });
    expect(insertBuilder.onConflictDoNothing).toHaveBeenCalled();
    expect(insertBuilder.returning).toHaveBeenCalled();

    void repo.removeMember(3, 4);
    expect(db.delete).toHaveBeenCalledWith(emailRecipientGroupMembers);
    expect(deleteBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailRecipientGroupMembers.groupId, right: 3 },
        { op: 'eq', left: emailRecipientGroupMembers.recipientId, right: 4 },
      ],
    });
  });
});
