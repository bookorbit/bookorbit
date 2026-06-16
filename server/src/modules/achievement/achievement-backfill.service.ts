import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AchievementRepository } from './achievement.repository';
import { AchievementService } from './achievement.service';
import { ACHIEVEMENT_EVENT_BACKFILL } from './achievement-events.service';
import { ACHIEVEMENT_SEED } from './seed/achievement-seed';

const BATCH_SIZE = 50;
const BACKFILL_SIGNATURE_KEY = 'achievements_backfill_signature';

export interface BackfillResult {
  usersProcessed: number;
  awardsGranted: number;
}

// Changes to the set of seeded achievement keys mean some users may now qualify for badges that did
// not exist before, so the signature gates a one-off retroactive catch-up after each such change.
function computeSeedSignature(): string {
  const keys = ACHIEVEMENT_SEED.map((a) => a.key).sort();
  return createHash('sha1').update(keys.join(',')).digest('hex');
}

@Injectable()
export class AchievementBackfillService implements OnModuleInit {
  private readonly logger = new Logger(AchievementBackfillService.name);

  constructor(
    private readonly repo: AchievementRepository,
    private readonly achievementService: AchievementService,
    private readonly appSettings: AppSettingsService,
  ) {}

  onModuleInit(): void {
    void this.runAutoBackfill();
  }

  async runBackfill(requestingUser: RequestUser): Promise<BackfillResult> {
    if (!requestingUser.isSuperuser) {
      throw new ForbiddenException('Only superusers can trigger achievement backfill');
    }

    const event = 'achievement.backfill';
    const startedAt = Date.now();
    const userIds = await this.repo.findAllUserIds();

    this.logger.log(`[${event}] [start] totalUsers=${userIds.length} - backfill started`);

    let awardsGranted = 0;
    const usersProcessed = await this.forEachUserInBatches(userIds, event, async (userId) => {
      // Read awardsGranted only after the await resolves; `awardsGranted += await ...` would capture
      // the pre-await value and lose concurrent batch increments.
      const count = await this.processUser(userId);
      awardsGranted += count;
    });

    this.logger.log(
      `[${event}] [end] usersProcessed=${usersProcessed} awardsGranted=${awardsGranted} durationMs=${Date.now() - startedAt} - backfill completed`,
    );

    return { usersProcessed, awardsGranted };
  }

  // Retroactively awards badges for everything users already did before a newly added achievement existed.
  // Gated by a seed signature so it runs at most once per change to the achievement set, and awards silently
  // (the BACKFILL event suppresses notifications) to avoid flooding users with historical badges.
  private async runAutoBackfill(): Promise<void> {
    const event = 'achievement.auto_backfill';
    try {
      const signature = computeSeedSignature();
      const stored = await this.appSettings.getValue(BACKFILL_SIGNATURE_KEY);
      if (stored === signature) return;

      // onModuleInit hooks run concurrently (Nest awaits them with Promise.all), so wait for the
      // catalogue seed explicitly: awarding before the new achievement rows exist would fail the FK.
      await this.achievementService.ensureCatalogueSeeded();

      const startedAt = Date.now();
      const userIds = await this.repo.findAllUserIds();
      this.logger.log(`[${event}] [start] totalUsers=${userIds.length} - achievement auto-backfill started`);

      const usersProcessed = await this.forEachUserInBatches(userIds, event, (userId) =>
        this.achievementService.handleEvent(ACHIEVEMENT_EVENT_BACKFILL, { userId }),
      );

      await this.appSettings.setValue(BACKFILL_SIGNATURE_KEY, signature);
      this.logger.log(`[${event}] [end] usersProcessed=${usersProcessed} durationMs=${Date.now() - startedAt} - achievement auto-backfill completed`);
    } catch (error) {
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(`[${event}] [fail] error="${errorMessage}" - achievement auto-backfill failed`);
    }
  }

  private async forEachUserInBatches(userIds: number[], event: string, onUser: (userId: number) => Promise<unknown>): Promise<number> {
    let usersProcessed = 0;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((userId) => onUser(userId)));
      for (const result of results) {
        if (result.status === 'fulfilled') {
          usersProcessed++;
        } else {
          const errorMessage = sanitizeLogValue(result.reason instanceof Error ? result.reason.message : String(result.reason));
          this.logger.warn(`[${event}] [fail] batchStart=${i} error="${errorMessage}" - user batch processing failed`);
        }
      }
    }
    return usersProcessed;
  }

  private async processUser(userId: number): Promise<number> {
    const earnedKeysBefore = await this.repo.findUserEarnedKeys(userId);
    const countBefore = earnedKeysBefore.size;

    await this.achievementService.handleEvent(ACHIEVEMENT_EVENT_BACKFILL, { userId });

    const earnedKeysAfter = await this.repo.findUserEarnedKeys(userId);
    return earnedKeysAfter.size - countBefore;
  }
}
