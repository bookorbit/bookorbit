jest.mock('drizzle-orm', () => ({
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  isNull: jest.fn((value: unknown) => ({ op: 'isNull', value })),
  or: jest.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { emailTemplates } from '../../db/schema';
import { EmailTemplateRepository } from './email-template.repository';

describe('EmailTemplateRepository', () => {
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

  it('findAllForUser returns owner + system templates sorted by name', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailTemplateRepository(db as never);

    void repo.findAllForUser(3);

    expect(eq).toHaveBeenCalledWith(emailTemplates.userId, 3);
    expect(isNull).toHaveBeenCalledWith(emailTemplates.userId);
    expect(or).toHaveBeenCalledWith({ op: 'eq', left: emailTemplates.userId, right: 3 }, { op: 'isNull', value: emailTemplates.userId });
    expect(selectBuilder.orderBy).toHaveBeenCalledWith(emailTemplates.name);
  });

  it('findById and findUserDefault both limit to one row', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailTemplateRepository(db as never);

    void repo.findById(8);
    expect(eq).toHaveBeenCalledWith(emailTemplates.id, 8);
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);

    void repo.findUserDefault(3);
    expect(and).toHaveBeenCalledWith({ op: 'eq', left: emailTemplates.userId, right: 3 }, { op: 'eq', left: emailTemplates.isDefault, right: true });
    expect(selectBuilder.limit).toHaveBeenLastCalledWith(1);
  });

  it('findSystemDefault looks for system-owned system templates', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailTemplateRepository(db as never);

    void repo.findSystemDefault();

    expect(and).toHaveBeenCalledWith({ op: 'isNull', value: emailTemplates.userId }, { op: 'eq', left: emailTemplates.isSystem, right: true });
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);
  });

  it('insert/update/updateById set expected table mutations', () => {
    const { db, insertBuilder, updateBuilder } = makeDb();
    const repo = new EmailTemplateRepository(db as never);

    void repo.insert({ name: 'Template', subject: 'Subject', bodyText: 'Body' } as never);
    expect(db.insert).toHaveBeenCalledWith(emailTemplates);
    expect(insertBuilder.values).toHaveBeenCalledWith({ name: 'Template', subject: 'Subject', bodyText: 'Body' });
    expect(insertBuilder.returning).toHaveBeenCalled();

    void repo.update(10, 3, { subject: 'Updated' } as never);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      subject: 'Updated',
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });
    expect(updateBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailTemplates.id, right: 10 },
        { op: 'eq', left: emailTemplates.userId, right: 3 },
      ],
    });

    void repo.updateById(11, { isSystem: true } as never);
    expect(updateBuilder.where).toHaveBeenLastCalledWith({
      op: 'eq',
      left: emailTemplates.id,
      right: 11,
    });
    expect(sql).toHaveBeenCalled();
  });

  it('clearDefault/setDefault/delete preserve owner boundaries', () => {
    const { db, updateBuilder, deleteBuilder } = makeDb();
    const repo = new EmailTemplateRepository(db as never);

    void repo.clearDefault(4);
    expect(updateBuilder.set).toHaveBeenCalledWith({ isDefault: false });
    expect(updateBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailTemplates.userId, right: 4 },
        { op: 'eq', left: emailTemplates.isDefault, right: true },
      ],
    });

    void repo.setDefault(22, 4);
    expect(updateBuilder.set).toHaveBeenLastCalledWith({
      isDefault: true,
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });
    expect(updateBuilder.where).toHaveBeenLastCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailTemplates.id, right: 22 },
        { op: 'eq', left: emailTemplates.userId, right: 4 },
      ],
    });

    void repo.delete(22, 4);
    expect(deleteBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailTemplates.id, right: 22 },
        { op: 'eq', left: emailTemplates.userId, right: 4 },
      ],
    });
    expect(deleteBuilder.returning).toHaveBeenCalled();
  });
});
