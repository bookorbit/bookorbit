vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  gt: vi.fn((left: unknown, right: unknown) => ({ op: 'gt', left, right })),
  gte: vi.fn((left: unknown, right: unknown) => ({ op: 'gte', left, right })),
  desc: vi.fn((column: unknown) => ({ op: 'desc', column })),
  count: vi.fn((expression?: unknown) => ({ op: 'count', expression })),
  getTableColumns: vi.fn(() => ({ id: 'id-column' })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { eq, sql } from 'drizzle-orm';

import { bookFiles, bookMetadata, emailSendLog } from '../../db/schema';
import { EmailSendLogRepository } from './email-send-log.repository';

describe('EmailSendLogRepository', () => {
  const makeDb = () => {
    const selectBuilder = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.leftJoin.mockReturnValue(selectBuilder);
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
    expect(selectBuilder.where).toHaveBeenCalledWith({ op: 'and', clauses: [{ op: 'eq', left: emailSendLog.userId, right: 9 }] });
    expect(selectBuilder.limit).toHaveBeenCalledWith(20);
    expect(selectBuilder.offset).toHaveBeenCalledWith(40);

    // The book filter is additive: ownership still constrains the query, so one user cannot read
    // another's sends by naming a book id.
    void repo.findForUser(9, 20, 0, { bookId: 965 });
    expect(selectBuilder.where).toHaveBeenLastCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailSendLog.userId, right: 9 },
        { op: 'eq', left: emailSendLog.bookId, right: 965 },
      ],
    });

    void repo.findForUser(9, 20, 0, { status: 'failed' });
    expect(selectBuilder.where).toHaveBeenLastCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailSendLog.userId, right: 9 },
        { op: 'eq', left: emailSendLog.status, right: 'failed' },
      ],
    });

    void repo.findAll(10, 0);
    expect(selectBuilder.offset).toHaveBeenLastCalledWith(0);
    expect(sql).toHaveBeenCalledWith(expect.any(Array), emailSendLog.createdAt);
  });

  it('joins the book title and the sent file onto user rows', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);

    void repo.findForUser(9, 20, 0);

    expect(db.select).toHaveBeenCalledWith(
      expect.objectContaining({ bookTitle: bookMetadata.title, fileFormat: bookFiles.format, fileSizeBytes: bookFiles.sizeBytes }),
    );
    expect(selectBuilder.leftJoin).toHaveBeenCalledWith(bookMetadata, { op: 'eq', left: bookMetadata.bookId, right: emailSendLog.bookId });
    expect(selectBuilder.leftJoin).toHaveBeenCalledWith(bookFiles, { op: 'eq', left: bookFiles.id, right: emailSendLog.bookFileId });
  });

  it('finds failures since a moment, scoped to the user, skipping any a later send replaced', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);
    const since = new Date('2026-10-05T20:00:00Z');

    void repo.findUnresolvedFailures(9, since, 20);

    const where = selectBuilder.where.mock.lastCall?.[0] as { op: string; clauses: Array<Record<string, unknown>> };
    expect(where.op).toBe('and');
    expect(where.clauses.slice(0, 3)).toEqual([
      { op: 'eq', left: emailSendLog.userId, right: 9 },
      { op: 'eq', left: emailSendLog.status, right: 'failed' },
      { op: 'gte', left: emailSendLog.createdAt, right: since },
    ]);
    expect(String(where.clauses[3].text)).toContain('not exists');
    expect(String(where.clauses[3].text)).toContain('later.created_at >');
    expect(selectBuilder.limit).toHaveBeenLastCalledWith(20);
  });

  it('findPending scopes to pending status', () => {
    const { db, selectBuilder } = makeDb();
    const repo = new EmailSendLogRepository(db as never);

    void repo.findPending();

    expect(eq).toHaveBeenCalledWith(emailSendLog.status, 'pending');
    expect(selectBuilder.limit).toHaveBeenCalledWith(100);
    expect(selectBuilder.where).toHaveBeenCalledWith({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailSendLog.status, right: 'pending' },
        { op: 'gt', left: emailSendLog.id, right: 0 },
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
      errorMessage: 'Server restarted before send completed. SMTP acceptance may be unknown. Review before resending.',
      failureCode: 'SEND_INTERRUPTED',
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
