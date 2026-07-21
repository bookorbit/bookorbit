import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ReadingAttemptOrigin, ReadingAttemptOutcome, ReadStatus } from '@bookorbit/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadingAttemptService } from './reading-attempt.service';

type Row = {
  id: number;
  userId: number;
  bookId: number;
  startedOn: string | null;
  endedOn: string | null;
  outcome: ReadingAttemptOutcome | null;
  origin: ReadingAttemptOrigin;
  externalProvider: string | null;
  externalId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeFakeRepo() {
  const rows: Row[] = [];
  let nextId = 1;
  const projections: Array<{ status: ReadStatus }> = [];
  const repo = {
    transaction: vi.fn((callback: (tx: object) => Promise<unknown>) => callback({})),
    findActive: vi.fn((_tx: object, userId: number, bookId: number) =>
      Promise.resolve(rows.find((row) => row.userId === userId && row.bookId === bookId && row.outcome === null && row.deletedAt === null)),
    ),
    findLatest: vi.fn((_tx: object, userId: number, bookId: number) =>
      Promise.resolve([...rows].reverse().find((row) => row.userId === userId && row.bookId === bookId && row.deletedAt === null)),
    ),
    hasCompleted: vi.fn((_tx: object, userId: number, bookId: number) =>
      Promise.resolve(rows.some((row) => row.userId === userId && row.bookId === bookId && row.outcome === 'completed' && row.deletedAt === null)),
    ),
    create: vi.fn(
      (
        _tx: object,
        values: Omit<Row, 'id' | 'deletedAt' | 'createdAt' | 'updatedAt' | 'externalProvider' | 'externalId'> & {
          externalProvider?: string | null;
          externalId?: string | null;
        },
      ) => {
        const now = new Date('2026-07-12T12:00:00.000Z');
        const row: Row = {
          ...values,
          id: nextId++,
          externalProvider: values.externalProvider ?? null,
          externalId: values.externalId ?? null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(row);
        return Promise.resolve(row);
      },
    ),
    createActive: vi.fn(
      (
        _tx: object,
        values: Omit<Row, 'id' | 'deletedAt' | 'createdAt' | 'updatedAt' | 'externalProvider' | 'externalId' | 'endedOn' | 'outcome'> & {
          externalProvider?: string | null;
          externalId?: string | null;
        },
      ) => {
        const existing = rows.find(
          (row) => row.userId === values.userId && row.bookId === values.bookId && row.outcome === null && row.deletedAt === null,
        );
        if (existing) return Promise.resolve(existing);
        return repo.create(_tx, { ...values, endedOn: null, outcome: null });
      },
    ),
    update: vi.fn((_tx: object, userId: number, bookId: number, id: number, patch: Partial<Row>) => {
      const row = rows.find((item) => item.id === id && item.userId === userId && item.bookId === bookId && item.deletedAt === null);
      if (!row) return Promise.resolve(null);
      Object.assign(row, patch, { updatedAt: new Date('2026-07-12T12:00:00.000Z') });
      return Promise.resolve(row);
    }),
    project: vi.fn((_tx: object, _userId: number, _bookId: number, projection: { status: ReadStatus }) => {
      projections.push(projection);
      return Promise.resolve();
    }),
    findStatus: vi.fn(() => Promise.resolve(null)),
    findByExternal: vi.fn((_tx: object, userId: number, provider: string, externalId: string) =>
      Promise.resolve(rows.find((row) => row.userId === userId && row.externalProvider === provider && row.externalId === externalId)),
    ),
    findOwned: vi.fn((userId: number, bookId: number, id: number) =>
      Promise.resolve(rows.find((row) => row.id === id && row.userId === userId && row.bookId === bookId && row.deletedAt === null)),
    ),
    softDelete: vi.fn((userId: number, bookId: number, id: number) => {
      const row = rows.find((item) => item.id === id && item.userId === userId && item.bookId === bookId && item.deletedAt === null);
      if (!row) return Promise.resolve(false);
      row.deletedAt = new Date();
      return Promise.resolve(true);
    }),
    list: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  };
  return { repo, rows, projections };
}

describe('ReadingAttemptService', () => {
  let fake: ReturnType<typeof makeFakeRepo>;
  let service: ReadingAttemptService;

  beforeEach(() => {
    fake = makeFakeRepo();
    service = new ReadingAttemptService(fake.repo as never);
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

  it('keeps repeated manual read operations idempotent', async () => {
    const first = await service.applyManualStatus(1, 10, 'read', '2026-01-01', '2026-01-10', '2026-07-12');
    const second = await service.applyManualStatus(1, 10, 'read', undefined, undefined, '2026-07-12');
    expect(fake.rows).toHaveLength(1);
    expect(first.status).toBe('read');
    expect(second.status).toBe('read');
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
});
