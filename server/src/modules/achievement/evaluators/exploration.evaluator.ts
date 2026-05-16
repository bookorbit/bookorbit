import { Injectable } from '@nestjs/common';

import { AchievementRepository } from '../achievement.repository';
import { ACHIEVEMENT_EVENT_BACKFILL, ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, type BookStatusChangedPayload } from '../achievement-events.service';
import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

const GENRE_EXPLORER_TIERS = [
  { key: 'genre_explorer_1', threshold: 5 },
  { key: 'genre_explorer_2', threshold: 10 },
  { key: 'genre_explorer_3', threshold: 15 },
  { key: 'genre_explorer_4', threshold: 20 },
];

const POLYGLOT_TIERS = [
  { key: 'polyglot_1', threshold: 2 },
  { key: 'polyglot_2', threshold: 3 },
  { key: 'polyglot_3', threshold: 5 },
  { key: 'polyglot_4', threshold: 7 },
];

const DECADE_SAMPLER_THRESHOLD = 5;
const SHORT_STORY_FAN_THRESHOLD = 5;
const SHORT_STORY_MAX_PAGES = 100;
const THICK_AND_THIN_THIN_MAX = 100;
const THICK_AND_THIN_THICK_MIN = 800;
const TRILOGY_SIZE = 3;
const GENRE_DEVOTEE_THRESHOLD = 10;

@Injectable()
export class ExplorationEvaluator implements IAchievementEvaluator {
  constructor(private readonly repo: AchievementRepository) {}

  supports(eventName: string): boolean {
    return eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED || eventName === ACHIEVEMENT_EVENT_BACKFILL;
  }

  async evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    if (ctx.eventName === ACHIEVEMENT_EVENT_BACKFILL) {
      return this.evaluateBackfill(ctx.userId, earnedKeys);
    }

    const payload = ctx.payload as unknown as BookStatusChangedPayload;
    if (payload.newStatus !== 'read') return [];

    const awards: AchievementAward[] = [];

    await this.evaluateGenreExplorerTiers(ctx.userId, earnedKeys, awards);
    await this.evaluatePolyglotTiers(ctx.userId, earnedKeys, awards);
    await this.evaluateOldSoul(ctx.userId, payload.bookId, earnedKeys, awards);
    await this.evaluateNewRelease(ctx.userId, payload.bookId, earnedKeys, awards);
    await this.evaluateCenturySpan(ctx.userId, earnedKeys, awards);
    await this.evaluateAuthorDeepDive(ctx.userId, earnedKeys, awards);
    await this.evaluateDecadeSampler(ctx.userId, earnedKeys, awards);
    await this.evaluateShortStoryFan(ctx.userId, earnedKeys, awards);
    await this.evaluateThickAndThin(ctx.userId, earnedKeys, awards);
    await this.evaluateTrilogyMaster(ctx.userId, earnedKeys, awards);
    await this.evaluateGenreDevotee(ctx.userId, earnedKeys, awards);

    return awards;
  }

  private async evaluateBackfill(userId: number, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    const awards: AchievementAward[] = [];

    await this.evaluateGenreExplorerTiers(userId, earnedKeys, awards);
    await this.evaluatePolyglotTiers(userId, earnedKeys, awards);
    await this.evaluateOldSoulBackfill(userId, earnedKeys, awards);
    await this.evaluateNewReleaseBackfill(userId, earnedKeys, awards);
    await this.evaluateCenturySpan(userId, earnedKeys, awards);
    await this.evaluateAuthorDeepDive(userId, earnedKeys, awards);
    await this.evaluateDecadeSampler(userId, earnedKeys, awards);
    await this.evaluateShortStoryFan(userId, earnedKeys, awards);
    await this.evaluateThickAndThin(userId, earnedKeys, awards);
    await this.evaluateTrilogyMaster(userId, earnedKeys, awards);
    await this.evaluateGenreDevotee(userId, earnedKeys, awards);

    return awards;
  }

  private async evaluateGenreExplorerTiers(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = GENRE_EXPLORER_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const count = await this.repo.countDistinctGenresRead(userId);

    for (const tier of unearnedTiers) {
      if (count >= tier.threshold) {
        awards.push({ key: tier.key, context: { genreCount: count } });
      }
    }
  }

  private async evaluatePolyglotTiers(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = POLYGLOT_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const count = await this.repo.countDistinctLanguagesRead(userId);

    for (const tier of unearnedTiers) {
      if (count >= tier.threshold) {
        awards.push({ key: tier.key, context: { languageCount: count } });
      }
    }
  }

  private async evaluateOldSoul(userId: number, bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('old_soul')) return;
    const publishedYear = await this.repo.getBookPublishedYear(bookId);
    if (publishedYear !== null && publishedYear < 1900) {
      const bookTitle = await this.repo.getBookTitle(bookId);
      awards.push({ key: 'old_soul', context: { bookId, bookTitle, publishedYear } });
    }
  }

  private async evaluateNewRelease(userId: number, bookId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('new_release')) return;
    const publishedYear = await this.repo.getBookPublishedYear(bookId);
    const currentYear = new Date().getFullYear();
    if (publishedYear !== null && publishedYear === currentYear) {
      const bookTitle = await this.repo.getBookTitle(bookId);
      awards.push({ key: 'new_release', context: { bookId, bookTitle, publishedYear } });
    }
  }

  private async evaluateCenturySpan(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('century_span')) return;
    const centuryCount = await this.repo.countDistinctCenturiesRead(userId);
    if (centuryCount >= 3) {
      awards.push({ key: 'century_span', context: { centuryCount } });
    }
  }

  private async evaluateAuthorDeepDive(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('author_deep_dive')) return;
    const maxBooks = await this.repo.maxBooksPerAuthor(userId);
    if (maxBooks >= 5) {
      awards.push({ key: 'author_deep_dive', context: { booksRead: maxBooks } });
    }
  }

  private async evaluateDecadeSampler(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('decade_sampler')) return;
    const decadeCount = await this.repo.countDistinctDecadesRead(userId);
    if (decadeCount >= DECADE_SAMPLER_THRESHOLD) {
      awards.push({ key: 'decade_sampler', context: { decadeCount } });
    }
  }

  private async evaluateShortStoryFan(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('short_story_fan')) return;
    const count = await this.repo.countFinishedBooksByMaxPageCount(userId, SHORT_STORY_MAX_PAGES);
    if (count >= SHORT_STORY_FAN_THRESHOLD) {
      awards.push({ key: 'short_story_fan', context: { count } });
    }
  }

  private async evaluateThickAndThin(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('thick_and_thin')) return;
    const hasThin = await this.repo.hasFinishedBookUnderPages(userId, THICK_AND_THIN_THIN_MAX);
    if (!hasThin) return;
    const hasThick = await this.repo.hasFinishedBookOverPages(userId, THICK_AND_THIN_THICK_MIN);
    if (hasThick) {
      awards.push({ key: 'thick_and_thin', context: null });
    }
  }

  private async evaluateTrilogyMaster(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('trilogy_master')) return;
    const completed = await this.repo.hasCompletedSeriesOfSize(userId, TRILOGY_SIZE);
    if (completed) {
      awards.push({ key: 'trilogy_master', context: null });
    }
  }

  private async evaluateGenreDevotee(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('genre_devotee')) return;
    const maxBooks = await this.repo.maxBooksPerGenre(userId);
    if (maxBooks >= GENRE_DEVOTEE_THRESHOLD) {
      awards.push({ key: 'genre_devotee', context: { booksInGenre: maxBooks } });
    }
  }

  private async evaluateOldSoulBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('old_soul')) return;
    const hasBook = await this.repo.hasFinishedBookPublishedBefore(userId, 1900);
    if (hasBook) {
      awards.push({ key: 'old_soul', context: {} });
    }
  }

  private async evaluateNewReleaseBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('new_release')) return;
    const currentYear = new Date().getFullYear();
    const hasBook = await this.repo.hasFinishedBookPublishedInYear(userId, currentYear);
    if (hasBook) {
      awards.push({ key: 'new_release', context: { publishedYear: currentYear } });
    }
  }
}
