import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationType, ACHIEVEMENT_CATEGORY_LABELS } from '@bookorbit/types';
import type { AchievementCatalogueResponse, AchievementCategoryGroup, AchievementItem, AchievementCategory } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';

import { NotificationService } from '../notification/notification.service';
import { AchievementRepository } from './achievement.repository';
import {
  AchievementEventsService,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
  ACHIEVEMENT_EVENT_COLLECTION_CREATED,
  ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED,
  ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED,
  ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_BACKFILL,
} from './achievement-events.service';
import { EvaluatorRegistry } from './evaluators/evaluator-registry';
import { ACHIEVEMENT_SEED } from './seed/achievement-seed';
import type { AchievementRow, UserAchievementRow } from '../../db/schema';

@Injectable()
export class AchievementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AchievementService.name);
  private readonly eventHandlers = new Map<string, (payload: Record<string, unknown>) => void>();
  private seedPromise: Promise<void> | null = null;

  constructor(
    private readonly repo: AchievementRepository,
    private readonly events: AchievementEventsService,
    private readonly registry: EvaluatorRegistry,
    private readonly notificationService: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureCatalogueSeeded();
    this.registerEventListeners();
  }

  // Memoized so the catalogue is seeded exactly once, and so a concurrent onModuleInit hook
  // (the auto-backfill) can await it before awarding achievements whose keys are FK'd to the catalogue.
  ensureCatalogueSeeded(): Promise<void> {
    if (!this.seedPromise) {
      this.seedPromise = this.seedCatalogue();
    }
    return this.seedPromise;
  }

  async getCatalogue(user: RequestUser): Promise<AchievementCatalogueResponse> {
    const userId = user.id;
    const [allAchievements, userAchievements] = await Promise.all([this.repo.findAllAchievements(), this.repo.findUserAchievements(userId)]);

    const earnedMap = new Map<string, UserAchievementRow>();
    for (const ua of userAchievements) {
      earnedMap.set(ua.achievementKey, ua);
    }

    const progressMap = await this.computeProgress(userId, user.isSuperuser, allAchievements, earnedMap);

    const categoryOrder: AchievementCategory[] = ['reading', 'library', 'exploration', 'dedication', 'devices'];
    const grouped = new Map<AchievementCategory, AchievementItem[]>();

    for (const cat of categoryOrder) {
      grouped.set(cat, []);
    }

    for (const achievement of allAchievements) {
      const earned = earnedMap.get(achievement.key);
      const category = achievement.category as AchievementCategory;
      const items = grouped.get(category);
      if (!items) continue;

      items.push({
        key: achievement.key,
        groupKey: achievement.groupKey,
        tier: achievement.tier,
        category,
        name: achievement.hidden && !earned ? '???' : achievement.name,
        description: achievement.hidden && !earned ? 'Secret Achievement' : achievement.description,
        iconName: achievement.hidden && !earned ? 'help-circle' : achievement.iconName,
        rarity: achievement.rarity as AchievementItem['rarity'],
        threshold: achievement.threshold,
        hidden: achievement.hidden,
        sortOrder: achievement.sortOrder,
        earned: !!earned,
        awardedAt: earned?.awardedAt?.toISOString() ?? null,
        context: (earned?.contextJson as Record<string, unknown>) ?? null,
        currentProgress: progressMap.get(achievement.key) ?? null,
      });
    }

    let totalEarned = 0;
    let totalAvailable = 0;
    const categories: AchievementCategoryGroup[] = [];

    for (const cat of categoryOrder) {
      const items = grouped.get(cat) ?? [];
      const earnedCount = items.filter((i) => i.earned).length;
      totalEarned += earnedCount;
      totalAvailable += items.length;

      categories.push({
        key: cat,
        label: ACHIEVEMENT_CATEGORY_LABELS[cat],
        earnedCount,
        totalCount: items.length,
        achievements: items,
      });
    }

    return { categories, totalEarned, totalAvailable };
  }

  async handleEvent(eventName: string, payload: Record<string, unknown>): Promise<void> {
    const userId = payload.userId as number;
    if (!userId) return;

    const event = 'achievement.evaluate';
    const startedAt = Date.now();

    try {
      const [earnedKeys, isSuperuser] = await Promise.all([this.repo.findUserEarnedKeys(userId), this.repo.findUserIsSuperuser(userId)]);
      const awards = await this.registry.evaluate({ userId, isSuperuser, eventName, payload }, earnedKeys);
      // Backfill is a retroactive catch-up, so it awards silently instead of flooding the user with notifications.
      const notify = eventName !== ACHIEVEMENT_EVENT_BACKFILL;

      let awarded = 0;
      for (const award of awards) {
        if (earnedKeys.has(award.key)) continue;
        const row = await this.repo.award(userId, award.key, award.context);
        if (row) {
          awarded++;
          earnedKeys.add(award.key);
          if (notify) await this.sendNotification(userId, award.key);
        }
      }

      if (awarded > 0) {
        await this.evaluateMetaBadges(userId, isSuperuser, earnedKeys, notify);
      }

      if (awarded > 0) {
        this.logger.log(
          `[${event}] [end] userId=${userId} event=${eventName} durationMs=${Date.now() - startedAt} awarded=${awarded} - achievement evaluation completed`,
        );
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(
        `[${event}] [fail] userId=${userId} event=${eventName} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - achievement evaluation failed`,
      );
    }
  }

  private async seedCatalogue(): Promise<void> {
    try {
      await this.repo.upsertCatalogue(ACHIEVEMENT_SEED);
      this.logger.log(`[achievement.seed] [end] count=${ACHIEVEMENT_SEED.length} - achievement catalogue seeded`);
    } catch (error) {
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(`[achievement.seed] [fail] error="${errorMessage}" - failed to seed achievement catalogue`);
    }
  }

  onModuleDestroy(): void {
    for (const [eventName, handler] of this.eventHandlers) {
      this.events.removeListener(eventName, handler);
    }
    this.eventHandlers.clear();
  }

  private registerEventListeners(): void {
    const events = [
      ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
      ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
      ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
      ACHIEVEMENT_EVENT_COLLECTION_CREATED,
      ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED,
      ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
      ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
    ];

    for (const eventName of events) {
      const handler = (payload: Record<string, unknown>): void => {
        void this.handleEvent(eventName, payload);
      };
      this.eventHandlers.set(eventName, handler);
      this.events.on(eventName, handler);
    }
  }

  private async sendNotification(userId: number, achievementKey: string): Promise<void> {
    const achievement = await this.repo.findAchievementByKey(achievementKey);
    if (!achievement) return;

    await this.notificationService.notify({
      type: NotificationType.AchievementUnlocked,
      title: 'Achievement Unlocked!',
      message: achievement.name,
      actionUrl: '/statistics?tab=achievements',
      meta: { achievementKey, achievementName: achievement.name, rarity: achievement.rarity, iconName: achievement.iconName },
      scope: { kind: 'user', userId },
    });
  }

  private async evaluateMetaBadges(userId: number, isSuperuser: boolean, earnedKeys: Set<string>, notify: boolean): Promise<void> {
    const metaAwards = await this.registry.evaluate(
      { userId, isSuperuser, eventName: ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED, payload: { userId } },
      earnedKeys,
    );
    for (const award of metaAwards) {
      if (earnedKeys.has(award.key)) continue;
      const row = await this.repo.award(userId, award.key, award.context);
      if (row) {
        earnedKeys.add(award.key);
        if (notify) await this.sendNotification(userId, award.key);
      }
    }
  }

  private async computeProgress(
    userId: number,
    isSuperuser: boolean,
    allAchievements: AchievementRow[],
    earnedMap: Map<string, UserAchievementRow>,
  ): Promise<Map<string, number>> {
    const progressMap = new Map<string, number>();

    const tieredGroups = new Map<string, AchievementRow[]>();
    for (const a of allAchievements) {
      if (a.groupKey && a.tier) {
        const existing = tieredGroups.get(a.groupKey) ?? [];
        existing.push(a);
        tieredGroups.set(a.groupKey, existing);
      }
    }

    const groupsToFetch = Array.from(tieredGroups.entries())
      .filter(([, tiers]) => tiers.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0)).some((t) => !earnedMap.has(t.key)))
      .map(([groupKey]) => groupKey);

    const progressEntries = await Promise.all(
      groupsToFetch.map(async (groupKey) => [groupKey, await this.getProgressForGroup(userId, isSuperuser, groupKey)] as const),
    );

    for (const [groupKey, progress] of progressEntries) {
      if (progress === null) continue;
      const tiers = tieredGroups.get(groupKey) ?? [];
      for (const tier of tiers) {
        if (!earnedMap.has(tier.key)) {
          progressMap.set(tier.key, progress);
        }
      }
    }

    const singleBadgesToFetch = allAchievements.filter((a) => !a.groupKey && a.threshold !== null && !earnedMap.has(a.key));

    await Promise.all(
      singleBadgesToFetch.map(async (a) => {
        const progress = await this.computeSingleBadgeProgress(userId, isSuperuser, a.key);
        if (progress !== null) {
          progressMap.set(a.key, progress);
        }
      }),
    );

    return progressMap;
  }

  private async computeSingleBadgeProgress(userId: number, isSuperuser: boolean, key: string): Promise<number | null> {
    switch (key) {
      case 'marathoner':
        return this.repo.getMaxSessionMinutes(userId);
      case 'binge_reader': {
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return this.repo.countBooksFinishedInDateRange(userId, oneWeekAgo, now);
      }
      case 'curator':
        return this.repo.countCollections(userId);
      case 'author_deep_dive':
        return this.repo.maxBooksPerAuthor(userId);
      case 'multi_format':
        return this.repo.countDistinctFormats(userId, isSuperuser);
      case 'century_span':
        return this.repo.countDistinctCenturiesRead(userId);
      case 'decade_sampler':
        return this.repo.countDistinctDecadesRead(userId);
      case 'short_story_fan':
        return this.repo.countFinishedBooksByMaxPageCount(userId, 100);
      case 'genre_devotee':
        return this.repo.maxBooksPerGenre(userId);
      case 'note_keeper':
        return this.repo.countAnnotationsWithNotes(userId);
      case 'deep_dive_session':
        return this.repo.countAnnotationsOnDay(userId, new Date());
      case 'monthly_reader_2': {
        const now = new Date();
        return this.repo.countBooksFinishedInMonth(userId, now.getUTCFullYear(), now.getUTCMonth() + 1);
      }
      case 'yearly_finisher_12':
        return this.repo.countBooksFinishedInYear(userId, new Date().getUTCFullYear());
      case 'category_sweeper':
        return this.repo.countDistinctEarnedCategories(userId);
      case 'consistent_reader':
        return null;
      case 'weekend_rhythm':
        return null;
      case 'seasonal_reader': {
        const currentYear = new Date().getFullYear();
        return this.repo.countDistinctSeasonsWithReading(userId, currentYear);
      }
      case 'across_the_board':
        return this.repo.countDistinctRatingValues(userId);
      case 'power_hour':
        return this.repo.getMaxSessionPages(userId);
      case 'speed_reader':
        return this.repo.getMaxPagesInADay(userId);
      case 'wordsmith':
        return this.repo.getMaxNoteLength(userId);
      case 'box_of_crayons':
        return this.repo.countDistinctColors(userId);
      case 'full_orbit':
        return this.repo.countDistinctSources(userId);
      case 'two_worlds':
        return this.repo.maxSourcesOnSingleBook(userId);
      default:
        return null;
    }
  }

  private async getProgressForGroup(userId: number, isSuperuser: boolean, groupKey: string): Promise<number | null> {
    switch (groupKey) {
      case 'books_finished':
        return this.repo.countFinishedBooks(userId);
      case 'pages_read':
        return this.repo.sumPagesRead(userId);
      case 'hours_read':
        return this.repo.sumReadingHours(userId);
      case 'library_builder':
        return this.repo.countAccessibleBooks(userId, isSuperuser);
      case 'annotator':
        return this.repo.countAnnotations(userId);
      case 'genre_explorer':
        return this.repo.countDistinctGenresRead(userId);
      case 'polyglot':
        return this.repo.countDistinctLanguagesRead(userId);
      case 'streak':
        return this.repo.getCurrentStreak(userId);
      case 'long_book':
        return this.repo.getMaxFinishedBookPageCount(userId);
      case 'critic':
        return this.repo.countRatings(userId);
      default:
        return null;
    }
  }
}
