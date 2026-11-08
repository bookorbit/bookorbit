import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  BookDuplicateCandidate,
  BookDuplicateDismissal,
  BookDuplicateGroup,
  BookDuplicateGroupsResponse,
  BookDuplicateKind,
  BookDuplicateMatchReason,
  BookDuplicateScan,
  BookDuplicateScanStatus,
  ReadStatus,
  ReadStatusSource,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { parsePgTimestamptz } from '../../common/utils/pg-timestamp.utils';
import { LibraryService } from '../library/library.service';
import { canonicalSeriesIndex, canonicalizeIsbn, crossFormatPersonKey, crossFormatTitleKey, mediaFamilyForFormat } from './book-duplicate-normalize';
import { BookDuplicatesRepository, type OtherFormatBookRow, type PreviewRow } from './book-duplicates.repository';
import type { CreateBookDuplicateDismissalDto, CreateBookDuplicateScanDto, ListBookDuplicateGroupsDto } from './dto/book-duplicate.dto';

const ISBN_BATCH_SIZE = 500;
const OTHER_FORMAT_BATCH_SIZE = 500;

type ScanKey = { scanId: number; bookId: number; kind: string; value: string };

function digest(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

/**
 * The other-format keys of one book. A book holding both an ebook and an audiobook, or neither, has
 * none: it is already whole, or has nothing to pair.
 */
export function otherFormatKeys(scanId: number, row: OtherFormatBookRow): ScanKey[] {
  const families = new Set(row.formats.map(mediaFamilyForFormat));
  const ebook = families.has('ebook');
  const audio = families.has('audiobook');
  if (ebook === audio) return [];
  const side = ebook ? 'e' : 'a';
  const keys: ScanKey[] = [];
  const push = (kind: string, value: string) => keys.push({ scanId, bookId: row.id, kind, value: `${side}|${value}` });

  // Work-level ids only: an ISBN, Goodreads, Audible or similar id names one edition, never both media.
  const hardcover = row.hardcover_id?.trim().toLowerCase();
  if (hardcover) push('of_work', digest(`hardcover:${hardcover}`));
  const openLibrary = row.open_library_id?.trim().toLowerCase();
  if (openLibrary) push('of_work', digest(`openlibrary:${openLibrary}`));

  const title = crossFormatTitleKey(row.title);
  if (title) {
    const people = new Set([...row.authors, ...row.narrators].map(crossFormatPersonKey).filter((person) => person.length > 0));
    for (const person of people) push('of_title', digest(`${title}\u001f${person}`));
  }

  const seriesIndex = canonicalSeriesIndex(row.series_index);
  if (row.series_id !== null && seriesIndex !== null) push('of_series', `${row.series_id}|${seriesIndex}`);
  return keys;
}
function toCandidate(row: PreviewRow): BookDuplicateCandidate {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    authors: row.authors,
    libraryId: row.library_id,
    libraryName: row.library_name,
    folderPath: row.folder_path,
    status: row.status,
    files: row.files,
    isbn10: row.isbn10,
    isbn13: row.isbn13,
    metadataScore: row.metadata_score === null ? null : Number(row.metadata_score),
    readStatus: row.read_status
      ? {
          status: row.read_status.status as ReadStatus,
          source: row.read_status.source as ReadStatusSource,
          startedAt: row.read_status.startedAt,
          finishedAt: row.read_status.finishedAt,
          updatedAt: row.read_status.updatedAt,
        }
      : null,
    readingProgress: row.reading_progress === null ? null : Number(row.reading_progress),
    collections: row.collections,
    addedAt: parsePgTimestamptz(row.added_at).toISOString(),
    updatedAt: row.updated_at ? parsePgTimestamptz(row.updated_at).toISOString() : null,
    hasCover: row.has_cover,
    bookPerFile: row.book_per_file,
  };
}

function groupCandidates(rows: PreviewRow[]): Map<number, BookDuplicateCandidate[]> {
  const byGroup = new Map<number, BookDuplicateCandidate[]>();
  for (const row of rows) {
    const current = byGroup.get(row.group_id);
    if (current) current.push(toCandidate(row));
    else byGroup.set(row.group_id, [toCandidate(row)]);
  }
  return byGroup;
}

const DISMISSAL_LIST_LIMIT = 200;

@Injectable()
export class BookDuplicatesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookDuplicatesService.name);
  private readonly queue: { scanId: number; user: RequestUser }[] = [];
  private workerRunning = false;

  constructor(
    private readonly repo: BookDuplicatesRepository,
    private readonly libraryService: LibraryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.repo.markInterruptedScansFailed();
  }

  async createScan(dto: CreateBookDuplicateScanDto, user: RequestUser): Promise<BookDuplicateScan> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (dto.libraryId !== undefined && !accessibleLibraryIds.includes(dto.libraryId)) {
      throw new ForbiddenException('Library is not accessible');
    }
    const libraryIds = dto.libraryId === undefined ? accessibleLibraryIds : [dto.libraryId];
    const scan = await this.repo.createScanUnlessActive({
      userId: user.id,
      libraryIds,
      requestedLibraryId: dto.libraryId ?? null,
      similarityPercent: dto.similarityPercent,
    });
    if (!scan) throw new ConflictException('A duplicate book scan is already running');

    this.queue.push({ scanId: scan.id, user });
    void this.drainQueue();
    return this.toScan(scan);
  }

  async getScan(scanId: number, user: RequestUser): Promise<BookDuplicateScan> {
    const scan = await this.findOwnedScan(scanId, user);
    return this.toScan(scan);
  }

  async getActiveScan(user: RequestUser): Promise<BookDuplicateScan | null> {
    const scan = await this.repo.findActiveForUser(user.id);
    return scan ? this.toScan(scan) : null;
  }

  async getGroups(scanId: number, dto: ListBookDuplicateGroupsDto, user: RequestUser): Promise<BookDuplicateGroupsResponse> {
    const scan = await this.findOwnedScan(scanId, user);
    if (scan.status !== 'completed') throw new ConflictException('Duplicate book scan is not complete');
    await this.assertScopeStillAccessible(scan.libraryIds, user);

    const { groups, total } = await this.repo.findGroups(
      scanId,
      dto.page,
      dto.pageSize,
      scan.libraryIds,
      user,
      dto.reason,
      dto.sortBy,
      dto.order,
      dto.kind,
    );
    const groupIds = groups.map((group) => group.id);
    const [pairs, previews] = await Promise.all([this.repo.findPairs(groupIds), this.repo.findCandidatePreviews(groupIds, scan.libraryIds, user)]);
    const previewsByGroup = groupCandidates(previews);

    const visibleBookIds = new Set(previews.map((preview) => preview.id));
    const pairsByGroup = new Map<number, typeof pairs>();
    for (const pair of pairs) {
      if (pair.groupId === null || !visibleBookIds.has(pair.bookIdA) || !visibleBookIds.has(pair.bookIdB)) continue;
      const current = pairsByGroup.get(pair.groupId);
      if (current) current.push(pair);
      else pairsByGroup.set(pair.groupId, [pair]);
    }

    return {
      groups: groups
        .map((group): BookDuplicateGroup => ({
          id: group.id,
          kind: group.kind as BookDuplicateKind,
          reasons: group.reasons as BookDuplicateMatchReason[],
          maxTitleSimilarity: group.maxTitleSimilarity,
          reclaimableBytes: Math.max(0, group.memberBytesTotal - group.memberBytesMax),
          books: previewsByGroup.get(group.id) ?? [],
          pairs: (pairsByGroup.get(group.id) ?? []).map((pair) => ({
            bookIdA: pair.bookIdA,
            bookIdB: pair.bookIdB,
            reasons: pair.reasons as BookDuplicateMatchReason[],
            titleSimilarity: pair.titleSimilarity,
          })),
        }))
        .filter((group) => group.books.length >= 2),
      total,
      page: dto.page,
      pageSize: dto.pageSize,
    };
  }

  async dismissGroup(dto: CreateBookDuplicateDismissalDto, user: RequestUser): Promise<void> {
    const scan = await this.findOwnedScan(dto.scanId, user);
    await this.assertScopeStillAccessible(scan.libraryIds, user);
    const kind = await this.repo.findGroupKind(dto.scanId, dto.groupId);
    const bookIds = kind ? await this.repo.findGroupMemberIds(dto.scanId, dto.groupId) : [];
    if (!kind || bookIds.length < 2) throw new NotFoundException('Duplicate group not found');

    const pairs: { bookIdA: number; bookIdB: number }[] = [];
    const sorted = [...bookIds].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) pairs.push({ bookIdA: sorted[i]!, bookIdB: sorted[j]! });
    }
    await this.repo.insertDismissals(user.id, kind, pairs);
    this.logger.log(
      `[book_duplicates.dismiss] [end] scanId=${dto.scanId} groupId=${dto.groupId} userId=${user.id} kind=${kind} pairCount=${pairs.length} - duplicate group dismissed`,
    );
  }

  async listDismissals(user: RequestUser): Promise<BookDuplicateDismissal[]> {
    const rows = await this.repo.listDismissals(user.id, DISMISSAL_LIST_LIMIT);
    return rows.map((row) => ({
      kind: row.kind as BookDuplicateKind,
      bookIdA: row.bookIdA,
      bookIdB: row.bookIdB,
      titleA: row.titleA,
      titleB: row.titleB,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async restoreDismissal(bookIdA: number, bookIdB: number, user: RequestUser, kind: BookDuplicateKind = 'duplicate'): Promise<void> {
    const [low, high] = bookIdA < bookIdB ? [bookIdA, bookIdB] : [bookIdB, bookIdA];
    const removed = await this.repo.deleteDismissal(user.id, kind, low, high);
    if (removed === 0) throw new NotFoundException('Dismissed pair not found');
  }

  /** A completed scan of the user's whose libraries they can all still reach, for acting on its groups. */
  async findResolvableScan(scanId: number, user: RequestUser): Promise<{ id: number; libraryIds: number[] }> {
    const scan = await this.findOwnedScan(scanId, user);
    if (scan.status !== 'completed') throw new ConflictException('Duplicate book scan is not complete');
    await this.assertScopeStillAccessible(scan.libraryIds, user);
    return { id: scan.id, libraryIds: scan.libraryIds };
  }

  /** The visible books of each group, as the review shows them. */
  async findCandidates(groupIds: number[], libraryIds: number[], user: RequestUser): Promise<Map<number, BookDuplicateCandidate[]>> {
    if (groupIds.length === 0) return new Map();
    return groupCandidates(await this.repo.findCandidatePreviews(groupIds, libraryIds, user));
  }

  private async drainQueue(): Promise<void> {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      for (;;) {
        const job = this.queue.shift();
        if (!job) break;
        await this.runScan(job.scanId, job.user);
      }
    } finally {
      this.workerRunning = false;
    }
  }

  private async runScan(scanId: number, user: RequestUser): Promise<void> {
    const event = 'book_duplicates.scan';
    const startedAt = Date.now();
    const scan = await this.repo.findScan(scanId);
    if (!scan) return;

    this.logger.log(
      `[${event}] [start] scanId=${scanId} userId=${user.id} libraryCount=${scan.libraryIds.length} similarityPercent=${scan.similarityPercent} - duplicate scan started`,
    );
    try {
      const totalBooks = await this.repo.countScopedBooks(scan.libraryIds, user);
      await this.repo.updateScan(scanId, { status: 'running', totalBooks, processedBooks: 0, errorCode: null });

      if (totalBooks === 0) {
        await this.repo.updateScan(scanId, {
          status: 'completed',
          processedBooks: 0,
          totalGroups: 0,
          totalExtraCopies: 0,
          totalReclaimableBytes: 0,
          totalOtherFormatPairs: 0,
          completedAt: new Date(),
        });
        await this.repo.deleteOlderScans(user.id, scanId);
        this.logger.log(
          `[${event}] [end] scanId=${scanId} userId=${user.id} totalBooks=0 totalGroups=0 durationMs=${Date.now() - startedAt} - duplicate scan completed`,
        );
        return;
      }

      await this.repo.insertFileHashKeys(scanId, scan.libraryIds, user);
      await this.updateProgress(scanId, totalBooks, 20);

      let afterBookId = 0;
      for (;;) {
        const rows = await this.repo.findIsbnBatch(scan.libraryIds, user, afterBookId, ISBN_BATCH_SIZE);
        if (rows.length === 0) break;
        const values = rows.flatMap((row) => {
          const isbn = canonicalizeIsbn(row.isbn10, row.isbn13);
          if (!isbn) return [];
          const families = new Set(row.formats.map(mediaFamilyForFormat));
          return [...families].map((family) => ({ scanId, bookId: row.id, value: `${isbn}|${family}` }));
        });
        await this.repo.insertIsbnKeys(values);
        afterBookId = rows.at(-1)!.id;
      }
      await this.updateProgress(scanId, totalBooks, 40);

      await this.repo.insertExactMetadataKeys(scanId, scan.libraryIds, user);
      await this.updateProgress(scanId, totalBooks, 55);
      await this.repo.createExactPairs(scanId);
      await this.updateProgress(scanId, totalBooks, 65);
      await this.repo.createFuzzyPairs(scanId, scan.libraryIds, user, scan.similarityPercent);
      await this.updateProgress(scanId, totalBooks, 75);
      await this.insertOtherFormatKeys(scanId, scan.libraryIds, user);
      await this.repo.createOtherFormatPairs(scanId, scan.similarityPercent);
      await this.updateProgress(scanId, totalBooks, 85);
      const dismissedPairs = await this.repo.deleteDismissedPairs(scanId, user.id);
      await this.updateProgress(scanId, totalBooks, 88);
      const totalGroups = await this.repo.finalizeGroups(scanId);
      const totalOtherFormatPairs = await this.repo.finalizeOtherFormatGroups(scanId);
      const totals = await this.repo.computeScanTotals(scanId);
      await this.repo.deleteScanKeys(scanId);
      await this.repo.updateScan(scanId, {
        status: 'completed',
        processedBooks: totalBooks,
        totalGroups,
        totalExtraCopies: totals.totalExtraCopies,
        totalReclaimableBytes: totals.totalReclaimableBytes,
        totalOtherFormatPairs,
        completedAt: new Date(),
      });
      await this.repo.deleteOlderScans(user.id, scanId);

      this.logger.log(
        `[${event}] [end] scanId=${scanId} userId=${user.id} totalBooks=${totalBooks} totalGroups=${totalGroups} otherFormatPairs=${totalOtherFormatPairs} dismissedPairs=${dismissedPairs} reclaimableBytes=${totals.totalReclaimableBytes} durationMs=${Date.now() - startedAt} - duplicate scan completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      await this.repo.updateScan(scanId, { status: 'failed', errorCode: 'scan_failed', completedAt: new Date() }).catch(() => undefined);
      await this.repo.deleteScanArtifacts(scanId).catch(() => undefined);
      this.logger.warn(
        `[${event}] [fail] scanId=${scanId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - duplicate scan failed`,
      );
    }
  }

  private async insertOtherFormatKeys(scanId: number, libraryIds: number[], user: RequestUser): Promise<void> {
    let afterBookId = 0;
    for (;;) {
      const rows = await this.repo.findOtherFormatBatch(libraryIds, user, afterBookId, OTHER_FORMAT_BATCH_SIZE);
      if (rows.length === 0) break;
      await this.repo.insertScanKeys(rows.flatMap((row) => otherFormatKeys(scanId, row)));
      afterBookId = rows.at(-1)!.id;
    }
  }

  private updateProgress(scanId: number, totalBooks: number, percent: number): Promise<void> {
    return this.repo.updateScan(scanId, { processedBooks: Math.floor((totalBooks * percent) / 100) });
  }

  private async findOwnedScan(scanId: number, user: RequestUser) {
    const scan = await this.repo.findScan(scanId);
    if (!scan || scan.userId !== user.id) throw new NotFoundException('Duplicate book scan not found');
    return scan;
  }

  private async assertScopeStillAccessible(libraryIds: number[], user: RequestUser): Promise<void> {
    const accessible = new Set(await this.libraryService.findAccessibleLibraryIds(user));
    if (libraryIds.some((libraryId) => !accessible.has(libraryId))) {
      throw new ForbiddenException('Duplicate book scan scope is no longer accessible');
    }
  }

  private toScan(scan: {
    id: number;
    status: string;
    libraryIds: number[];
    requestedLibraryId: number | null;
    similarityPercent: number;
    processedBooks: number;
    totalBooks: number | null;
    totalGroups: number | null;
    totalExtraCopies: number | null;
    totalReclaimableBytes: number | null;
    totalOtherFormatPairs: number | null;
    errorCode: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): BookDuplicateScan {
    const progressPercent =
      scan.status === 'completed'
        ? 100
        : scan.totalBooks && scan.totalBooks > 0
          ? Math.min(99, Math.round((scan.processedBooks / scan.totalBooks) * 100))
          : scan.status === 'queued'
            ? 0
            : null;
    return {
      id: scan.id,
      status: scan.status as BookDuplicateScanStatus,
      libraryIds: scan.libraryIds,
      requestedLibraryId: scan.requestedLibraryId,
      similarityPercent: scan.similarityPercent,
      processedBooks: scan.processedBooks,
      totalBooks: scan.totalBooks,
      progressPercent,
      totalGroups: scan.totalGroups,
      totalExtraCopies: scan.totalExtraCopies,
      totalReclaimableBytes: scan.totalReclaimableBytes === null ? null : Number(scan.totalReclaimableBytes),
      totalOtherFormatPairs: scan.totalOtherFormatPairs,
      errorCode: scan.errorCode,
      createdAt: scan.createdAt.toISOString(),
      completedAt: scan.completedAt?.toISOString() ?? null,
    };
  }
}
