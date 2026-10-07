import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReadingAttemptService } from './reading-attempt.service';
import { ReadingAttemptEventsService } from './reading-attempt-events.service';
import { makeFakeRepo } from '../../../test/helpers/reading-attempt-repository.fake';

describe('ReadingAttemptService', () => {
  let fake: ReturnType<typeof makeFakeRepo>;
  let service: ReadingAttemptService;

  beforeEach(() => {
    fake = makeFakeRepo();
    service = new ReadingAttemptService(fake.repo as never, new ReadingAttemptEventsService());
  });

  it('creates a placeholder completion before a legacy manual reread', async () => {
    const result = await service.applyManualStatus(1, 10, 'rereading', undefined, undefined, '2026-07-12');

    expect(fake.rows).toHaveLength(2);
    expect(fake.rows[0]).toMatchObject({ outcome: 'completed', startedOn: null, endedOn: null, origin: 'migration' });
    expect(fake.rows[1]).toMatchObject({ outcome: null, startedOn: '2026-07-12', origin: 'manual' });
    expect(result.status).toBe('rereading');
  });

  it('does not create a reread from weak activity after completion', async () => {
    await fake.repo.create(
      {},
      {
        userId: 1,
        bookId: 10,
        startedOn: '2025-01-01',
        endedOn: '2025-01-10',
        outcome: 'completed',
        origin: 'manual',
      },
    );

    await expect(
      service.recordActivity({
        userId: 1,
        bookId: 10,
        occurredOn: '2026-07-12',
        origin: 'kobo',
        progress: 25,
        finishThreshold: 98,
        strongRereadEvidence: false,
        meaningfulActivity: false,
      }),
    ).resolves.toBeNull();
    expect(fake.rows).toHaveLength(1);
  });

  it('opens a reread from a strong Kobo transition', async () => {
    await fake.repo.create(
      {},
      {
        userId: 1,
        bookId: 10,
        startedOn: '2025-01-01',
        endedOn: '2025-01-10',
        outcome: 'completed',
        origin: 'manual',
      },
    );

    const result = await service.recordActivity({
      userId: 1,
      bookId: 10,
      occurredOn: '2026-07-12',
      origin: 'kobo',
      progress: 25,
      finishThreshold: 98,
      strongRereadEvidence: true,
      meaningfulActivity: false,
    });

    expect(result?.status).toBe('rereading');
    expect(fake.rows[1]).toMatchObject({ startedOn: '2026-07-12', outcome: null, origin: 'kobo' });
    expect(fake.projections.at(-1)?.status).toBe('rereading');
  });

  it('records a same-day completion when a strong reread signal first arrives at the finish threshold', async () => {
    await fake.repo.create(
      {},
      {
        userId: 1,
        bookId: 10,
        startedOn: '2025-01-01',
        endedOn: '2025-01-10',
        outcome: 'completed',
        origin: 'manual',
      },
    );

    const result = await service.recordActivity({
      userId: 1,
      bookId: 10,
      occurredOn: '2026-07-12',
      origin: 'kobo',
      progress: 99,
      finishThreshold: 98,
      strongRereadEvidence: true,
      meaningfulActivity: false,
    });

    expect(result?.status).toBe('read');
    expect(fake.rows).toHaveLength(2);
    expect(fake.rows[1]).toMatchObject({ startedOn: '2026-07-12', endedOn: '2026-07-12', outcome: 'completed' });
  });

  it('completes the active attempt without creating a duplicate', async () => {
    await fake.repo.create(
      {},
      {
        userId: 1,
        bookId: 10,
        startedOn: '2026-07-01',
        endedOn: null,
        outcome: null,
        origin: 'bookorbit',
      },
    );

    const result = await service.recordActivity({
      userId: 1,
      bookId: 10,
      occurredOn: '2026-07-12',
      origin: 'bookorbit',
      progress: 99,
      finishThreshold: 98,
      strongRereadEvidence: false,
      meaningfulActivity: true,
    });

    expect(result?.status).toBe('read');
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ outcome: 'completed', endedOn: '2026-07-12' });
  });

  it.each([
    { progress: 99.94, expectedStatus: 'reading', expectedOutcome: null },
    { progress: Math.fround(99.95), expectedStatus: 'read', expectedOutcome: 'completed' },
  ])('uses a fractional finish threshold at $progress% progress', async ({ progress, expectedStatus, expectedOutcome }) => {
    const result = await service.recordActivity({
      userId: 1,
      bookId: 10,
      occurredOn: '2026-07-12',
      origin: 'bookorbit',
      progress,
      finishThreshold: 99.95,
      strongRereadEvidence: false,
      meaningfulActivity: true,
    });

    expect(result?.status).toBe(expectedStatus);
    expect(fake.rows[0]?.outcome).toBe(expectedOutcome);
  });

  it('keeps repeated manual read operations idempotent', async () => {
    const first = await service.applyManualStatus(1, 10, 'read', '2026-01-01', '2026-01-10', '2026-07-12');
    const second = await service.applyManualStatus(1, 10, 'read', undefined, undefined, '2026-07-12');
    expect(fake.rows).toHaveLength(1);
    expect(first.status).toBe('read');
    expect(second.status).toBe('read');
  });

  describe('manual lifecycle dates without an explicit status', () => {
    it.each(['unread', 'want_to_read'] as const)('opens a reading attempt when a start date is set from %s', async (status) => {
      const result = await service.applyManualStatus(1, 10, status, '2026-01-10', undefined, '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-01-10', endedOn: null, outcome: null, origin: 'manual' });
      expect(result).toMatchObject({ status: 'reading', startedAt: '2026-01-10', finishedAt: null });
      expect(fake.projections.at(-1)).toMatchObject({ status: 'reading', startedAt: new Date('2026-01-10T00:00:00.000Z'), finishedAt: null });
    });

    it('creates a completed attempt when both dates are set on an unread book', async () => {
      const result = await service.applyManualStatus(1, 10, 'unread', '2026-01-10', '2026-02-01', '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-01-10', endedOn: '2026-02-01', outcome: 'completed', origin: 'manual' });
      expect(result).toMatchObject({ status: 'read', startedAt: '2026-01-10', finishedAt: '2026-02-01' });
    });

    it('creates a completed attempt with an unknown start when only a finish date is set', async () => {
      const result = await service.applyManualStatus(1, 10, 'unread', undefined, '2026-02-01', '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0]).toMatchObject({ startedOn: null, endedOn: '2026-02-01', outcome: 'completed' });
      expect(result).toMatchObject({ status: 'read', startedAt: null, finishedAt: '2026-02-01' });
    });

    it.each(['reading', 'rereading', 'on_hold'] as const)('completes an active %s attempt when a finish date is set', async (status) => {
      if (status === 'rereading') {
        await fake.repo.create(
          {},
          {
            userId: 1,
            bookId: 10,
            startedOn: '2025-01-01',
            endedOn: '2025-01-10',
            outcome: 'completed',
            origin: 'manual',
          },
        );
      }
      await fake.repo.createActive({}, { userId: 1, bookId: 10, startedOn: '2026-01-10', origin: 'manual' });

      const result = await service.applyManualStatus(1, 10, status, undefined, '2026-02-01', '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows.at(-1)).toMatchObject({ startedOn: '2026-01-10', endedOn: '2026-02-01', outcome: 'completed' });
      expect(result).toMatchObject({ status: 'read', startedAt: '2026-01-10', finishedAt: '2026-02-01' });
      expect(fake.projections.at(-1)?.status).toBe('read');
    });

    it('clears a completed attempt finish date without reopening it', async () => {
      await fake.repo.create(
        {},
        {
          userId: 1,
          bookId: 10,
          startedOn: '2026-01-10',
          endedOn: '2026-02-01',
          outcome: 'completed',
          origin: 'manual',
        },
      );

      const result = await service.applyManualStatus(1, 10, 'read', undefined, null, '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows[0]).toMatchObject({ endedOn: null, outcome: 'completed' });
      expect(result).toMatchObject({ status: 'read', startedAt: '2026-01-10', finishedAt: null });
      expect(fake.rows.filter((row) => row.outcome === null)).toHaveLength(0);
    });

    it('edits the start date of the latest completed attempt without reopening it', async () => {
      await fake.repo.create(
        {},
        {
          userId: 1,
          bookId: 10,
          startedOn: '2026-01-10',
          endedOn: '2026-02-01',
          outcome: 'completed',
          origin: 'manual',
        },
      );

      const result = await service.applyManualStatus(1, 10, 'read', '2026-01-05', undefined, '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-01-05', endedOn: '2026-02-01', outcome: 'completed' });
      expect(result).toMatchObject({ status: 'read', startedAt: '2026-01-05', finishedAt: '2026-02-01' });
    });

    it('treats clearing absent dates without an attempt as a no-op', async () => {
      const result = await service.applyManualStatus(1, 10, 'unread', null, null, '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows).toHaveLength(0);
      expect(fake.repo.create).not.toHaveBeenCalled();
      expect(fake.repo.createActive).not.toHaveBeenCalled();
      expect(fake.repo.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'unread', startedAt: null, finishedAt: null });
    });

    it('validates the resolved attempt before changing an existing date', async () => {
      await fake.repo.create(
        {},
        {
          userId: 1,
          bookId: 10,
          startedOn: '2026-01-10',
          endedOn: '2026-02-01',
          outcome: 'completed',
          origin: 'manual',
        },
      );

      await expect(
        service.applyManualStatus(1, 10, 'read', '2026-02-02', undefined, '2026-07-12', { statusWasExplicit: false }),
      ).rejects.toMatchObject({ response: { errorCode: 'READING_DATES_INVALID_ORDER' } });
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-01-10', endedOn: '2026-02-01', outcome: 'completed' });
      expect(fake.repo.update).not.toHaveBeenCalled();
    });

    it('rejects an explicit active status combined with a finish date before writing', async () => {
      await expect(service.applyManualStatus(1, 10, 'reading', '2026-01-10', '2026-02-01', '2026-07-12')).rejects.toMatchObject({
        response: { errorCode: 'READING_DATES_STATUS_CONFLICT' },
      });

      expect(fake.rows).toHaveLength(0);
    });

    it('creates one completed attempt for an explicit read status with both dates', async () => {
      const result = await service.applyManualStatus(1, 10, 'read', '2026-01-10', '2026-02-01', '2026-07-12');

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-01-10', endedOn: '2026-02-01', outcome: 'completed' });
      expect(result).toMatchObject({ status: 'read', startedAt: '2026-01-10', finishedAt: '2026-02-01' });
    });

    it('completes an abandoned attempt when a finish date is set', async () => {
      await fake.repo.create({}, { userId: 1, bookId: 10, startedOn: '2026-01-10', endedOn: '2026-01-20', outcome: 'abandoned', origin: 'manual' });

      const result = await service.applyManualStatus(1, 10, 'abandoned', undefined, '2026-02-01', '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-01-10', endedOn: '2026-02-01', outcome: 'completed' });
      expect(result).toMatchObject({ status: 'read', startedAt: '2026-01-10', finishedAt: '2026-02-01' });
    });

    it('mutates and projects in one repository transaction', async () => {
      await service.applyManualStatus(1, 10, 'unread', '2026-01-10', '2026-02-01', '2026-07-12', {
        statusWasExplicit: false,
      });

      expect(fake.repo.transaction).toHaveBeenCalledOnce();
      expect(fake.repo.create).toHaveBeenCalledWith(fake.transactionContext, expect.any(Object));
      expect(fake.repo.project).toHaveBeenCalledWith(fake.transactionContext, 1, 10, expect.objectContaining({ status: 'read' }));
    });
  });

  describe('lifecycle-clearing projections', () => {
    it.each(['unread', 'want_to_read'] as const)('keeps %s free of lifecycle dates it cannot own', async (status) => {
      await service.applyManualStatus(1, 10, 'read', '2026-01-10', '2026-02-01', '2026-07-12');

      const result = await service.applyManualStatus(1, 10, status, undefined, undefined, '2026-07-12');

      expect(result).toMatchObject({ status, startedAt: null, finishedAt: null });
      expect(fake.projections.at(-1)).toMatchObject({ status, startedAt: null, finishedAt: null });
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-01-10', endedOn: '2026-02-01', outcome: 'completed' });
    });

    it('does not project a historical attempt onto a book the reader marked unread', async () => {
      fake.repo.findStatus.mockResolvedValue({ status: 'unread' });

      await service.createHistorical(1, 10, { startedOn: '2026-01-10', endedOn: '2026-02-01', outcome: 'completed' });

      expect(fake.projections.at(-1)).toMatchObject({ status: 'unread', startedAt: null, finishedAt: null });
    });
  });

  it('edits the latest completed dates without creating another completion', async () => {
    await service.applyManualStatus(1, 10, 'read', '2026-01-01', '2026-01-10', '2026-07-12');
    const result = await service.applyManualStatus(1, 10, 'read', undefined, '2026-01-12', '2026-07-12');

    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]?.endedOn).toBe('2026-01-12');
    expect(result.finishedAt).toBe('2026-01-12');
  });

  it('keeps an active reread on hold without changing it to rereading', async () => {
    await service.applyManualStatus(1, 10, 'read', '2025-01-01', '2025-01-10', '2026-07-12');
    await service.applyManualStatus(1, 10, 'rereading', undefined, undefined, '2026-07-12');
    const result = await service.applyManualStatus(1, 10, 'on_hold', undefined, undefined, '2026-07-12');
    expect(result.status).toBe('on_hold');
  });

  it('rejects an end date before the start date', async () => {
    await expect(service.createHistorical(1, 10, { startedOn: '2026-07-12', endedOn: '2026-07-01', outcome: 'completed' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns not found when deleting an inaccessible attempt', async () => {
    await expect(service.delete(1, 10, 999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not resurrect a tombstoned Hardcover read', async () => {
    const row = await fake.repo.create(
      {},
      {
        userId: 1,
        bookId: 10,
        startedOn: '2025-01-01',
        endedOn: '2025-01-10',
        outcome: 'completed',
        origin: 'hardcover',
        externalProvider: 'hardcover',
        externalId: '77',
      },
    );
    row.deletedAt = new Date();

    await service.importExternalRead(1, 10, {
      provider: 'hardcover',
      externalId: '77',
      startedOn: '2025-01-01',
      endedOn: '2025-01-11',
    });

    expect(row.endedOn).toBe('2025-01-10');
  });

  describe('closing an attempt that a skewed device clock started in the future', () => {
    it('ends a completed attempt on its own start date instead of an earlier today', async () => {
      const active = await fake.repo.createActive({}, { userId: 1, bookId: 10, startedOn: '2026-11-01', origin: 'kobo' });

      const result = await service.applyManualStatus(1, 10, 'read', undefined, undefined, '2026-07-12');

      expect(active.endedOn).toBe('2026-11-01');
      expect(active.outcome).toBe('completed');
      expect(result.status).toBe('read');
    });

    it('ends an implicitly abandoned attempt on its own start date', async () => {
      const active = await fake.repo.createActive({}, { userId: 1, bookId: 10, startedOn: '2026-11-01', origin: 'kobo' });

      await service.applyManualStatus(1, 10, 'unread', undefined, undefined, '2026-07-12');

      expect(active.endedOn).toBe('2026-11-01');
      expect(active.outcome).toBe('abandoned');
    });

    it('ends a newly created closed attempt on its own start date', async () => {
      await service.applyManualStatus(1, 10, 'read', '2026-11-01', undefined, '2026-07-12');

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0]).toMatchObject({ startedOn: '2026-11-01', endedOn: '2026-11-01', outcome: 'completed' });
    });

    it('ends an automatic completion on its own start date', async () => {
      const active = await fake.repo.createActive({}, { userId: 1, bookId: 10, startedOn: '2026-11-01', origin: 'kobo' });

      const result = await service.recordActivity({
        userId: 1,
        bookId: 10,
        occurredOn: '2026-07-12',
        origin: 'kobo',
        progress: 100,
        finishThreshold: 98,
        strongRereadEvidence: false,
        meaningfulActivity: true,
      });

      expect(active.endedOn).toBe('2026-11-01');
      expect(active.outcome).toBe('completed');
      expect(result?.status).toBe('read');
    });

    it('still ends on today when the attempt started in the past', async () => {
      const active = await fake.repo.createActive({}, { userId: 1, bookId: 10, startedOn: '2026-01-05', origin: 'kobo' });

      await service.applyManualStatus(1, 10, 'read', undefined, undefined, '2026-07-12');

      expect(active.endedOn).toBe('2026-07-12');
    });

    it('rejects an explicitly supplied end date before the active start date', async () => {
      const active = await fake.repo.createActive({}, { userId: 1, bookId: 10, startedOn: '2026-11-01', origin: 'kobo' });

      await expect(service.applyManualStatus(1, 10, 'read', undefined, '2026-07-12', '2026-07-12')).rejects.toBeInstanceOf(BadRequestException);

      expect(active).toMatchObject({ startedOn: '2026-11-01', endedOn: null, outcome: null });
      expect(fake.repo.update).not.toHaveBeenCalled();
    });
  });
});
