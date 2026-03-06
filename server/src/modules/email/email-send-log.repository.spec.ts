jest.mock('drizzle-orm', () => ({
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  lte: jest.fn((left: unknown, right: unknown) => ({ op: 'lte', left, right })),
  sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { and, eq, lte, sql } from 'drizzle-orm';

import { emailSendLog } from '../../db/schema';
import { EmailSendLogRepository } from './email-send-log.repository';

describe('EmailSendLogRepository', () => {
  const makeDb = () => {
    const selectBuilder = {
      from: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      offset: jest.fn(),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);
    selectBuilder.orderBy.mockReturnValue(selectBuilder);
    selectBuilder.limit.mockReturnValue(selectBuilder);

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

  it('findPendingRetries enforces pending status and retry time cutoff', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);
    const now = new Date('2026-03-31T12:00:00.000Z');

    void repo.findPendingRetries(now);

    expect(eq).toHaveBeenCalledWith(emailSendLog.status, 'pending');
    expect(lte).toHaveBeenCalledWith(emailSendLog.nextRetryAt, now);
    expect(and).toHaveBeenCalledWith(
      { op: 'eq', left: emailSendLog.status, right: 'pending' },
      { op: 'lte', left: emailSendLog.nextRetryAt, right: now },
    );
    expect(selectBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailSendLog.status, right: 'pending' },
        { op: 'lte', left: emailSendLog.nextRetryAt, right: now },
      ],
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
