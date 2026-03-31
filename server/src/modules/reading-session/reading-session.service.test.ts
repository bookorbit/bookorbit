import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { ReadingSessionRepository, type SaveReadingSessionResult } from './reading-session.repository';
import { ReadingSessionService } from './reading-session.service';

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
  };
}

const mockRepo = {
  saveSession: vi.fn<(...args: [number, number, string, Date, Date, number, number | null, number | null]) => Promise<SaveReadingSessionResult>>(),
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
    service = new ReadingSessionService(mockRepo as unknown as ReadingSessionRepository, mockBookService as unknown as BookService);
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
