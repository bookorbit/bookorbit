import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ReadingHistoryMarks, ReadingHistoryPage, ReadingHistoryRatingResponse, ReadingHistorySummary } from '@bookorbit/types';

import { StatsCache } from '../../common/cache/stats-cache';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { BookService } from '../book/book.service';
import {
  READING_ATTEMPT_CHANGED,
  ReadingAttemptEventsService,
  type ReadingAttemptChangedPayload,
} from '../user-book-status/reading-attempt-events.service';
import type { ReadingHistoryPeriodQueryDto, ReadingHistoryQueryDto } from './dto/reading-history-query.dto';
import { ReadingHistoryRepository, type ReadingHistoryPeriod, type ReadingHistoryScope } from './reading-history.repository';

const DEFAULT_PAGE_SIZE = 100;
const SUMMARY_TTL_MS = 60_000;
const MARKS_PREVIEW = { highlights: 3, journal: 2 };

const pad = (value: number) => String(value).padStart(2, '0');

@Injectable()
export class ReadingHistoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReadingHistoryService.name);
  private readonly summaryCache = new StatsCache({ ttlMs: SUMMARY_TTL_MS, maxEntries: 500 });

  constructor(
    private readonly repo: ReadingHistoryRepository,
    private readonly bookService: BookService,
    private readonly readingAttemptEvents: ReadingAttemptEventsService,
  ) {}

  private readonly onReadingAttemptChanged = ({ userId }: ReadingAttemptChangedPayload): void => {
    if (userId === null) this.summaryCache.clear();
    else this.summaryCache.clearForScopePrefix(`${userId}:`);
  };

  onModuleInit(): void {
    this.readingAttemptEvents.on(READING_ATTEMPT_CHANGED, this.onReadingAttemptChanged);
  }

  onModuleDestroy(): void {
    this.readingAttemptEvents.removeListener(READING_ATTEMPT_CHANGED, this.onReadingAttemptChanged);
  }

  private async scope(user: RequestUser): Promise<ReadingHistoryScope> {
    return {
      userId: user.id,
      libraryIds: await this.repo.getAccessibleLibraryIds(user.id, user.isSuperuser),
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
      timeZone: resolveTimeZone(user.settings?.timezone),
    };
  }

  /** Local-day bounds of a year or one of its quarters; both null for all time. */
  private period(query: ReadingHistoryPeriodQueryDto): ReadingHistoryPeriod {
    if (query.quarter != null && query.year == null) throw new BadRequestException('A quarter needs a year');
    if (query.year == null) return { from: null, until: null };
    if (query.quarter == null) return { from: `${query.year}-01-01`, until: `${query.year + 1}-01-01` };
    const firstMonth = (query.quarter - 1) * 3 + 1;
    const until = query.quarter === 4 ? `${query.year + 1}-01-01` : `${query.year}-${pad(firstMonth + 3)}-01`;
    return { from: `${query.year}-${pad(firstMonth)}-01`, until };
  }

  async list(user: RequestUser, query: ReadingHistoryQueryDto): Promise<ReadingHistoryPage> {
    const scope = await this.scope(user);
    const filter = {
      period: this.period(query),
      outcomes: query.outcomes?.length ? [...new Set(query.outcomes)] : ['completed' as const],
      search: query.search?.trim() || null,
      bookId: query.bookId ?? null,
      sort: query.sort ?? 'newest',
    };
    const offset = query.offset ?? 0;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const [items, total, months] = await Promise.all([
      this.repo.list(scope, filter, offset, limit),
      this.repo.count(scope, filter),
      offset === 0 ? this.repo.months(scope, filter) : Promise.resolve(null),
    ]);
    return { items, offset, limit, total, months };
  }

  async summary(user: RequestUser, query: ReadingHistoryPeriodQueryDto): Promise<ReadingHistorySummary> {
    const scope = await this.scope(user);
    const period = this.period(query);
    const libraryKey = scope.libraryIds === null ? 'all' : [...scope.libraryIds].sort((a, b) => a - b).join(',');
    const key = `${scope.timeZone}:${libraryKey}:${query.year ?? 'all'}:${query.quarter ?? '-'}`;
    return this.summaryCache.get(`${user.id}:`, key, () => this.loadSummary(user, scope, period, query));
  }

  private async loadSummary(
    user: RequestUser,
    scope: ReadingHistoryScope,
    period: ReadingHistoryPeriod,
    query: ReadingHistoryPeriodQueryDto,
  ): Promise<ReadingHistorySummary> {
    const event = 'reading_history.summary';
    const startedAt = Date.now();
    try {
      // Months always span the whole year, so a quarter still shows where it sits in its year.
      const yearPeriod = query.year != null ? this.period({ year: query.year }) : null;
      const [totals, time, completedByMonth, timeByMonth, records, formats, sources, years] = await Promise.all([
        this.repo.totals(scope, period),
        this.repo.readingTimeTotal(scope, period),
        yearPeriod ? this.repo.completedByMonth(scope, yearPeriod) : Promise.resolve([]),
        yearPeriod ? this.repo.readingTimeByMonth(scope, yearPeriod) : Promise.resolve([]),
        this.repo.records(scope, period),
        this.repo.formats(scope, period),
        this.repo.sources(scope, period),
        this.repo.years(scope),
      ]);

      const months: ReadingHistorySummary['months'] = [];
      if (query.year != null) {
        for (let month = 1; month <= 12; month++) {
          const done = completedByMonth.find((row) => row.month === month);
          months.push({
            month,
            reads: done?.reads ?? 0,
            rereads: done?.rereads ?? 0,
            seconds: timeByMonth.find((row) => row.month === month)?.seconds ?? 0,
          });
        }
      }

      const target = Number((user.settings?.dashboardConfig as { readingGoal?: unknown } | undefined)?.readingGoal);
      let goal: ReadingHistorySummary['goal'] = null;
      if (yearPeriod && Number.isInteger(target) && target > 0) {
        const reached = query.quarter == null ? totals.reads : (years.years.find((row) => row.year === query.year)?.reads ?? 0);
        goal = { target, reached, metOn: reached >= target ? await this.repo.goalMetOn(scope, yearPeriod, target) : null };
      }

      return {
        year: query.year ?? null,
        quarter: query.quarter ?? null,
        years: years.years,
        undatedReads: years.undated,
        ...totals,
        seconds: time.seconds,
        daysRead: time.days,
        months,
        records,
        formats,
        sources,
        goal,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[${event}] [fail] userId=${user.id} year=${query.year ?? 'all'} quarter=${query.quarter ?? '-'} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - reading history summary failed`,
      );
      throw error;
    }
  }

  async marks(user: RequestUser, attemptId: number): Promise<ReadingHistoryMarks> {
    const read = await this.repo.findOwnedRead(user.id, attemptId);
    if (!read) throw new NotFoundException('Read not found');
    if (read.bookId === null || read.endedOn === null) return { highlights: [], highlightCount: 0, journal: [], journalCount: 0 };
    const scope = await this.scope(user);
    return this.repo.marks(user.id, { bookId: read.bookId, startedOn: read.startedOn, endedOn: read.endedOn }, scope.timeZone, MARKS_PREVIEW);
  }

  /**
   * Rates one read. The book's rating follows its latest completed read, so rating that read
   * rates the book too, through the same path as rating the book directly.
   */
  async setRating(user: RequestUser, attemptId: number, rating: number | null): Promise<ReadingHistoryRatingResponse> {
    const read = await this.repo.findOwnedRead(user.id, attemptId);
    if (!read) throw new NotFoundException('Read not found');
    await this.repo.setReadRating(user.id, attemptId, rating);
    const bookId = read.latestCompleted ? read.bookId : null;
    if (bookId !== null) await this.bookService.bulkSetRating([bookId], rating, user);
    this.summaryCache.clearForScopePrefix(`${user.id}:`);
    return { rating, bookRatingChanged: bookId !== null };
  }
}
