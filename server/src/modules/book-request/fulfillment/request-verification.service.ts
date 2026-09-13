import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { basename } from 'path';
import { DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS, NotificationType, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES } from '@bookorbit/types';
import type {
  BookDockMetadata,
  BookRequestStatus,
  BookRequestReview,
  BookRequestReviewFile,
  BookRequestVerificationReason,
  BookRequestVerificationRow,
  BookRequestVerificationVerdict,
} from '@bookorbit/types';

import { normalizeMetadataIsbn } from '../../../common/text-match/isbn-normalize';
import { mainTitlePart, symmetricTitleSimilarity } from '../../../common/text-match/title-match';
import type { RequestUser } from '../../../common/types/request-user';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestDownloadRow, BookRequestRow } from '../../../db/schema';
import { BookDockEventsService, BOOK_DOCK_FILE_INGESTED } from '../../book-dock/book-dock-events.service';
import { BookDockFinalizeService } from '../../book-dock/book-dock-finalize.service';
import { BookDockRepository } from '../../book-dock/book-dock.repository';
import { BookDockService } from '../../book-dock/book-dock.service';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestNotifier } from '../book-request-notifier.service';
import { BookRequestRepository } from '../book-request.repository';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { RequestAutomationSettingsService } from './request-automation-settings.service';
import { RequestFulfillmentService } from './request-fulfillment.service';

/**
 * Below this, the imported file is held in the dock for a human to look at rather than filed.
 * Deliberately forgiving: subtitles, series suffixes and translated editions all cost points, and
 * the cost of a false hold is one click while the cost of a false pass is a wrong book in a
 * library.
 *
 * The operator can move it, because the right number depends on an instance's own trackers and
 * metadata providers and cannot be guessed from here. This is the value they start from.
 */
const DEFAULT_VERIFICATION_THRESHOLD = DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS.verificationThreshold;

const TITLE_WEIGHT = 0.7;
const AUTHOR_WEIGHT = 0.3;

/**
 * The two statuses a finished import may be filed from: the automatic path arrives at `importing`,
 * and an approver force-filing a held one arrives at `needs_review`. Anything else has been settled
 * by a person, and their decision outranks a score that finished after they made it.
 */
const FILEABLE_FROM: readonly BookRequestStatus[] = ['importing', 'needs_review'];

export interface VerificationOutcome {
  score: number;
  passed: boolean;
  /** Prose, for the stored failure reason and the logs. The client localizes from `code` instead. */
  reason: string;
  code: BookRequestVerificationReason;
  rows: BookRequestVerificationRow[];
}

/**
 * Scores the imported file against the **request snapshot**, which is not what
 * `book_dock_files.confidence` measures.
 *
 * `computeConfidence(embedded, fetched)` compares the file's own metadata against what the
 * providers returned for it: internal consistency. Request Dune, receive Dune Messiah, and both
 * sides agree on Dune Messiah for a confidence of 95. That score is structurally incapable of
 * catching a wrong-book grab, which is the one failure this step exists for.
 */
@Injectable()
export class RequestVerificationService implements OnModuleInit {
  private readonly logger = new Logger(RequestVerificationService.name);

  constructor(
    private readonly events: BookDockEventsService,
    private readonly dockRepo: BookDockRepository,
    private readonly dock: BookDockService,
    private readonly finalizeService: BookDockFinalizeService,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly requests: BookRequestRepository,
    private readonly fulfillment: RequestFulfillmentService,
    private readonly notifier: BookRequestNotifier,
    private readonly gateway: BookRequestGateway,
    private readonly settings: RequestAutomationSettingsService,
  ) {}

  onModuleInit(): void {
    this.events.on(BOOK_DOCK_FILE_INGESTED, (fileId: number) => {
      void this.handleIngested(fileId).catch((err: unknown) => {
        const message = sanitizeLogValue(err instanceof Error ? err.message : String(err));
        this.logger.error(`[book_request.verify] [fail] dockFileId=${fileId} error="${message}" - verification handler failed`);
      });
    });
  }

  private async handleIngested(fileId: number): Promise<void> {
    // Every dock ingest fires this. Rows nobody requested are not ours and ride the generic path.
    const download = await this.downloads.findByBookDockFileId(fileId);
    if (!download || download.status !== 'importing') return;

    const joined = await this.requests.findById(download.requestId);
    if (!joined) {
      await this.fulfillment.failDownload(download, 'The request this download belongs to no longer exists');
      return;
    }

    const row = await this.dockRepo.findById(fileId);
    if (!row) {
      await this.fulfillment.failDownload(download, 'The Book Dock entry for this download disappeared');
      return;
    }

    const { verificationEnabled, verificationThreshold } = await this.settings.get();
    // Off means the operator has chosen to trust the grab: the import goes straight into the
    // target library without waiting on a score, and nothing is ever held for a human to look at.
    if (!verificationEnabled) {
      this.logger.log(
        `[book_request.verify] [end] requestId=${joined.request.id} dockFileId=${fileId} enabled=false - verification is off, filing the import as grabbed`,
      );
      await this.finalize(download, joined.request, fileId);
      return;
    }

    const outcome = verifyAgainstRequest(joined.request, row.fetchedMetadata, row.embeddedMetadata, verificationThreshold, unitTitleFallback(row));
    this.logger.log(
      `[book_request.verify] [end] requestId=${joined.request.id} dockFileId=${fileId} score=${outcome.score} passed=${outcome.passed} - ${outcome.reason}`,
    );

    if (!outcome.passed) {
      await this.holdForReview(download, joined.request, outcome);
      return;
    }

    await this.finalize(download, joined.request, fileId);
  }

  private async finalize(download: BookRequestDownloadRow, request: BookRequestRow, fileId: number): Promise<void> {
    const filed = await this.fileIntoLibrary(download, request, fileId);
    if (!filed.ok) await this.fulfillment.holdForReview(download, request, filed.reason);
  }

  /**
   * The filing step with no opinion on what a failure means. The automatic path turns a failure
   * into another hold; an approver who force-filed one wants the message thrown back at them
   * instead, and neither should have to reimplement the half that works.
   */
  private async fileIntoLibrary(
    download: BookRequestDownloadRow,
    request: BookRequestRow,
    fileId: number,
  ): Promise<{ ok: true; bookId: number | null } | { ok: false; reason: string }> {
    // A request with no folder still has a library; take its first folder rather than falling
    // through to the Book Dock's global default, which is usually unset and never the point here.
    const folderId = request.targetFolderId ?? (await this.resolveFolder(request.targetLibraryId));
    if (folderId === null) return { ok: false, reason: 'the destination library has no folder to file the book into' };

    const result = await this.finalizeService.finalizeManagedFile(fileId, {
      libraryId: request.targetLibraryId ?? undefined,
      folderId,
    });
    if (!result.success) return { ok: false, reason: result.message ?? 'the Book Dock could not file this book' };

    // Conditional, like every other write in the pipeline. Scoring an import and handing it to the
    // Book Dock takes long enough for somebody to cancel the request underneath it, and an
    // unconditional `available` here would undo their decision and tell the requester their book
    // had arrived. The file is already placed by this point, which is why the refusal is logged
    // rather than swallowed: the library has a book the request no longer claims.
    const filed = await this.requests.updateIf(request.id, FILEABLE_FROM, {
      status: 'available',
      matchedBookId: result.bookId ?? null,
      bookDockFileId: null,
      statusReason: null,
    });
    if (!filed) {
      // The bytes did become a book, so the attempt is settled either way rather than left for the
      // resume sweep to offer up again every fifteen seconds.
      await this.downloads.updateIf(download.id, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, { status: 'imported', importedAt: new Date() });
      this.logger.warn(
        `[book_request.verify] [fail] requestId=${request.id} downloadId=${download.id} dockFileId=${fileId} bookId=${result.bookId ?? 'none'} - the request was settled while this import was being filed, so the book was filed but the request was left alone`,
      );
      this.gateway.emitChanged();
      return { ok: false, reason: 'the request was settled while this import was being filed' };
    }

    if (!(await this.downloads.updateIf(download.id, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, { status: 'imported', importedAt: new Date() }))) {
      this.logger.warn(
        `[book_request.verify] [fail] requestId=${request.id} downloadId=${download.id} - the attempt was settled while its import was being filed, so it keeps the outcome it reached`,
      );
    }

    await this.notifier.notifyBookAvailable(request.id, result.bookId ?? null, {
      title: 'Your requested book is available',
      message: `"${request.title}" is ready`,
      meta: { requestId: request.id, bookId: result.bookId ?? null },
    });
    this.gateway.emitChanged();

    return { ok: true, bookId: result.bookId ?? null };
  }

  /**
   * What the drawer shows an approver about a held import: the files that actually landed, and
   * the field-by-field comparison behind the score.
   *
   * The score is recomputed rather than replayed from the hold, so an approver who corrects the
   * metadata in the Book Dock and comes back sees the corrected number instead of the stale one
   * that sent them there.
   */
  async getReview(requestId: number): Promise<BookRequestReview> {
    const { request, fileId } = await this.loadHeld(requestId);

    const row = fileId === null ? undefined : await this.dockRepo.findById(fileId);
    const canFile = (request.targetFolderId ?? (await this.resolveFolder(request.targetLibraryId))) !== null;

    // Filing or discarding the entry by hand empties both pointers to it, which leaves the request
    // held over a file that is not there any more. Saying so is the only useful thing left.
    if (!row) {
      return { requestId, bookDockFileId: null, verification: null, files: [], totalSizeBytes: null, canFile: false };
    }

    const [unitFiles, settings] = await Promise.all([
      row.unitDirectory ? this.dockRepo.findUnitFiles(row.id) : Promise.resolve([]),
      this.settings.get(),
    ]);

    // A loose single file has no unit rows, and the anchor already describes it completely.
    const files: BookRequestReviewFile[] = unitFiles.length
      ? unitFiles.map((file) => ({
          fileName: file.fileName,
          fileSize: file.fileSize === null ? null : Number(file.fileSize),
          format: file.format,
          role: file.role as BookRequestReviewFile['role'],
        }))
      : [{ fileName: row.fileName, fileSize: row.fileSize === null ? null : Number(row.fileSize), format: row.format, role: 'content' }];

    const sized = files.filter((file) => file.fileSize !== null);
    const outcome = settings.verificationEnabled
      ? verifyAgainstRequest(request, row.fetchedMetadata, row.embeddedMetadata, settings.verificationThreshold, unitTitleFallback(row))
      : null;

    return {
      requestId,
      bookDockFileId: row.id,
      verification: outcome
        ? {
            score: outcome.score,
            threshold: settings.verificationThreshold,
            passed: outcome.passed,
            reason: outcome.code,
            rows: outcome.rows,
          }
        : null,
      files,
      totalSizeBytes: sized.length ? sized.reduce((total, file) => total + (file.fileSize ?? 0), 0) : null,
      canFile,
    };
  }

  /**
   * An approver has looked at a held import and decided it is the right book anyway. Runs exactly
   * the filing a passing score would have run. The score is not rewritten on the way through: it
   * was right about what it measured, and this is a human overruling it rather than correcting it.
   */
  async fileHeldImport(requestId: number, user: RequestUser): Promise<void> {
    const { request, download, fileId } = await this.loadHeld(requestId);
    if (fileId === null || download === null) {
      throw new BadRequestException('The Book Dock entry this request was held over is gone, so there is nothing left to file');
    }

    const filed = await this.fileIntoLibrary(download, request, fileId);
    if (!filed.ok) {
      this.logger.warn(
        `[book_request.force_file] [fail] requestId=${requestId} dockFileId=${fileId} userId=${user.id} error="${sanitizeLogValue(filed.reason)}" - approver could not file the held import`,
      );
      throw new BadRequestException(`This import could not be filed: ${filed.reason}`);
    }

    this.logger.log(
      `[book_request.force_file] [end] requestId=${requestId} dockFileId=${fileId} bookId=${filed.bookId ?? 'none'} userId=${user.id} - approver filed a held import`,
    );
  }

  /**
   * The other answer to a held import: this is the wrong book, so throw it away.
   *
   * Filing needs a destination and Book Dock permissions the fulfiller may not hold, and until now
   * the only alternative was cancelling the request, which left the dock entry behind as an orphan
   * nobody would ever connect back to a request. Discarding removes the entry through the dock's
   * own primitive, so the staged files are cleaned up exactly as a hand discard cleans them up,
   * and fails the request so it stops claiming a person's attention.
   *
   * The torrent is deliberately untouched. Removing a seed is its own explicit action with its own
   * confirmation, and a discard is a statement about the import rather than about the transfer.
   */
  async discardHeldImport(requestId: number, user: RequestUser): Promise<void> {
    const { request, download, fileId } = await this.loadHeld(requestId);
    const reason = 'The imported file was discarded during review';
    const startedAt = Date.now();

    const claimed = await this.requests.updateIf(requestId, ['needs_review'], {
      status: 'failed',
      statusReason: reason,
      failureCode: null,
      failureMeta: null,
    });
    if (!claimed) {
      throw new BadRequestException('This request is no longer waiting for review');
    }

    const claimedDownload = download
      ? await this.downloads.updateIf(download.id, ['needs_review'], { status: 'failed', errorMessage: reason })
      : undefined;
    if (download && !claimedDownload) {
      await this.requests.updateIf(requestId, ['failed'], {
        status: 'needs_review',
        statusReason: request.statusReason,
        failureCode: request.failureCode,
        failureMeta: request.failureMeta,
      });
      throw new BadRequestException('This import is no longer waiting for review');
    }

    try {
      if (fileId !== null) {
        // The request route already authorized this destructive action. Passing the dock's
        // all-files scope is what lets a moderator or self-fulfiller clean up an import uploaded
        // by the pipeline even when they do not separately hold ManageBookDock.
        await this.dock.discardFile(fileId, user.id, true);
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        // A person may have discarded the dock row directly after this request was loaded. The
        // desired filesystem outcome already holds, and the foreign keys have cleared themselves.
      } else {
        await Promise.allSettled([
          this.requests.updateIf(requestId, ['failed'], {
            status: 'needs_review',
            statusReason: request.statusReason,
            failureCode: request.failureCode,
            failureMeta: request.failureMeta,
          }),
          download && claimedDownload
            ? this.downloads.updateIf(download.id, ['failed'], { status: 'needs_review', errorMessage: download.errorMessage })
            : Promise.resolve(),
        ]);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[book_request.discard_import] [fail] requestId=${requestId} dockFileId=${fileId ?? 'none'} downloadId=${download?.id ?? 'none'} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.constructor.name : typeof error} error="${sanitizeLogValue(message)}" - a held import could not be discarded`,
        );
        if (error instanceof HttpException) throw error;
        throw new InternalServerErrorException('The held import could not be discarded');
      }
    }

    this.logger.log(
      `[book_request.discard_import] [end] requestId=${requestId} dockFileId=${fileId ?? 'none'} downloadId=${download?.id ?? 'none'} userId=${user.id} durationMs=${Date.now() - startedAt} title="${sanitizeLogValue(request.title)}" - a held import was discarded`,
    );
    await this.notifier.notifyResponsible(request, NotificationType.BookRequestFailed, {
      title: 'Book request import discarded',
      message: `"${request.title}": ${reason}`,
      actionUrl: '/requests',
      meta: { requestId, downloadId: download?.id ?? null, dockFileId: fileId },
    });
    this.gateway.emitChanged();
  }

  /**
   * The one place that decides a request is genuinely sitting in the dock waiting on a person.
   *
   * The dock file is looked up through the request first and the attempt second, and may still
   * come back null: both columns reference `book_dock_files` with `on delete set null`, so filing
   * or discarding the entry by hand empties them together and the hold outlives its file.
   */
  private async loadHeld(requestId: number): Promise<{ request: BookRequestRow; download: BookRequestDownloadRow | null; fileId: number | null }> {
    const joined = await this.requests.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');
    if (joined.request.status !== 'needs_review') throw new BadRequestException('This request is not waiting for review');

    const latest = await this.downloads.findLatestForRequests([requestId]);
    const download = latest.get(requestId)?.download ?? null;

    return { request: joined.request, download, fileId: joined.request.bookDockFileId ?? download?.bookDockFileId ?? null };
  }

  /** The file stays in the dock, so an approver can look at it and file it by hand. */
  private async holdForReview(download: BookRequestDownloadRow, request: BookRequestRow, outcome: VerificationOutcome): Promise<void> {
    await this.fulfillment.holdForReview(download, request, outcome.reason);
  }

  private async resolveFolder(libraryId: number | null): Promise<number | null> {
    if (libraryId === null) return null;
    return this.requests.findFirstFolderId(libraryId);
  }
}

/**
 * ISBN13 agreement is decisive when both sides carry one. A mismatch is not, because a different
 * edition of the same work has a different ISBN and is still the right book, so it falls through
 * to the title and author comparison rather than failing outright.
 *
 * Every path returns the field-by-field comparison as well as the number, because a bare score is
 * unactionable: an approver deciding whether to file this anyway needs to see that the title
 * gained a "Book 1 (Unabridged)" suffix, not that something somewhere came to 65.
 */
export function verifyAgainstRequest(
  request: Pick<BookRequestRow, 'title' | 'subtitle' | 'authors' | 'isbn13'>,
  fetched: BookDockMetadata | null,
  embedded: BookDockMetadata | null,
  threshold: number = DEFAULT_VERIFICATION_THRESHOLD,
  titleFallback: string | null = null,
): VerificationOutcome {
  const extractedTitle = fetched?.title?.trim() || embedded?.title?.trim() || '';
  // A track title is not a book title. The audio extractor already prefers the `album` tag, so
  // this catches only the release that carries no album at all, where `title` is "Chapter 3" and
  // would score near zero against the request no matter how right the book is.
  const importedTitle = titleFallback !== null && (!extractedTitle || isChapterLikeTitle(extractedTitle)) ? titleFallback : extractedTitle;
  const importedAuthors = (fetched?.authors?.length ? fetched.authors : (embedded?.authors ?? [])).filter(Boolean);
  const importedIsbn = normalizeMetadataIsbn(fetched?.isbn13 ?? embedded?.isbn13 ?? null);
  const requestedIsbn = normalizeMetadataIsbn(request.isbn13);
  const requestedAuthors = (request.authors ?? []).filter(Boolean);

  const titleScore = importedTitle ? bestTitleSimilarity(request.title, request.subtitle, importedTitle) : 0;
  const authorScore = requestedAuthors.length && importedAuthors.length ? bestPairSimilarity(requestedAuthors, importedAuthors) : null;

  const rows = (isbnVerdict: BookRequestVerificationVerdict): BookRequestVerificationRow[] => [
    {
      field: 'title',
      requested: joinTitle(request.title, request.subtitle),
      imported: importedTitle || null,
      verdict: importedTitle ? verdictFor(titleScore) : 'unknown',
    },
    {
      field: 'authors',
      requested: requestedAuthors.length ? requestedAuthors.join(', ') : null,
      imported: importedAuthors.length ? importedAuthors.join(', ') : null,
      verdict: authorScore === null ? 'unknown' : verdictFor(authorScore),
    },
    // The normalizer answers '' rather than null for a missing ISBN, and an empty row would
    // read as a blank value rather than as a field neither side filled in.
    { field: 'isbn13', requested: requestedIsbn || null, imported: importedIsbn || null, verdict: isbnVerdict },
  ];

  if (requestedIsbn && importedIsbn && requestedIsbn === importedIsbn) {
    return { score: 100, passed: true, reason: 'ISBN13 matches the requested edition exactly', code: 'isbn_match', rows: rows('match') };
  }

  const isbnVerdict: BookRequestVerificationVerdict = requestedIsbn && importedIsbn ? 'mismatch' : 'unknown';

  if (!importedTitle) {
    return { score: 0, passed: false, reason: 'the imported file has no readable title to compare', code: 'no_title', rows: rows(isbnVerdict) };
  }

  // Both sides named an author and they have nothing in common. A right-title wrong-author file
  // is the "three different books called It" case, and no title score should carry it through.
  if (authorScore === 0) {
    return {
      score: Math.round(titleScore * TITLE_WEIGHT * 100),
      passed: false,
      reason: `imported "${importedTitle}" is by ${importedAuthors.join(', ')}, not ${requestedAuthors.join(', ')}`,
      code: 'author_mismatch',
      rows: rows(isbnVerdict),
    };
  }

  const combined = authorScore === null ? titleScore : titleScore * TITLE_WEIGHT + authorScore * AUTHOR_WEIGHT;
  const score = Math.round(combined * 100);
  const passed = score >= threshold;

  return {
    score,
    passed,
    reason: passed
      ? `imported "${importedTitle}" scored ${score} against the request`
      : `imported "${importedTitle}" scored ${score}, below the ${threshold} needed to file it automatically`,
    code: passed ? 'above_threshold' : 'below_threshold',
    rows: rows(isbnVerdict),
  };
}

/**
 * The bar a single field has to clear to read as agreement. Deliberately looser than exact: a
 * subtitle the request omitted, or "Herbert, Frank" against "Frank Herbert", is the same book by
 * the same person and marking either one red would send approvers looking for a problem.
 */
const FIELD_MATCH_SIMILARITY = 0.9;

function verdictFor(similarity: number): BookRequestVerificationVerdict {
  return similarity >= FIELD_MATCH_SIMILARITY ? 'match' : 'mismatch';
}

function joinTitle(title: string, subtitle: string | null): string {
  return subtitle?.trim() ? `${title}: ${subtitle.trim()}` : title;
}

/**
 * The unit's own directory name, which is what a release names after the book. Only offered for a
 * multi-file unit: a loose single file has no directory that means anything.
 */
function unitTitleFallback(row: { unitDirectory: string | null }): string | null {
  if (!row.unitDirectory) return null;
  const name = basename(row.unitDirectory)
    .replace(/^request-\d+-/, '')
    .replace(/[\s._-]+/g, ' ')
    .trim();
  return name || null;
}

const CHAPTER_LIKE_TITLE = /^(?:chapter|track|part|disc|cd|section|episode)[\s._-]*\d*$/i;

function isChapterLikeTitle(title: string): boolean {
  return CHAPTER_LIKE_TITLE.test(title.trim());
}

/**
 * Compares both full titles and both main titles, so an imported edition that carries a subtitle
 * the request did not still matches, while a sequel that merely extends the title does not.
 */
function bestTitleSimilarity(requestTitle: string, requestSubtitle: string | null, importedTitle: string): number {
  const requested = [requestTitle, requestSubtitle ? `${requestTitle} ${requestSubtitle}` : null, mainTitlePart(requestTitle)].filter(
    (value): value is string => Boolean(value),
  );
  const imported = [importedTitle, mainTitlePart(importedTitle)];
  return bestPairSimilarity(requested, imported);
}

function bestPairSimilarity(left: string[], right: string[]): number {
  let best = 0;
  for (const a of left) {
    for (const b of right) {
      best = Math.max(best, symmetricTitleSimilarity(a, b));
      if (best === 1) return best;
    }
  }
  return best;
}
