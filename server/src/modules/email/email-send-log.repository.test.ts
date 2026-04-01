vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { eq, sql } from 'drizzle-orm';

import { emailSendLog } from '../../db/schema';
import { EmailSendLogRepository } from './email-send-log.repository';

describe('EmailSendLogRepository', () => {
  const makeDb = () => {
    const selectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);
    selectBuilder.orderBy.mockReturnValue(selectBuilder);
    selectBuilder.limit.mockReturnValue(selectBuilder);

    const insertBuilder = { values: vi.fn(), returning: vi.fn() };
    insertBuilder.values.mockReturnValue(insertBuilder);

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

  it('insert and findById call the expected table operations', () => {
    const { db, insertBuilder, selectBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);

    void repo.insert({ userId: 1, status: 'pending' } as never);
    expect(db.insert).toHaveBeenCalledWith(emailSendLog);
    expect(insertBuilder.values).toHaveBeenCalledWith({ userId: 1, status: 'pending' });
    expect(insertBuilder.returning).toHaveBeenCalled();

    void repo.findById(22);
    expect(eq).toHaveBeenCalledWith(emailSendLog.id, 22);
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);
  });

  it('paginates user and admin listing with newest-first order', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);

    void repo.findForUser(9, 20, 40);
    expect(selectBuilder.where).toHaveBeenCalledWith({ op: 'eq', left: emailSendLog.userId, right: 9 });
    expect(selectBuilder.limit).toHaveBeenCalledWith(20);
    expect(selectBuilder.offset).toHaveBeenCalledWith(40);

    void repo.findAll(10, 0);
    expect(selectBuilder.offset).toHaveBeenLastCalledWith(0);
    expect(sql).toHaveBeenCalledWith(expect.any(Array), emailSendLog.createdAt);
  });

  it('findPending scopes to pending status', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);

    void repo.findPending();

    expect(eq).toHaveBeenCalledWith(emailSendLog.status, 'pending');
    expect(selectBuilder.where).toHaveBeenCalledWith({
      op: 'eq',
      left: emailSendLog.status,
      right: 'pending',
    });
  });

  it('markSent clears error fields and records sent timestamp', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);

    void repo.markSent(7);

    expect(db.update).toHaveBeenCalledWith(emailSendLog);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      status: 'sent',
      sentAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
      errorMessage: null,
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });
    expect(updateBuilder.where).toHaveBeenCalledWith({ op: 'eq', left: emailSendLog.id, right: 7 });
    expect(updateBuilder.returning).toHaveBeenCalled();
  });

  it('markFailed switches status based on retry scheduling', () => {
    const { db, updateBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);
    const retryAt = new Date('2026-03-31T12:05:00.000Z');

    void repo.markFailed(1, 'smtp timeout', retryAt);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      status: 'pending',
      errorMessage: 'smtp timeout',
      nextRetryAt: retryAt,
      attemptCount: expect.objectContaining({ op: 'sql' }),
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });

    void repo.markFailed(1, 'permanent', null);
    expect(updateBuilder.set).toHaveBeenLastCalledWith({
      status: 'failed',
      errorMessage: 'permanent',
      nextRetryAt: null,
      attemptCount: expect.objectContaining({ op: 'sql' }),
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });
  });

  it('markAbandoned and delete use strict row matching', () => {
    const { db, updateBuilder, deleteBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);

    void repo.markAbandoned(33);
    expect(updateBuilder.where).toHaveBeenCalledWith({ op: 'eq', left: emailSendLog.id, right: 33 });
    expect(updateBuilder.set).toHaveBeenCalledWith({
      status: 'failed',
      errorMessage: 'Server restarted before send completed. Use resend to retry.',
      nextRetryAt: null,
      updatedAt: expect.objectContaining({ op: 'sql', text: 'now()' }),
    });

    void repo.delete(33, 2);
    expect(deleteBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailSendLog.id, right: 33 },
        { op: 'eq', left: emailSendLog.userId, right: 2 },
      ],
    });
    expect(deleteBuilder.returning).toHaveBeenCalled();
  });
});
