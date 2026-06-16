import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { ReadingSessionRepository, type SaveReadingSessionResult } from './reading-session.repository';
import { ReadingSessionService } from './reading-session.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 7,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

const mockRepo = {
  saveSession:
    vi.fn<(...args: [number, number, string, Date, Date, number, number | null, number | null, string]) => Promise<SaveReadingSessionResult>>(),
};

const mockBookService = {
  verifyFileAccess: vi.fn<(...args: [number, RequestUser]) => Promise<void>>(),
};

describe('ReadingSessionService', () => {
  let service: ReadingSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.saveSession.mockResolvedValue({ kind: 'saved' });
    mockBookService.verifyFileAccess.mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new ReadingSessionService(
      mockRepo as unknown as ReadingSessionRepository,
      mockBookService as unknown as BookService,
      { emit: vi.fn() } as never,
    );
  });

  it('verifies access and persists a session with wall-clock clamped duration', async () => {
    await service.save(
      42,
      {
        sessionId: 'session-1',
        startedAt: '2026-04-15T10:00:00.000Z',
        endedAt: '2026-04-15T10:02:00.000Z',
        durationSeconds: 999,
        progressDelta: 2.5,
        endProgress: 10,
      },
      makeUser({ id: 12 }),
    );

    expect(mockBookService.verifyFileAccess).toHaveBeenCalledWith(42, expect.objectContaining({ id: 12 }));
    expect(mockRepo.saveSession).toHaveBeenCalledWith(
      12,
      42,
      'session-1',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:02:00.000Z'),
      120,
      2.5,
      10,
      'web',
    );
  });

  it('passes nullable progress values through as null', async () => {
    await service.save(
      42,
      {
        sessionId: 'session-2',
        startedAt: '2026-04-15T10:00:00.000Z',
        endedAt: '2026-04-15T10:00:30.000Z',
        durationSeconds: 30,
        progressDelta: null,
        endProgress: null,
      },
      makeUser({ id: 21 }),
    );

    expect(mockRepo.saveSession).toHaveBeenCalledWith(
      21,
      42,
      'session-2',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:00:30.000Z'),
      30,
      null,
      null,
      'web',
    );
  });

  it('threads an explicit source through to the repository', async () => {
    await service.save(
      42,
      {
        sessionId: 'session-kobo',
        startedAt: '2026-04-15T10:00:00.000Z',
        endedAt: '2026-04-15T10:02:00.000Z',
        durationSeconds: 120,
        progressDelta: 5,
        endProgress: 20,
      },
      makeUser({ id: 7 }),
      'kobo',
    );

    expect(mockRepo.saveSession).toHaveBeenCalledWith(
      7,
      42,
      'session-kobo',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:02:00.000Z'),
      120,
      5,
      20,
      'kobo',
    );
  });

  it('rejects sessions where endedAt is before startedAt', async () => {
    await expect(
      service.save(
        42,
        {
          sessionId: 'bad-order',
          startedAt: '2026-04-15T10:00:30.000Z',
          endedAt: '2026-04-15T10:00:00.000Z',
          durationSeconds: 10,
        },
        makeUser(),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(mockRepo.saveSession).not.toHaveBeenCalled();
  });

  it('rejects invalid timestamp payloads', async () => {
    await expect(
      service.save(
        42,
        {
          sessionId: 'bad-date',
          startedAt: 'not-a-date',
          endedAt: '2026-04-15T10:00:00.000Z',
          durationSeconds: 10,
        },
        makeUser(),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(mockRepo.saveSession).not.toHaveBeenCalled();
  });

  it('does not persist when access verification fails', async () => {
    mockBookService.verifyFileAccess.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      service.save(
        42,
        {
          sessionId: 'forbidden',
          startedAt: '2026-04-15T10:00:00.000Z',
          endedAt: '2026-04-15T10:00:20.000Z',
          durationSeconds: 20,
        },
        makeUser(),
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(mockRepo.saveSession).not.toHaveBeenCalled();
  });

  it('does not throw when repository reports skipped outcomes', async () => {
    mockRepo.saveSession.mockResolvedValueOnce({ kind: 'skipped', reason: 'duration_below_minimum' });

    await expect(
      service.save(
        42,
        {
          sessionId: 'skip',
          startedAt: '2026-04-15T10:00:00.000Z',
          endedAt: '2026-04-15T10:00:05.000Z',
          durationSeconds: 5,
        },
        makeUser(),
      ),
    ).resolves.toBeUndefined();
  });
});

const mockRepoExtended = {
  saveSession: vi.fn(),
  listByBook: vi.fn(),
  deleteSessionByBook: vi.fn(),
};

const mockBookServiceExtended = {
  verifyFileAccess: vi.fn(),
  verifyBookAccess: vi.fn(),
};

function makeServiceExtended() {
  return new ReadingSessionService(
    mockRepoExtended as unknown as ReadingSessionRepository,
    mockBookServiceExtended as unknown as BookService,
    { emit: vi.fn() } as never,
  );
}

describe('ReadingSessionService - listByBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookServiceExtended.verifyBookAccess.mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('verifies access and returns result', async () => {
    const mockResult = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      stats: { totalSessions: 0, totalSeconds: 0, avgDurationSeconds: 0, firstSessionAt: null, lastSessionAt: null },
    };
    mockRepoExtended.listByBook.mockResolvedValue(mockResult);

    const svc = makeServiceExtended();
    const result = await svc.listByBook(10, makeUser({ id: 5 }), { page: 1, pageSize: 25, sortBy: 'startedAt', sortDir: 'desc' });

    expect(mockBookServiceExtended.verifyBookAccess).toHaveBeenCalledWith(10, expect.objectContaining({ id: 5 }));
    expect(result).toBe(mockResult);
  });

  it('rethrows when access check fails', async () => {
    mockBookServiceExtended.verifyBookAccess.mockRejectedValueOnce(new ForbiddenException());

    const svc = makeServiceExtended();
    await expect(svc.listByBook(10, makeUser(), { page: 1, pageSize: 25, sortBy: 'startedAt', sortDir: 'desc' })).rejects.toThrow(ForbiddenException);
  });

  it('passes all query params to repo including optional dateFrom, dateTo, format', async () => {
    const emptyStats = { totalSessions: 0, totalSeconds: 0, avgDurationSeconds: 0, firstSessionAt: null, lastSessionAt: null, dailySummary: [] };
    mockRepoExtended.listByBook.mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 10, stats: emptyStats });

    const svc = makeServiceExtended();
    await svc.listByBook(10, makeUser({ id: 5 }), {
      page: 2,
      pageSize: 10,
      sortBy: 'durationSeconds',
      sortDir: 'asc',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      format: 'EPUB',
    });

    expect(mockRepoExtended.listByBook).toHaveBeenCalledWith(5, 10, 2, 10, 'durationSeconds', 'asc', '2026-01-01', '2026-12-31', 'EPUB');
  });

  it('uses defaults when optional params are missing', async () => {
    const emptyStats = { totalSessions: 0, totalSeconds: 0, avgDurationSeconds: 0, firstSessionAt: null, lastSessionAt: null, dailySummary: [] };
    mockRepoExtended.listByBook.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, stats: emptyStats });

    const svc = makeServiceExtended();
    await svc.listByBook(10, makeUser({ id: 5 }), {});

    expect(mockRepoExtended.listByBook).toHaveBeenCalledWith(5, 10, 1, 25, 'startedAt', 'desc', undefined, undefined, undefined);
  });
});

describe('ReadingSessionService - deleteSessionByBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookServiceExtended.verifyBookAccess.mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('throws NotFoundException when session not found', async () => {
    mockRepoExtended.deleteSessionByBook.mockResolvedValue({ found: false });

    const svc = makeServiceExtended();
    await expect(svc.deleteSessionByBook(10, 99, makeUser())).rejects.toThrow(NotFoundException);
  });

  it('completes without error when session found', async () => {
    mockRepoExtended.deleteSessionByBook.mockResolvedValue({ found: true });

    const svc = makeServiceExtended();
    await expect(svc.deleteSessionByBook(10, 5, makeUser())).resolves.toBeUndefined();
  });

  it('rethrows when access check fails', async () => {
    mockBookServiceExtended.verifyBookAccess.mockRejectedValueOnce(new ForbiddenException());

    const svc = makeServiceExtended();
    await expect(svc.deleteSessionByBook(10, 5, makeUser())).rejects.toThrow(ForbiddenException);
  });

  it('calls verifyBookAccess before calling repo', async () => {
    mockRepoExtended.deleteSessionByBook.mockResolvedValue({ found: true });
    const user = makeUser({ id: 5 });
    const svc = makeServiceExtended();

    await svc.deleteSessionByBook(10, 5, user);

    const bookAccessOrder = mockBookServiceExtended.verifyBookAccess.mock.invocationCallOrder[0];
    const repoOrder = mockRepoExtended.deleteSessionByBook.mock.invocationCallOrder[0];
    expect(bookAccessOrder).toBeLessThan(repoOrder);
  });
});
