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
    ensureCatalogueSeeded: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAppSettings(overrides: Record<string, unknown> = {}) {
  return {
    getValue: vi.fn().mockResolvedValue(null),
    setValue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
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
  let appSettings: ReturnType<typeof makeAppSettings>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    achievementService = makeAchievementService();
    appSettings = makeAppSettings();
    service = new AchievementBackfillService(repo as never, achievementService as never, appSettings as never);
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
    // Keyed by user (not global call order) so the assertion does not depend on batch interleaving.
    // user 1: 1 key before -> 2 after (delta 1); user 2: 0 before -> 1 after (delta 1); total 2.
    const earnedByUser: Record<number, Set<string>[]> = {
      1: [new Set(['books_finished_1']), new Set(['books_finished_1', 'marathoner'])],
      2: [new Set(), new Set(['bookmarked'])],
    };
    const callCounts: Record<number, number> = { 1: 0, 2: 0 };
    repo.findUserEarnedKeys.mockImplementation((userId: number) => Promise.resolve(earnedByUser[userId][callCounts[userId]++]));

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

  describe('onModuleInit auto-backfill', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('backfills all users and stores the seed signature when none is stored', async () => {
      repo.findAllUserIds.mockResolvedValue([1, 2]);

      service.onModuleInit();
      await flush();

      expect(achievementService.handleEvent).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BACKFILL, { userId: 1 });
      expect(achievementService.handleEvent).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BACKFILL, { userId: 2 });
      expect(appSettings.setValue).toHaveBeenCalledWith('achievements_backfill_signature', expect.any(String));
    });

    it('waits for the catalogue seed before awarding, so badge FKs resolve', async () => {
      repo.findAllUserIds.mockResolvedValue([1]);
      const order: string[] = [];
      achievementService.ensureCatalogueSeeded.mockImplementation(() => {
        order.push('seed');
        return Promise.resolve();
      });
      achievementService.handleEvent.mockImplementation(() => {
        order.push('handle');
        return Promise.resolve();
      });

      service.onModuleInit();
      await flush();

      expect(order).toEqual(['seed', 'handle']);
    });

    it('skips the backfill when the stored signature already matches the current seed', async () => {
      appSettings.setValue.mockResolvedValue(undefined);
      // First run computes and stores the current signature, which we then feed back as the stored value.
      service.onModuleInit();
      await flush();
      const storedSignature = appSettings.setValue.mock.calls[0]?.[1];
      vi.clearAllMocks();
      appSettings.getValue.mockResolvedValue(storedSignature);

      service.onModuleInit();
      await flush();

      expect(repo.findAllUserIds).not.toHaveBeenCalled();
      expect(achievementService.handleEvent).not.toHaveBeenCalled();
      expect(appSettings.setValue).not.toHaveBeenCalled();
    });

    it('does not store the signature when backfill fails, so it retries on the next start', async () => {
      repo.findAllUserIds.mockRejectedValue(new Error('DB down'));

      service.onModuleInit();
      await flush();

      expect(appSettings.setValue).not.toHaveBeenCalled();
    });
  });
});
