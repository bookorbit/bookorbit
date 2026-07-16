import { ForbiddenException, Logger } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { ReadingStateRepository, type ResetReadingStateResult } from './reading-state.repository';
import { ReadingStateService } from './reading-state.service';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
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
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ResetReadingStateResult> = {}): ResetReadingStateResult {
  return {
    readStatus: {
      status: 'unread',
      source: 'manual',
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-07-09T12:00:00.000Z',
    },
    sessionsDeleted: 3,
    progressDeleted: 2,
    audioProgressDeleted: 1,
    koreaderDeviceProgressDeleted: 4,
    koreaderPageStatsDeleted: 5,
    koboStateReset: true,
    ...overrides,
  };
}

function makeService() {
  const bookService = {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
  };
  const repo = {
    resetBookReadingState: vi.fn().mockResolvedValue(makeResult()),
  };

  return {
    service: new ReadingStateService(bookService as unknown as BookService, repo as unknown as ReadingStateRepository),
    bookService,
    repo,
  };
}

describe('ReadingStateService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('verifies book access, uses the user timezone, and returns only the response contract', async () => {
    const { service, bookService, repo } = makeService();
    const user = makeUser({ settings: { timezone: 'America/Denver' } });

    const result = await service.resetBookReadingState(42, user);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(42, user);
    expect(repo.resetBookReadingState).toHaveBeenCalledWith(7, 42, 'America/Denver');
    expect(result).toEqual({ readStatus: makeResult().readStatus });
  });

  it('falls back to UTC for an invalid stored timezone', async () => {
    const { service, repo } = makeService();

    await service.resetBookReadingState(42, makeUser({ settings: { timezone: 'not/a-timezone' } }));

    expect(repo.resetBookReadingState).toHaveBeenCalledWith(7, 42, 'UTC');
  });

  it('propagates access failures, skips the repository, and emits a sanitized failure log', async () => {
    const { service, bookService, repo } = makeService();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    const error = new ForbiddenException('cannot reset "another user"\nstate');
    bookService.verifyBookAccess.mockRejectedValue(error);

    await expect(service.resetBookReadingState(42, makeUser())).rejects.toThrow(error);

    expect(repo.resetBookReadingState).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('error="cannot reset \\"another user\\" state" - reset reading state failed'));
  });
});
