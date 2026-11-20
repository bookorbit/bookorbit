import { Injectable, NotFoundException } from '@nestjs/common';
import type { JobSubject } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { BookJobSubjectsRepository } from './book-job-subjects.repository';
import { BookService } from './book.service';

const REACH_CONCURRENCY = 4;

export interface BookSubjectViewer {
  user: RequestUser;
  /** Sees everyone's jobs of the type, so every subject is named, as the AI queue does for managers. */
  manages: boolean;
}

/** A book's cover thumbnail, versioned so a new cover is fetched again. */
export function bookThumbnailUrl(bookId: number, coverUpdatedAt: Date | null): string {
  const version = coverUpdatedAt ? `?t=${coverUpdatedAt.getTime()}` : '';
  return `/api/v1/books/${bookId}/thumbnail${version}`;
}

/**
 * Names the books a page of jobs is about. A viewer who does not manage the type sees a book only
 * while they can still reach it; a book they lost, or one since deleted, is left out and the row
 * falls back to neutral text.
 */
@Injectable()
export class BookJobSubjects {
  constructor(
    private readonly repository: BookJobSubjectsRepository,
    private readonly books: BookService,
  ) {}

  async describe(bookIds: readonly number[], viewer: BookSubjectViewer): Promise<Map<number, JobSubject>> {
    const distinct = [...new Set(bookIds.filter(Number.isSafeInteger))];
    const [found, reachable] = await Promise.all([this.repository.find(distinct), viewer.manages ? null : this.reachable(distinct, viewer.user)]);
    const subjects = new Map<number, JobSubject>();
    for (const [bookId, book] of found) {
      if (reachable && !reachable.has(bookId)) continue;
      subjects.set(bookId, {
        label: book.title,
        byline: book.authors.length > 0 ? book.authors.join(', ') : null,
        url: `/book/${bookId}`,
        image: bookThumbnailUrl(bookId, book.coverUpdatedAt),
      });
    }
    return subjects;
  }

  private async reachable(bookIds: number[], user: RequestUser): Promise<Set<number>> {
    const reached = await mapWithConcurrency(bookIds, REACH_CONCURRENCY, async (bookId) => {
      try {
        await this.books.verifyBookAccess(bookId, user);
        return bookId;
      } catch (error) {
        if (error instanceof NotFoundException) return null;
        throw error;
      }
    });
    return new Set(reached.filter((id): id is number => id !== null));
  }
}
