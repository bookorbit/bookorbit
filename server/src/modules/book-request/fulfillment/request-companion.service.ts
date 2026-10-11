import { Injectable, Logger } from '@nestjs/common';
import type { BookRequestMediaKind, BookRequestStatus } from '@bookorbit/types';

import type { BookRequestRow } from '../../../db/schema';
import { BookRequestNotifier } from '../book-request-notifier.service';
import { BookRequestRepository } from '../book-request.repository';

/**
 * Where a companion can be settled from when the half that just landed brought its format too:
 * anywhere before a release was grabbed for it. A grab in flight is somebody's decision about which
 * copy to fetch, and it keeps running.
 */
const COMPANION_SETTLEABLE_STATUSES: readonly BookRequestStatus[] = ['pending', 'approved', 'searching'];

/** The existing book a request's files become another format of, and where that book lives. */
export interface BookJoin {
  libraryId: number;
  folderId: number;
  /** `coverUrl` is the art the request chose for its format, for when the files carry none. */
  joinBook: { bookId: number; folderPath: string; coverUrl: string | null };
}

/**
 * What ties the two halves of an ebook and audiobook pair together once they start arriving: the
 * book the second half should join, and what the first half landing means for the second.
 *
 * Also answers for a request made from a book's page, which names the book it should join directly.
 */
@Injectable()
export class RequestCompanionService {
  private readonly logger = new Logger(RequestCompanionService.name);

  constructor(
    private readonly requests: BookRequestRepository,
    private readonly notifier: BookRequestNotifier,
  ) {}

  /**
   * The existing book this request's files should become another format of, if there is one to join.
   *
   * Either the book the request names, which it follows wherever that book now lives, or the book
   * its companion already landed as, when that is in the library this request is headed for. Never
   * a book that already has this format - that would be a second copy of it, not a second format -
   * and never in a library where a book is a single file, because there is no folder to share.
   */
  async resolveJoin(request: BookRequestRow): Promise<BookJoin | null> {
    let bookId = request.targetBookId;
    const followsBook = bookId !== null;

    if (bookId === null && request.companionRequestId !== null) {
      const companion = (await this.requests.findById(request.companionRequestId))?.request;
      if (companion?.companionRequestId === request.id && companion.status === 'available') bookId = companion.matchedBookId;
    }
    if (bookId === null) return null;

    const placement = await this.requests.findBookPlacement(bookId);
    if (!placement || placement.status !== 'present' || placement.organizationMode !== 'book_per_folder') return null;
    if (!followsBook && placement.libraryId !== request.targetLibraryId) return null;
    if ((await this.requests.findBookMediaKinds(bookId)).has(request.mediaKind as BookRequestMediaKind)) return null;

    return {
      libraryId: placement.libraryId,
      folderId: placement.libraryFolderId,
      joinBook: { bookId, folderPath: placement.folderPath, coverUrl: request.coverUrl },
    };
  }

  /**
   * What one half of a pair landing as `bookId` means for the other half.
   *
   * A release can carry both formats, and with "all available" both were just filed together. A
   * companion that has not started downloading is then already satisfied, so it is settled here
   * rather than left to fetch a second copy. Otherwise the companion is pointed at this book, so
   * when it does arrive it joins it instead of landing wherever its own metadata would file it.
   *
   * Returns whether the companion was settled, so the caller knows a second request changed.
   */
  async handOn(request: BookRequestRow, bookId: number): Promise<boolean> {
    if (request.companionRequestId === null) return false;
    const companion = (await this.requests.findById(request.companionRequestId))?.request;
    if (!companion || companion.companionRequestId !== request.id) return false;

    const media = await this.requests.findBookMediaKinds(bookId);
    if (media.has(companion.mediaKind as BookRequestMediaKind)) {
      const settled = await this.requests.updateIf(companion.id, COMPANION_SETTLEABLE_STATUSES, {
        status: 'available',
        matchedBookId: bookId,
        targetBookId: null,
        statusReason: null,
      });
      if (!settled) return false;
      this.logger.log(
        `[book_request.companion_settled] [end] requestId=${companion.id} bookId=${bookId} companionOf=${request.id} - the other half of a pair arrived with this one`,
      );
      await this.notifier.notifyBookAvailable(companion.id, bookId, {
        title: 'Your requested book is available',
        message: `"${companion.title}" is ready`,
        meta: { requestId: companion.id, bookId },
      });
      return true;
    }

    const placement = await this.requests.findBookPlacement(bookId);
    if (!placement || placement.organizationMode !== 'book_per_folder' || placement.libraryId !== companion.targetLibraryId) return false;
    await this.requests.setTargetBookIfUnset(companion.id, bookId);
    return false;
  }
}
