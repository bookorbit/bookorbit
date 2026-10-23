import { Injectable, Logger } from '@nestjs/common';
import { REQUEST_LANGUAGE_CODES, normalizeLanguage } from '@bookorbit/types';
import type { AchievementHint, AchievementHintResumeTarget, AchievementHintsResponse } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone, toDateKeyInTimeZone } from '../../common/utils/timezone.utils';
import type { RequestUser } from '../../common/types/request-user';
import type { AchievementRow } from '../../db/schema';
import { AchievementRepository } from './achievement.repository';
import { AchievementHintsRepository, type HintBookGroup, type HintResumeRow, type HintScope } from './achievement-hints.repository';
import { OLD_SOUL_BEFORE_YEAR, SHORT_STORY_MAX_PAGES } from './evaluators/exploration.evaluator';
import { SLOW_BURN_DAYS } from './evaluators/reading.evaluator';

const DAY_MS = 86_400_000;
const PACE_DAYS = 30;
const NEARLY_FINISHED_PERCENT = 90;
const HINT_BOOK_LIMIT = 3;

type HintBuilder = (target: AchievementRow) => Promise<AchievementHint | null>;

/**
 * "How to get it" hints for achievements that are still locked, drawn from the user's own library and
 * reading history. Separate from the catalogue so the page never waits on them, and best effort: a hint
 * whose query fails is left out rather than failing the rest.
 */
@Injectable()
export class AchievementHintsService {
  private readonly logger = new Logger(AchievementHintsService.name);

  constructor(
    private readonly achievements: AchievementRepository,
    private readonly hints: AchievementHintsRepository,
  ) {}

  async getHints(user: RequestUser): Promise<AchievementHintsResponse> {
    const [catalogue, earnedKeys] = await Promise.all([this.achievements.findAllAchievements(), this.achievements.findUserEarnedKeys(user.id)]);
    const targets = nextTargets(catalogue, earnedKeys);
    const scope: HintScope = { userId: user.id, isSuperuser: user.isSuperuser, contentFilters: user.isSuperuser ? undefined : user.contentFilters };
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');

    let unrated: Promise<HintBookGroup> | null = null;
    const unratedFinished = (): Promise<HintBookGroup> => (unrated ??= this.hints.findUnratedFinished(scope));

    const builders: Record<string, HintBuilder> = {
      hours_read: (target) => this.readingPace(user.id, target),
      books_finished: (target) => this.nearlyFinished(scope, target),
      long_book: (target) => this.longBooks(scope, target),
      slow_burn: (target) => this.stalledBook(scope, target),
      critic: (target) => this.unrated(target, unratedFinished),
      first_verdict: (target) => this.unrated(target, unratedFinished),
      decade_sampler: (target) => this.period(scope, target, 10),
      century_span: (target) => this.period(scope, target, 100),
      short_story_fan: (target) => this.shortBooks(scope, target),
      old_soul: (target) => this.oldBooks(scope, target),
      author_deep_dive: (target) => this.author(scope, target),
      polyglot: (target) => this.language(scope, target),
      year_round_reader: (target) => this.monthsLeft(user.id, timeZone, target),
    };

    const built = await Promise.all(
      Object.entries(builders).flatMap(([id, build]) => {
        const target = targets.get(id);
        return target ? [this.settle(user.id, target.key, () => build(target))] : [];
      }),
    );
    return { hints: built.filter((hint): hint is AchievementHint => hint !== null) };
  }

  private async settle(userId: number, key: string, build: () => Promise<AchievementHint | null>): Promise<AchievementHint | null> {
    const startedAt = Date.now();
    try {
      return await build();
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[achievement.hint] [fail] userId=${userId} key=${key} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - hint left out`,
      );
      return null;
    }
  }

  private async readingPace(userId: number, target: AchievementRow): Promise<AchievementHint | null> {
    const since = new Date(Date.now() - PACE_DAYS * DAY_MS);
    const [seconds, totalHours] = await Promise.all([this.hints.sumReadingSecondsSince(userId, since), this.achievements.sumReadingHours(userId)]);
    const hours = seconds / 3600;
    const remaining = (target.threshold ?? 0) - totalHours;
    if (hours < 1 || remaining <= 0) return null;
    return {
      key: target.key,
      kind: 'reading_pace',
      values: { hours: Math.round(hours), days: PACE_DAYS, remaining, etaDays: Math.ceil((remaining * PACE_DAYS) / hours) },
    };
  }

  private async nearlyFinished(scope: HintScope, target: AchievementRow): Promise<AchievementHint | null> {
    const group = await this.hints.findNearlyFinished(scope, NEARLY_FINISHED_PERCENT);
    if (group.count === 0) return null;
    return {
      key: target.key,
      kind: 'nearly_finished',
      count: group.count,
      bookIds: group.bookIds,
      bookTitles: group.bookTitles,
      values: { minPercent: NEARLY_FINISHED_PERCENT, resume: resumeTarget(group.lead) },
    };
  }

  private async longBooks(scope: HintScope, target: AchievementRow): Promise<AchievementHint | null> {
    const pages = target.threshold;
    if (!pages) return null;
    const group = await this.hints.findUnfinishedByPageCount(scope, { atLeast: pages });
    if (group.count === 0) return { key: target.key, kind: 'unavailable', values: { reason: 'no_long_book', pages } };
    return {
      key: target.key,
      kind: 'long_books',
      count: group.count,
      bookIds: group.bookIds,
      bookTitles: group.bookTitles,
      values: { minPages: pages },
    };
  }

  private async stalledBook(scope: HintScope, target: AchievementRow): Promise<AchievementHint | null> {
    const book = await this.hints.findStalledBook(scope, new Date(Date.now() - SLOW_BURN_DAYS * DAY_MS));
    if (!book?.startedAt) return null;
    const title = book.title?.trim() || null;
    return {
      key: target.key,
      kind: 'stalled_book',
      count: book.total,
      bookIds: [book.bookId],
      bookTitles: [title],
      values: {
        title,
        percent: book.percent === null ? null : Math.floor(book.percent),
        startedAt: book.startedAt.toISOString(),
        resume: resumeTarget(book),
      },
    };
  }

  private async unrated(target: AchievementRow, load: () => Promise<HintBookGroup>): Promise<AchievementHint | null> {
    const group = await load();
    if (group.count === 0) return null;
    return { key: target.key, kind: 'unrated_finished', count: group.count, bookIds: group.bookIds, bookTitles: group.bookTitles, values: {} };
  }

  private async period(scope: HintScope, target: AchievementRow, years: 10 | 100): Promise<AchievementHint | null> {
    const needed = target.threshold;
    if (!needed) return null;
    const finished = await this.hints.findFinishedPeriods(scope.userId, years);
    // Before a first finished book the advice is just to finish one, and the query would span the whole library.
    if (finished.length === 0) return null;
    const groups = await this.hints.findUnfinishedByPeriod(scope, years, finished);
    const reachable = finished.length + groups.length;
    if (reachable < needed) return { key: target.key, kind: 'unavailable', values: { reason: 'too_few_periods', years, reachable } };
    const best = groups[0];
    if (!best) return null;
    return {
      key: target.key,
      kind: 'period_unread',
      count: best.count,
      bookIds: best.bookIds,
      bookTitles: best.bookTitles,
      values: { period: best.period, years },
    };
  }

  private async shortBooks(scope: HintScope, target: AchievementRow): Promise<AchievementHint | null> {
    const group = await this.hints.findUnfinishedByPageCount(scope, { below: SHORT_STORY_MAX_PAGES });
    if (group.count === 0) return null;
    return {
      key: target.key,
      kind: 'short_books',
      count: group.count,
      bookIds: group.bookIds,
      bookTitles: group.bookTitles,
      values: { maxPages: SHORT_STORY_MAX_PAGES, inProgress: group.inProgress },
    };
  }

  private async oldBooks(scope: HintScope, target: AchievementRow): Promise<AchievementHint | null> {
    const group = await this.hints.findUnfinishedPublishedBefore(scope, OLD_SOUL_BEFORE_YEAR);
    if (group.count === 0) return { key: target.key, kind: 'unavailable', values: { reason: 'nothing_before_year', year: OLD_SOUL_BEFORE_YEAR } };
    return {
      key: target.key,
      kind: 'old_books',
      count: group.count,
      bookIds: group.bookIds,
      bookTitles: group.bookTitles,
      values: { year: OLD_SOUL_BEFORE_YEAR },
    };
  }

  private async author(scope: HintScope, target: AchievementRow): Promise<AchievementHint | null> {
    if (!target.threshold) return null;
    const author = await this.hints.findAuthorToDeepen(scope, target.threshold);
    if (!author || author.count === 0) return null;
    return {
      key: target.key,
      kind: 'author_unread',
      count: author.count,
      bookIds: author.bookIds,
      bookTitles: author.bookTitles,
      values: { authorId: author.authorId, author: author.name, finished: author.finished },
    };
  }

  /**
   * Polyglot counts stored language values, so "en" and "English" already count as two. A hint that
   * suggested "en-US" to someone who reads English would be gaming that, so languages are compared as one
   * key per language here, and the hint names a language the user has not read at all.
   */
  private async language(scope: HintScope, target: AchievementRow): Promise<AchievementHint | null> {
    const finished = await this.hints.findFinishedLanguages(scope.userId);
    if (finished.length === 0) return null;
    const groups = await this.hints.findUnfinishedByLanguage(scope, finished);
    const finishedKeys = new Set(finished.map(languageKey));
    const merged = new Map<string, HintBookGroup>();
    for (const group of groups) {
      const key = languageKey(group.language);
      if (!key || finishedKeys.has(key)) continue;
      const entry = merged.get(key) ?? { count: 0, bookIds: [], bookTitles: [] };
      entry.count += group.count;
      entry.bookIds.push(...group.bookIds);
      entry.bookTitles.push(...group.bookTitles);
      merged.set(key, entry);
    }
    const [language, best] = [...merged.entries()].sort((a, b) => b[1].count - a[1].count)[0] ?? [];
    if (!language || !best) return null;
    return {
      key: target.key,
      kind: 'language_unread',
      count: best.count,
      bookIds: best.bookIds.slice(0, HINT_BOOK_LIMIT),
      bookTitles: best.bookTitles.slice(0, HINT_BOOK_LIMIT),
      values: { language },
    };
  }

  private async monthsLeft(userId: number, timeZone: string, target: AchievementRow): Promise<AchievementHint | null> {
    const [year, month] = toDateKeyInTimeZone(new Date(), timeZone).split('-').map(Number);
    const read = new Set(await this.hints.findMonthsWithReading(userId, year));
    for (let past = 1; past < month; past++) {
      if (!read.has(past)) return { key: target.key, kind: 'unavailable', values: { reason: 'missed_month', year, month: past } };
    }
    const months: number[] = [];
    for (let ahead = month; ahead <= 12; ahead++) if (!read.has(ahead)) months.push(ahead);
    if (months.length === 0) return null;
    return { key: target.key, kind: 'months_left', count: months.length, values: { year, monthsRead: read.size, months } };
  }
}

/**
 * The achievement each hint speaks to, by group key for tier sets (its lowest unearned tier) and by key
 * for single achievements. Earned and still-secret achievements get none.
 */
export function nextTargets(catalogue: AchievementRow[], earnedKeys: Set<string>): Map<string, AchievementRow> {
  const targets = new Map<string, AchievementRow>();
  for (const row of catalogue) {
    if (earnedKeys.has(row.key) || row.hidden) continue;
    const id = row.groupKey ?? row.key;
    const current = targets.get(id);
    if (!current || (row.tier ?? 0) < (current.tier ?? 0)) targets.set(id, row);
  }
  return targets;
}

let languagesByName: Map<string, string> | null = null;

/**
 * One key per language, so "en", "eng", "en-US" and "English" agree. Null for values that name no
 * language, like "und".
 */
export function languageKey(value: string): string | null {
  const lowered = value.trim().toLowerCase();
  if (!lowered || lowered === 'und' || lowered === 'mul' || lowered === 'zxx') return null;
  if (!languagesByName) {
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    languagesByName = new Map(REQUEST_LANGUAGE_CODES.map((code) => [(names.of(code) ?? code).toLowerCase(), code]));
  }
  const code = languagesByName.get(lowered) ?? normalizeLanguage(lowered);
  return /^[a-z]{2}$/.test(code) ? code : null;
}

function resumeTarget(row: HintResumeRow | null): AchievementHintResumeTarget | null {
  return row?.fileId ? { bookId: row.bookId, fileId: row.fileId, format: row.format } : null;
}
