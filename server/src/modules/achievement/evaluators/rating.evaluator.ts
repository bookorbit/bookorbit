import { Injectable } from '@nestjs/common';

import { AchievementRepository } from '../achievement.repository';
import { ACHIEVEMENT_EVENT_BACKFILL, ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, type BookRatingChangedPayload } from '../achievement-events.service';
import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

const CRITIC_TIERS = [
  { key: 'critic_1', threshold: 10 },
  { key: 'critic_2', threshold: 50 },
  { key: 'critic_3', threshold: 200 },
  { key: 'critic_4', threshold: 500 },
];

const ACROSS_THE_BOARD_THRESHOLD = 5;
const TOUGH_CROWD_MAX_RATING = 2;
const TOUGH_CROWD_THRESHOLD = 10;
const STANDING_OVATION_RATING = 5;

@Injectable()
export class RatingEvaluator implements IAchievementEvaluator {
  constructor(private readonly repo: AchievementRepository) {}

  supports(eventName: string): boolean {
    return eventName === ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED || eventName === ACHIEVEMENT_EVENT_BACKFILL;
  }

  async evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    const awards: AchievementAward[] = [];

    if (ctx.eventName === ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED) {
      const payload = ctx.payload as unknown as BookRatingChangedPayload;
      if (payload.rating === null) return awards;
      await this.evaluateFirstVerdict(ctx.userId, earnedKeys, awards);
      await this.evaluateCriticTiers(ctx.userId, earnedKeys, awards);
      this.evaluateStandingOvation(payload, earnedKeys, awards);
      await this.evaluateAcrossTheBoard(ctx.userId, earnedKeys, awards);
      await this.evaluateToughCrowd(ctx.userId, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_BACKFILL) {
      await this.evaluateFirstVerdict(ctx.userId, earnedKeys, awards);
      await this.evaluateCriticTiers(ctx.userId, earnedKeys, awards);
      await this.evaluateStandingOvationBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateAcrossTheBoard(ctx.userId, earnedKeys, awards);
      await this.evaluateToughCrowd(ctx.userId, earnedKeys, awards);
    }

    return awards;
  }

  private async evaluateFirstVerdict(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('first_verdict')) return;
    const count = await this.repo.countRatings(userId);
    if (count >= 1) {
      awards.push({ key: 'first_verdict', context: { count } });
    }
  }

  private async evaluateCriticTiers(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = CRITIC_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const count = await this.repo.countRatings(userId);

    for (const tier of unearnedTiers) {
      if (count >= tier.threshold) {
        awards.push({ key: tier.key, context: { count } });
      }
    }
  }

  private evaluateStandingOvation(payload: BookRatingChangedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('standing_ovation')) return;
    if (payload.rating === STANDING_OVATION_RATING) {
      awards.push({ key: 'standing_ovation', context: null });
    }
  }

  private async evaluateStandingOvationBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('standing_ovation')) return;
    const has = await this.repo.existsRatingValue(userId, STANDING_OVATION_RATING);
    if (has) {
      awards.push({ key: 'standing_ovation', context: null });
    }
  }

  private async evaluateAcrossTheBoard(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('across_the_board')) return;
    const distinct = await this.repo.countDistinctRatingValues(userId);
    if (distinct >= ACROSS_THE_BOARD_THRESHOLD) {
      awards.push({ key: 'across_the_board', context: { distinct } });
    }
  }

  private async evaluateToughCrowd(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('tough_crowd')) return;
    const count = await this.repo.countRatingsAtMost(userId, TOUGH_CROWD_MAX_RATING);
    if (count >= TOUGH_CROWD_THRESHOLD) {
      awards.push({ key: 'tough_crowd', context: { count } });
    }
  }
}
