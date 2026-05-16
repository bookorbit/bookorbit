import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { AchievementRepository } from './achievement.repository';
import { AchievementService } from './achievement.service';
import { ACHIEVEMENT_EVENT_BACKFILL } from './achievement-events.service';

const BATCH_SIZE = 50;

export interface BackfillResult {
  usersProcessed: number;
  awardsGranted: number;
}

@Injectable()
export class AchievementBackfillService {
  private readonly logger = new Logger(AchievementBackfillService.name);

  constructor(
    private readonly repo: AchievementRepository,
    private readonly achievementService: AchievementService,
  ) {}

  async runBackfill(requestingUser: RequestUser): Promise<BackfillResult> {
    if (!requestingUser.isSuperuser) {
      throw new ForbiddenException('Only superusers can trigger achievement backfill');
    }

    const event = 'achievement.backfill';
    const startedAt = Date.now();
    const userIds = await this.repo.findAllUserIds();
    const totalUsers = userIds.length;

    this.logger.log(`[${event}] [start] totalUsers=${totalUsers} - backfill started`);

    let usersProcessed = 0;
    let awardsGranted = 0;

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((userId) =>
          this.processUser(userId).then((count) => {
            awardsGranted += count;
          }),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          usersProcessed++;
        } else {
          const errorMessage = sanitizeLogValue(result.reason instanceof Error ? result.reason.message : String(result.reason));
          this.logger.warn(`[${event}] [fail] batchStart=${i} error="${errorMessage}" - user batch processing failed`);
        }
      }

      if (i > 0 && i % 100 === 0) {
        this.logger.log(`[${event}] usersProcessed=${usersProcessed} awardsGranted=${awardsGranted} - backfill in progress`);
      }
    }

    this.logger.log(
      `[${event}] [end] usersProcessed=${usersProcessed} awardsGranted=${awardsGranted} durationMs=${Date.now() - startedAt} - backfill completed`,
    );

    return { usersProcessed, awardsGranted };
  }

  private async processUser(userId: number): Promise<number> {
    const earnedKeysBefore = await this.repo.findUserEarnedKeys(userId);
    const countBefore = earnedKeysBefore.size;

    await this.achievementService.handleEvent(ACHIEVEMENT_EVENT_BACKFILL, { userId });

    const earnedKeysAfter = await this.repo.findUserEarnedKeys(userId);
    return earnedKeysAfter.size - countBefore;
  }
}
