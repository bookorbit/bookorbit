import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AchievementBackfillService } from './achievement-backfill.service';
import { ACHIEVEMENT_EVENT_BACKFILL } from './achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findAllUserIds: vi.fn().mockResolvedValue([]),
    findUserEarnedKeys: vi.fn().mockResolvedValue(new Set()),
    ...overrides,
  };
}

function makeAchievementService() {
  return {
    handleEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSuperuser(overrides: Record<string, unknown> = {}) {
  return { id: 1, isSuperuser: true, ...overrides } as never;
}

function makeRegularUser() {
  return { id: 2, isSuperuser: false } as never;
}

describe('AchievementBackfillService', () => {
  let service: AchievementBackfillService;
  let repo: ReturnType<typeof makeRepo>;
  let achievementService: ReturnType<typeof makeAchievementService>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    achievementService = makeAchievementService();
    service = new AchievementBackfillService(repo as never, achievementService as never);
  });

  it('throws ForbiddenException for non-superuser callers', async () => {
    await expect(service.runBackfill(makeRegularUser())).rejects.toThrow(ForbiddenException);
    expect(repo.findAllUserIds).not.toHaveBeenCalled();
  });

  it('returns zero counts when no users exist', async () => {
    repo.findAllUserIds.mockResolvedValue([]);
    const result = await service.runBackfill(makeSuperuser());
    expect(result).toEqual({ usersProcessed: 0, awardsGranted: 0 });
  });

  it('calls handleEvent with ACHIEVEMENT_EVENT_BACKFILL for each user', async () => {
    repo.findAllUserIds.mockResolvedValue([1, 2, 3]);
    repo.findUserEarnedKeys.mockResolvedValue(new Set());

    await service.runBackfill(makeSuperuser());

    expect(achievementService.handleEvent).toHaveBeenCalledTimes(3);
    expect(achievementService.handleEvent).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BACKFILL, { userId: 1 });
    expect(achievementService.handleEvent).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BACKFILL, { userId: 2 });
    expect(achievementService.handleEvent).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BACKFILL, { userId: 3 });
  });
  it('correctly counts awards granted based on earned key delta', async () => {
    repo.findAllUserIds.mockResolvedValue([1, 2]);
    // With Promise.allSettled, both processUser calls start in parallel:
    // call order: user1-before, user2-before, user1-after, user2-after
    repo.findUserEarnedKeys
      .mockResolvedValueOnce(new Set(['books_finished_1'])) // user 1 before (size 1)
      .mockResolvedValueOnce(new Set()) // user 2 before (size 0)
      .mockResolvedValueOnce(new Set(['books_finished_1', 'marathoner'])) // user 1 after (size 2)
      .mockResolvedValueOnce(new Set(['bookmarked'])); // user 2 after (size 1)

    const result = await service.runBackfill(makeSuperuser());

    expect(result.usersProcessed).toBe(2);
    expect(result.awardsGranted).toBe(2);
  });

  it('is idempotent - awards granted is 0 when all keys already earned', async () => {
    repo.findAllUserIds.mockResolvedValue([1]);
    const earned = new Set(['books_finished_1', 'marathoner']);
    repo.findUserEarnedKeys.mockResolvedValue(earned);

    const result = await service.runBackfill(makeSuperuser());

    expect(result.awardsGranted).toBe(0);
    expect(result.usersProcessed).toBe(1);
  });

  it('continues processing remaining users when one user fails', async () => {
    repo.findAllUserIds.mockResolvedValue([1, 2, 3]);
    repo.findUserEarnedKeys.mockResolvedValue(new Set());
    achievementService.handleEvent.mockRejectedValueOnce(new Error('DB timeout')).mockResolvedValue(undefined);

    const result = await service.runBackfill(makeSuperuser());

    expect(result.usersProcessed).toBe(2);
    expect(achievementService.handleEvent).toHaveBeenCalledTimes(3);
  });
});
