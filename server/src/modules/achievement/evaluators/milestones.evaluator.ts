import { Injectable } from '@nestjs/common';
import { toZonedTime } from 'date-fns-tz';

import { AchievementRepository } from '../achievement.repository';
import {
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
  ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED,
  type ReadingSessionSavedPayload,
  type BookStatusChangedPayload,
} from '../achievement-events.service';
import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

const ALL_CATEGORIES_COUNT = 4;

@Injectable()
export class MilestonesEvaluator implements IAchievementEvaluator {
  constructor(private readonly repo: AchievementRepository) {}

  supports(eventName: string): boolean {
    return (
      eventName === ACHIEVEMENT_EVENT_READING_SESSION_SAVED ||
      eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED ||
      eventName === ACHIEVEMENT_EVENT_ANNOTATION_CREATED ||
      eventName === ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED ||
      eventName === ACHIEVEMENT_EVENT_BACKFILL
    );
  }

  async evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    const awards: AchievementAward[] = [];

    if (ctx.eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED) {
      const payload = ctx.payload as unknown as BookStatusChangedPayload;
      if (payload.newStatus === 'read') {
        await this.evaluateFirstSeries(ctx.userId, payload.bookId, earnedKeys, awards);
        this.evaluateOldFriend(payload, earnedKeys, awards);
      }
      if (payload.newStatus === 'abandoned') {
        this.evaluateDnfSelfAware(payload, earnedKeys, awards);
      }
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_ANNOTATION_CREATED) {
      this.evaluateBookmarked(ctx.userId, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_READING_SESSION_SAVED) {
      const payload = ctx.payload as unknown as ReadingSessionSavedPayload;
      this.evaluateNewYearReader(payload, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED) {
      await this.evaluateCategorySweeper(ctx.userId, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_BACKFILL) {
      await this.evaluateBookmarkedBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateNewYearReaderBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateFirstSeriesBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateDnfSelfAwareBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateCategorySweeper(ctx.userId, earnedKeys, awards);
    }

    return awards;
  }

  private evaluateBookmarked(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('bookmarked')) return;
    awards.push({ key: 'bookmarked', context: null });
  }

  private evaluateNewYearReader(payload: ReadingSessionSavedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('new_year_reader')) return;
    const localDate = toZonedTime(payload.startedAt, payload.timezone);
    if (localDate.getMonth() === 0 && localDate.getDate() === 1) {
      awards.push({ key: 'new_year_reader', context: { year: localDate.getFullYear() } });
    }
  }

  private async evaluateFirstSeries(userId: number, bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('first_series')) return;
    const seriesName = await this.repo.getBookSeriesName(bookId);
    if (seriesName && seriesName.trim() !== '') {
      const bookTitle = await this.repo.getBookTitle(bookId);
      awards.push({ key: 'first_series', context: { bookId, bookTitle, seriesName } });
    }
  }

  private async evaluateCategorySweeper(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('category_sweeper')) return;
    const categoryCount = await this.repo.countDistinctEarnedCategories(userId);
    if (categoryCount >= ALL_CATEGORIES_COUNT) {
      awards.push({ key: 'category_sweeper', context: { categoryCount } });
    }
  }

  private async evaluateBookmarkedBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('bookmarked')) return;
    const count = await this.repo.countAnnotations(userId);
    if (count >= 1) {
      awards.push({ key: 'bookmarked', context: null });
    }
  }

  private async evaluateNewYearReaderBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('new_year_reader')) return;
    const hasSession = await this.repo.hasSessionOnJanFirst(userId);
    if (hasSession) {
      awards.push({ key: 'new_year_reader', context: {} });
    }
  }

  private async evaluateFirstSeriesBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('first_series')) return;
    const hasSeriesBook = await this.repo.hasFinishedBookInSeries(userId);
    if (hasSeriesBook) {
      awards.push({ key: 'first_series', context: {} });
    }
  }

  // Awarded when a book that was being re-read is finished again. Re-read history is not stored,
  // so this is live-only (no backfill branch) and only accrues going forward.
  private evaluateOldFriend(payload: BookStatusChangedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('old_friend')) return;
    if (payload.previousStatus === 'rereading') {
      awards.push({ key: 'old_friend', context: { bookId: payload.bookId } });
    }
  }

  private evaluateDnfSelfAware(payload: BookStatusChangedPayload, earnedKeys: Set<string>, awards: AchievementAward[]): void {
    if (earnedKeys.has('dnf_self_aware')) return;
    awards.push({ key: 'dnf_self_aware', context: { bookId: payload.bookId } });
  }

  private async evaluateDnfSelfAwareBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('dnf_self_aware')) return;
    const hasAbandoned = await this.repo.hasAbandonedBook(userId);
    if (hasAbandoned) {
      awards.push({ key: 'dnf_self_aware', context: null });
    }
  }
}
