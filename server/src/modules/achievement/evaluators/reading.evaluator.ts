import { Injectable } from '@nestjs/common';
import { toZonedTime } from 'date-fns-tz';

import { AchievementRepository } from '../achievement.repository';
import {
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  type ReadingSessionSavedPayload,
  type BookStatusChangedPayload,
} from '../achievement-events.service';
import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

const BOOKS_FINISHED_TIERS = [
  { key: 'books_finished_1', threshold: 1 },
  { key: 'books_finished_2', threshold: 10 },
  { key: 'books_finished_3', threshold: 35 },
  { key: 'books_finished_4', threshold: 100 },
];

const PAGES_READ_TIERS = [
  { key: 'pages_read_1', threshold: 500 },
  { key: 'pages_read_2', threshold: 5000 },
  { key: 'pages_read_3', threshold: 25000 },
  { key: 'pages_read_4', threshold: 100000 },
];

const HOURS_READ_TIERS = [
  { key: 'hours_read_1', threshold: 10 },
  { key: 'hours_read_2', threshold: 100 },
  { key: 'hours_read_3', threshold: 500 },
  { key: 'hours_read_4', threshold: 1000 },
];

const LONG_BOOK_TIERS = [
  { key: 'long_book_1', threshold: 300 },
  { key: 'page_turner', threshold: 500 },
  { key: 'long_book_3', threshold: 750 },
  { key: 'tome_tamer', threshold: 1000 },
];

const MARATHONER_MINUTES = 90;
const ONE_SITTING_THRESHOLD = 90;
const SLOW_BURN_DAYS = 90;
const MONTHLY_READER_2_THRESHOLD = 10;
const ALL_NIGHTER_START_HOUR = 1;
const ALL_NIGHTER_END_HOUR = 4;
const EARLY_BIRD_START_HOUR = 5;
const EARLY_BIRD_END_HOUR = 7;
const POWER_HOUR_PAGES = 75;
const SPEED_READER_PAGES = 100;

@Injectable()
export class ReadingEvaluator implements IAchievementEvaluator {
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

    if (ctx.eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED) {
      const payload = ctx.payload as unknown as BookStatusChangedPayload;
      if (payload.newStatus === 'read') {
        await this.evaluateBooksFinished(ctx.userId, payload.bookId, earnedKeys, awards);
        await this.evaluatePagesRead(ctx.userId, earnedKeys, awards);
        await this.evaluateLongBookTiers(payload.bookId, earnedKeys, awards);
        await this.evaluateSprint(ctx.userId, payload.bookId, earnedKeys, awards);
        await this.evaluateBingeReader(ctx.userId, earnedKeys, awards);
        await this.evaluateSlowBurn(ctx.userId, payload.bookId, earnedKeys, awards);
        await this.evaluateMonthlyReader2(ctx.userId, earnedKeys, awards);
      }
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_READING_SESSION_SAVED) {
      const payload = ctx.payload as unknown as ReadingSessionSavedPayload;
      await this.evaluatePagesRead(ctx.userId, earnedKeys, awards);
      await this.evaluateHoursRead(ctx.userId, earnedKeys, awards);
      this.evaluateMarathoner(payload, earnedKeys, awards);
      this.evaluateAllNighter(payload, earnedKeys, awards);
      this.evaluateEarlyBird(payload, earnedKeys, awards);
      this.evaluateOneSitting(payload, earnedKeys, awards);
      await this.evaluatePowerHour(payload, earnedKeys, awards);
      await this.evaluateSpeedReader(ctx.userId, payload, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_BACKFILL) {
      await this.evaluateBooksFinishedBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluatePagesRead(ctx.userId, earnedKeys, awards);
      await this.evaluateHoursRead(ctx.userId, earnedKeys, awards);
      await this.evaluateMarathonerBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateAllNighterBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateEarlyBirdBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateLongBookTiersBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateSprintBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateBingeReader(ctx.userId, earnedKeys, awards);
      await this.evaluateSlowBurnBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateMonthlyReader2Backfill(ctx.userId, earnedKeys, awards);
      await this.evaluateOneSittingBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluatePowerHourBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateSpeedReaderBackfill(ctx.userId, earnedKeys, awards);
    }

    return awards;
  }

  private async evaluateBooksFinished(userId: number, bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = BOOKS_FINISHED_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const count = await this.repo.countFinishedBooks(userId);
    const bookTitle = await this.repo.getBookTitle(bookId);

    for (const tier of unearnedTiers) {
      if (count >= tier.threshold) {
        awards.push({ key: tier.key, context: { bookId, bookTitle, count } });
      }
    }
  }

  private async evaluatePagesRead(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = PAGES_READ_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const totalPages = await this.repo.sumPagesRead(userId);

    for (const tier of unearnedTiers) {
      if (totalPages >= tier.threshold) {
        awards.push({ key: tier.key, context: { totalPages } });
      }
    }
  }

  private async evaluateHoursRead(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = HOURS_READ_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const totalHours = await this.repo.sumReadingHours(userId);

    for (const tier of unearnedTiers) {
      if (totalHours >= tier.threshold) {
        awards.push({ key: tier.key, context: { totalHours } });
      }
    }
  }

  private evaluateMarathoner(payload: ReadingSessionSavedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('marathoner')) return;
    const minutes = payload.durationSeconds / 60;
    if (minutes >= MARATHONER_MINUTES) {
      awards.push({ key: 'marathoner', context: { durationMinutes: Math.floor(minutes) } });
    }
  }

  private evaluateAllNighter(payload: ReadingSessionSavedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('all_nighter')) return;
    const localStartedAt = toZonedTime(payload.startedAt, payload.timezone);
    const localEndedAt = toZonedTime(payload.endedAt, payload.timezone);
    const startHour = localStartedAt.getHours();
    const endHour = localEndedAt.getHours();
    const sessionSpansAllNighterHours =
      (startHour >= ALL_NIGHTER_START_HOUR && startHour < ALL_NIGHTER_END_HOUR) ||
      (endHour >= ALL_NIGHTER_START_HOUR && endHour < ALL_NIGHTER_END_HOUR) ||
      (startHour < ALL_NIGHTER_START_HOUR && endHour >= ALL_NIGHTER_END_HOUR);
    if (sessionSpansAllNighterHours) {
      awards.push({ key: 'all_nighter', context: { startedAt: payload.startedAt.toISOString() } });
    }
  }

  private evaluateEarlyBird(payload: ReadingSessionSavedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('early_bird')) return;
    const localStartedAt = toZonedTime(payload.startedAt, payload.timezone);
    const startHour = localStartedAt.getHours();
    if (startHour >= EARLY_BIRD_START_HOUR && startHour < EARLY_BIRD_END_HOUR) {
      awards.push({ key: 'early_bird', context: { startedAt: payload.startedAt.toISOString() } });
    }
  }

  private evaluateOneSitting(payload: ReadingSessionSavedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('one_sitting')) return;
    if (payload.progressDelta !== null && payload.progressDelta >= ONE_SITTING_THRESHOLD) {
      awards.push({ key: 'one_sitting', context: { progressDelta: payload.progressDelta } });
    }
  }

  private async evaluateLongBookTiers(bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = LONG_BOOK_TIERS.filter((tier) => !earnedKeys.has(tier.key));
    if (unearnedTiers.length === 0) return;

    const pageCount = await this.repo.getBookPageCount(bookId);
    if (pageCount === null) return;

    const minThreshold = unearnedTiers[0]?.threshold ?? LONG_BOOK_TIERS[0].threshold;
    if (pageCount < minThreshold) return;
    const bookTitle = await this.repo.getBookTitle(bookId);

    for (const tier of unearnedTiers) {
      if (pageCount >= tier.threshold) {
        awards.push({ key: tier.key, context: { bookId, bookTitle, pageCount } });
      }
    }
  }

  private async evaluateSprint(userId: number, bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('sprint')) return;
    const sameDay = await this.repo.wasBookStartedAndFinishedOnSameDay(userId, bookId);
    if (sameDay) {
      const bookTitle = await this.repo.getBookTitle(bookId);
      awards.push({ key: 'sprint', context: { bookId, bookTitle } });
    }
  }

  private async evaluateBingeReader(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('binge_reader')) return;
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const count = await this.repo.countBooksFinishedInDateRange(userId, oneWeekAgo, now);
    if (count >= 3) {
      awards.push({ key: 'binge_reader', context: { count } });
    }
  }

  private async evaluateSlowBurn(userId: number, bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('slow_burn')) return;
    const status = await this.repo.getBookStartedAndFinishedAt(userId, bookId);
    if (!status?.startedAt || !status?.finishedAt) return;
    const diffDays = (status.finishedAt.getTime() - status.startedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > SLOW_BURN_DAYS) {
      const bookTitle = await this.repo.getBookTitle(bookId);
      awards.push({ key: 'slow_burn', context: { bookId, bookTitle, days: Math.floor(diffDays) } });
    }
  }

  private async evaluateMonthlyReader2(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('monthly_reader_2')) return;
    const now = new Date();
    const count = await this.repo.countBooksFinishedInMonth(userId, now.getUTCFullYear(), now.getUTCMonth() + 1);
    if (count >= MONTHLY_READER_2_THRESHOLD) {
      awards.push({ key: 'monthly_reader_2', context: { count, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } });
    }
  }

  private async evaluateBooksFinishedBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = BOOKS_FINISHED_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;
    const count = await this.repo.countFinishedBooks(userId);
    for (const tier of unearnedTiers) {
      if (count >= tier.threshold) {
        awards.push({ key: tier.key, context: { count } });
      }
    }
  }

  private async evaluateMarathonerBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('marathoner')) return;
    const hasLongSession = await this.repo.hasSessionLongerThan(userId, MARATHONER_MINUTES * 60);
    if (hasLongSession) {
      awards.push({ key: 'marathoner', context: {} });
    }
  }

  private async evaluateAllNighterBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('all_nighter')) return;
    const hasSession = await this.repo.hasSessionInHourRange(userId, ALL_NIGHTER_START_HOUR, ALL_NIGHTER_END_HOUR);
    if (hasSession) {
      awards.push({ key: 'all_nighter', context: {} });
    }
  }

  private async evaluateEarlyBirdBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('early_bird')) return;
    const hasSession = await this.repo.hasSessionStartingInHourRange(userId, EARLY_BIRD_START_HOUR, EARLY_BIRD_END_HOUR);
    if (hasSession) {
      awards.push({ key: 'early_bird', context: {} });
    }
  }

  private async evaluateLongBookTiersBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = LONG_BOOK_TIERS.filter((tier) => !earnedKeys.has(tier.key));
    if (unearnedTiers.length === 0) return;

    const maxPages = await this.repo.getMaxFinishedBookPageCount(userId);
    for (const tier of unearnedTiers) {
      if (maxPages >= tier.threshold) {
        awards.push({ key: tier.key, context: { pageCount: maxPages } });
      }
    }
  }

  private async evaluateSprintBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('sprint')) return;
    const hasSameDay = await this.repo.hasAnyBookStartedAndFinishedOnSameDay(userId);
    if (hasSameDay) {
      awards.push({ key: 'sprint', context: {} });
    }
  }

  private async evaluateSlowBurnBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('slow_burn')) return;
    const hasSlowBurn = await this.repo.hasAnySlowBurnBook(userId, SLOW_BURN_DAYS);
    if (hasSlowBurn) {
      awards.push({ key: 'slow_burn', context: {} });
    }
  }

  private async evaluateMonthlyReader2Backfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('monthly_reader_2')) return;
    const hasMonth = await this.repo.hasMonthWithBooksFinished(userId, MONTHLY_READER_2_THRESHOLD);
    if (hasMonth) {
      awards.push({ key: 'monthly_reader_2', context: {} });
    }
  }

  private async evaluateOneSittingBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('one_sitting')) return;
    const hasSession = await this.repo.hasSessionWithProgressDeltaAtLeast(userId, ONE_SITTING_THRESHOLD);
    if (hasSession) {
      awards.push({ key: 'one_sitting', context: {} });
    }
  }

  private async evaluatePowerHour(payload: ReadingSessionSavedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('power_hour')) return;
    if (payload.progressDelta === null || payload.progressDelta <= 0) return;
    const pageCount = await this.repo.getPageCountByBookFile(payload.bookFileId);
    if (pageCount === null || pageCount <= 0) return;
    const pages = (Math.min(Math.max(payload.progressDelta, 0), 100) / 100) * pageCount;
    if (pages >= POWER_HOUR_PAGES) {
      awards.push({ key: 'power_hour', context: { pages: Math.floor(pages) } });
    }
  }

  private async evaluateSpeedReader(
    userId: number,
    payload: ReadingSessionSavedPayload,
    earnedKeys: Set<string>,
    awards: AchievementAward[],
  ): Promise<void> {
    if (earnedKeys.has('speed_reader')) return;
    const pages = await this.repo.getPagesOnDay(userId, payload.startedAt);
    if (pages >= SPEED_READER_PAGES) {
      awards.push({ key: 'speed_reader', context: { pages } });
    }
  }

  private async evaluatePowerHourBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('power_hour')) return;
    const maxPages = await this.repo.getMaxSessionPages(userId);
    if (maxPages >= POWER_HOUR_PAGES) {
      awards.push({ key: 'power_hour', context: { pages: maxPages } });
    }
  }

  private async evaluateSpeedReaderBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('speed_reader')) return;
    const maxDayPages = await this.repo.getMaxPagesInADay(userId);
    if (maxDayPages >= SPEED_READER_PAGES) {
      awards.push({ key: 'speed_reader', context: { pages: maxDayPages } });
    }
  }
}
