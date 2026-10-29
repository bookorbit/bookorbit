import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHAPTER_HEALTH_CATEGORIES,
  type ChapterHealthPage,
  type ChapterHealthSummary,
  type ChapterLookupQueueState,
  type ChapterLookupReviewReason,
  type EnqueueChapterLookupResult,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import { ChapterHealthRepository } from './chapter-health.repository';
import type { ChapterHealthListDto, EnqueueChapterLookupDto } from './dto/chapter-health.dto';

const DEFAULT_PAGE_SIZE = 50;
/** One request queues at most this many books from a category; the rest can be queued after. */
const MAX_CATEGORY_ENQUEUE = 5_000;
const REVIEW_REASONS = new Set<string>(['runtime_mismatch', 'not_exact', 'implausible', 'unknown_length', 'locked']);

/** The Chapter health tool: audiobooks whose chapters need attention, and bulk Audible lookups for them. */
@Injectable()
export class ChapterHealthService {
  constructor(
    private readonly repo: ChapterHealthRepository,
    private readonly libraryService: LibraryService,
  ) {}

  async summary(user: RequestUser, libraryId?: number): Promise<ChapterHealthSummary> {
    const totals = await this.repo.summarize(await this.libraryIds(user, libraryId), user.isSuperuser ? undefined : user.contentFilters);
    const counts = {} as ChapterHealthSummary['counts'];
    const withAsin = {} as ChapterHealthSummary['withAsin'];
    for (const category of CHAPTER_HEALTH_CATEGORIES) {
      counts[category] = totals[category].total;
      withAsin[category] = totals[category].withAsin;
    }
    return { counts, withAsin };
  }

  async list(user: RequestUser, dto: ChapterHealthListDto): Promise<ChapterHealthPage> {
    const pageSize = dto.pageSize ?? DEFAULT_PAGE_SIZE;
    const offset = ((dto.page ?? 1) - 1) * pageSize;
    const { rows, total } = await this.repo.list(
      await this.libraryIds(user, dto.libraryId),
      dto.category,
      offset,
      pageSize,
      user.isSuperuser ? undefined : user.contentFilters,
    );
    return {
      total,
      items: rows.map((row) => ({
        bookId: row.bookId,
        title: row.title,
        authors: row.authors,
        libraryName: row.libraryName,
        audioFiles: row.audioFiles,
        chapterCount: row.chapterCount,
        source: row.source,
        audibleId: row.audibleId,
        review:
          dto.category === 'needs_review'
            ? {
                reason: row.reviewReason && REVIEW_REASONS.has(row.reviewReason) ? (row.reviewReason as ChapterLookupReviewReason) : null,
                summary: row.reviewResult,
              }
            : null,
      })),
    };
  }

  /** Queues lookups for chosen books, or for every book with an ASIN in a category. Books out of reach are left out. */
  async enqueue(user: RequestUser, dto: EnqueueChapterLookupDto): Promise<EnqueueChapterLookupResult> {
    const libraryIds = await this.libraryIds(user, dto.libraryId);
    let bookIds: number[];
    let requested: number;
    if (dto.bookIds) {
      const unique = [...new Set(dto.bookIds)];
      bookIds = await this.repo.filterLookupCandidates(libraryIds, unique, user.isSuperuser ? undefined : user.contentFilters);
      requested = unique.length;
    } else if (dto.category) {
      bookIds = await this.repo.findLookupCandidates(
        libraryIds,
        dto.category,
        MAX_CATEGORY_ENQUEUE,
        user.isSuperuser ? undefined : user.contentFilters,
      );
      requested = bookIds.length;
    } else {
      throw new BadRequestException('Choose books or a category to look up');
    }
    const queued = await this.repo.enqueue(bookIds, user.id);
    return { queued, skipped: requested - queued };
  }

  async state(user: RequestUser): Promise<ChapterLookupQueueState> {
    const { counts, processing } = await this.repo.stateFor(user.id, await this.libraryIds(user), user.isSuperuser ? undefined : user.contentFilters);
    return {
      queued: counts.get('queued') ?? 0,
      processing,
      finished: {
        applied: counts.get('applied') ?? 0,
        review: counts.get('review') ?? 0,
        not_found: counts.get('not_found') ?? 0,
        failed: counts.get('failed') ?? 0,
        skipped: counts.get('skipped') ?? 0,
      },
    };
  }

  async cancel(user: RequestUser): Promise<{ removed: number }> {
    return { removed: await this.repo.removeQueued(user.id) };
  }

  async clearFinished(user: RequestUser): Promise<{ removed: number }> {
    return { removed: await this.repo.removeFinished(user.id) };
  }

  async dismissReview(user: RequestUser, bookId: number): Promise<void> {
    const removed = await this.repo.dismissReview(bookId, await this.libraryIds(user), user.isSuperuser ? undefined : user.contentFilters);
    if (!removed) throw new NotFoundException('No review waits for that book');
  }

  /** The tool changes chapters, so it only covers libraries the user may edit. */
  private async libraryIds(user: RequestUser, libraryId?: number): Promise<number[]> {
    const editable = await this.libraryService.findEditableLibraryIds(user);
    if (libraryId === undefined) return editable;
    if (!editable.includes(libraryId)) throw new ForbiddenException('You cannot edit this library');
    return [libraryId];
  }
}
