import { Injectable } from '@nestjs/common';
import { toZonedTime } from 'date-fns-tz';

import { AchievementRepository } from '../achievement.repository';
import {
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  type ReadingSessionSavedPayload,
  type BookStatusChangedPayload,
} from '../achievement-events.service';
import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

const STREAK_TIERS = [
  { key: 'streak_1', threshold: 7 },
  { key: 'streak_2', threshold: 30 },
  { key: 'streak_3', threshold: 100 },
  { key: 'streak_4', threshold: 365 },
];

const SEASONAL_READER_THRESHOLD = 4;
const CONSISTENT_READER_DAYS = 14;
const CONSISTENT_READER_MIN_SECONDS = 1800;
const WEEKEND_RHYTHM_WEEKS = 8;
const YEARLY_FINISHER_12_THRESHOLD = 12;

@Injectable()
export class DedicationEvaluator implements IAchievementEvaluator {
  constructor(private readonly repo: AchievementRepository) {}

  supports(eventName: string): boolean {
    return (
      eventName === ACHIEVEMENT_EVENT_READING_SESSION_SAVED ||
      eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED ||
      eventName === ACHIEVEMENT_EVENT_BACKFILL
    );
  }

  async evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    const awards: AchievementAward[] = [];

    if (ctx.eventName === ACHIEVEMENT_EVENT_READING_SESSION_SAVED) {
      const payload = ctx.payload as unknown as ReadingSessionSavedPayload;
      await this.evaluateStreakTiers(ctx.userId, earnedKeys, awards);
      await this.evaluateYearRoundReader(ctx.userId, earnedKeys, awards);
      await this.evaluateComebackKid(ctx.userId, payload, earnedKeys, awards);
      await this.evaluateSeasonalReader(ctx.userId, earnedKeys, awards);
      await this.evaluatePerfectMonth(ctx.userId, earnedKeys, awards);
      await this.evaluateConsistentReader(ctx.userId, earnedKeys, awards);
      await this.evaluateWeekendRhythm(ctx.userId, earnedKeys, awards);
      await this.evaluateWeekendWarrior(ctx.userId, payload, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED) {
      const payload = ctx.payload as unknown as BookStatusChangedPayload;
      if (payload.newStatus === 'read') {
        await this.evaluateReborn(ctx.userId, payload.bookId, earnedKeys, awards);
        await this.evaluateYearlyFinisher12(ctx.userId, earnedKeys, awards);
      }
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_BACKFILL) {
      await this.evaluateStreakTiers(ctx.userId, earnedKeys, awards);
      await this.evaluateYearRoundReader(ctx.userId, earnedKeys, awards);
      await this.evaluateComebackKidBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateRebornBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateSeasonalReader(ctx.userId, earnedKeys, awards);
      await this.evaluatePerfectMonth(ctx.userId, earnedKeys, awards);
      await this.evaluateConsistentReader(ctx.userId, earnedKeys, awards);
      await this.evaluateWeekendRhythm(ctx.userId, earnedKeys, awards);
      await this.evaluateWeekendWarriorBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateYearlyFinisher12(ctx.userId, earnedKeys, awards);
    }

    return awards;
  }

  private async evaluateStreakTiers(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = STREAK_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const streak = await this.repo.getCurrentStreak(userId);

    for (const tier of unearnedTiers) {
      if (streak >= tier.threshold) {
        awards.push({ key: tier.key, context: { streak } });
      }
    }
  }

  private async evaluateYearRoundReader(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('year_round_reader')) return;
    const currentYear = new Date().getFullYear();
    const months = await this.repo.countDistinctMonthsWithReading(userId, currentYear);
    if (months >= 12) {
      awards.push({ key: 'year_round_reader', context: { year: currentYear } });
    }
  }

  private async evaluateReborn(userId: number, bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('reborn')) return;
    const wasAbandoned = await this.repo.wasBookAbandonedBefore(userId, bookId, 6);
    if (wasAbandoned) {
      const bookTitle = await this.repo.getBookTitle(bookId);
      awards.push({ key: 'reborn', context: { bookId, bookTitle } });
    }
  }

  private async evaluateComebackKid(
    userId: number,
    payload: ReadingSessionSavedPayload,
    earnedKeys: Set<string>,
    awards: AchievementAward[],
  ): Promise<void> {
    if (earnedKeys.has('comeback_kid')) return;
    const previousEnd = await this.repo.getPreviousSessionEndedAt(userId, String(payload.bookFileId));
    if (!previousEnd) return;

    const daysSince = Math.floor((payload.startedAt.getTime() - previousEnd.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= 30) {
      awards.push({ key: 'comeback_kid', context: { daysSinceLastSession: daysSince } });
    }
  }

  private async evaluateComebackKidBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('comeback_kid')) return;
    const hasGap = await this.repo.hasLargeGapBetweenAnySessions(userId, 30);
    if (hasGap) {
      awards.push({ key: 'comeback_kid', context: {} });
    }
  }

  private async evaluateRebornBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('reborn')) return;
    const hasReborn = await this.repo.hasAnyBookRebornFromAbandoned(userId, 6);
    if (hasReborn) {
      awards.push({ key: 'reborn', context: {} });
    }
  }

  private async evaluateSeasonalReader(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('seasonal_reader')) return;
    const currentYear = new Date().getFullYear();
    const seasonCount = await this.repo.countDistinctSeasonsWithReading(userId, currentYear);
    if (seasonCount >= SEASONAL_READER_THRESHOLD) {
      awards.push({ key: 'seasonal_reader', context: { year: currentYear, seasonCount } });
    }
  }

  private async evaluatePerfectMonth(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('perfect_month')) return;
    const hasPerfect = await this.repo.hasReadEveryDayInAnyMonth(userId);
    if (hasPerfect) {
      awards.push({ key: 'perfect_month', context: null });
    }
  }

  private async evaluateConsistentReader(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('consistent_reader')) return;
    const hasStreak = await this.repo.hasConsecutiveDaysWithMinReading(userId, CONSISTENT_READER_DAYS, CONSISTENT_READER_MIN_SECONDS);
    if (hasStreak) {
      awards.push({ key: 'consistent_reader', context: { days: CONSISTENT_READER_DAYS } });
    }
  }

  private async evaluateWeekendRhythm(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('weekend_rhythm')) return;
    const hasRhythm = await this.repo.hasConsecutiveWeekendsWithReading(userId, WEEKEND_RHYTHM_WEEKS);
    if (hasRhythm) {
      awards.push({ key: 'weekend_rhythm', context: { weeks: WEEKEND_RHYTHM_WEEKS } });
    }
  }

  private async evaluateWeekendWarrior(
    userId: number,
    payload: ReadingSessionSavedPayload,
    earnedKeys: Set<string>,
    awards: AchievementAward[],
  ): Promise<void> {
    if (earnedKeys.has('weekend_warrior')) return;
    const localEndedAt = toZonedTime(payload.endedAt, payload.timezone);
    const sessionDay = localEndedAt.getDay();
    if (sessionDay !== 0 && sessionDay !== 6) return;

    const saturday = new Date(localEndedAt);
    if (sessionDay === 0) {
      saturday.setDate(saturday.getDate() - 1);
    }
    const y = saturday.getFullYear();
    const m = String(saturday.getMonth() + 1).padStart(2, '0');
    const d = String(saturday.getDate()).padStart(2, '0');
    const saturdayStr = `${y}-${m}-${d}`;

    const hours = await this.repo.sumWeekendReadingHours(userId, saturdayStr);
    if (hours >= 5) {
      awards.push({ key: 'weekend_warrior', context: { weekend: saturdayStr, hours } });
    }
  }

  private async evaluateWeekendWarriorBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('weekend_warrior')) return;
    const hasMarathon = await this.repo.hasWeekendMarathon(userId, 5);
    if (hasMarathon) {
      awards.push({ key: 'weekend_warrior', context: {} });
    }
  }

  private async evaluateYearlyFinisher12(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('yearly_finisher_12')) return;
    const currentYear = new Date().getUTCFullYear();
    const count = await this.repo.countBooksFinishedInYear(userId, currentYear);
    if (count >= YEARLY_FINISHER_12_THRESHOLD) {
      awards.push({ key: 'yearly_finisher_12', context: { year: currentYear, count } });
    }
  }
}
