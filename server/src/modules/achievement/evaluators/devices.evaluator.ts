import { Injectable } from '@nestjs/common';

import { AchievementRepository } from '../achievement.repository';
import {
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
} from '../achievement-events.service';
import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

const FULL_ORBIT_SOURCES = 3;
const TWO_WORLDS_SOURCES = 2;

@Injectable()
export class DevicesEvaluator implements IAchievementEvaluator {
  constructor(private readonly repo: AchievementRepository) {}

  supports(eventName: string): boolean {
    return (
      eventName === ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED ||
      eventName === ACHIEVEMENT_EVENT_READING_SESSION_SAVED ||
      eventName === ACHIEVEMENT_EVENT_BACKFILL
    );
  }

  async evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    const awards: AchievementAward[] = [];

    if (earnedKeys.has('synced_up') && earnedKeys.has('full_orbit') && earnedKeys.has('two_worlds')) {
      return awards;
    }

    // A web reading session alone can only complete a device badge if an external device already exists,
    // so web-only users short-circuit here instead of running the heavier source queries every session.
    if (ctx.eventName === ACHIEVEMENT_EVENT_READING_SESSION_SAVED) {
      const hasDevice = await this.repo.hasAnyExternalDevice(ctx.userId);
      if (!hasDevice) return awards;
    }

    await this.evaluateSyncedUp(ctx.userId, earnedKeys, awards);
    await this.evaluateFullOrbit(ctx.userId, earnedKeys, awards);
    await this.evaluateTwoWorlds(ctx.userId, earnedKeys, awards);

    return awards;
  }

  private async evaluateSyncedUp(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('synced_up')) return;
    const hasDevice = await this.repo.hasAnyExternalDevice(userId);
    if (hasDevice) {
      awards.push({ key: 'synced_up', context: null });
    }
  }

  private async evaluateFullOrbit(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('full_orbit')) return;
    const sources = await this.repo.countDistinctSources(userId);
    if (sources >= FULL_ORBIT_SOURCES) {
      awards.push({ key: 'full_orbit', context: { sources } });
    }
  }

  private async evaluateTwoWorlds(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('two_worlds')) return;
    const maxSources = await this.repo.maxSourcesOnSingleBook(userId);
    if (maxSources >= TWO_WORLDS_SOURCES) {
      awards.push({ key: 'two_worlds', context: { maxSources } });
    }
  }
}
