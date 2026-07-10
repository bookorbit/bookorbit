import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import type {
  BookMissingEvent,
  BookTransferredEvent,
  CoverRefreshedEvent,
  CoverRefreshProgressEvent,
  ScanBooksAddedEvent,
  ScanProgressEvent,
} from '@bookorbit/types';
import { NotificationType } from '@bookorbit/types';
import { AchievementEventsService, ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED } from '../achievement/achievement-events.service';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { MetadataService } from '../metadata/metadata.service';
import { NotificationService } from '../notification/notification.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { basename, dirname, relative, sep } from 'path';
import { readdir, stat } from 'fs/promises';

import { classifyFile, DEFAULT_FORMAT_PRIORITY, FileRole, isAudioFormat } from './lib/classify';
import { computeFileHash } from './lib/hash';
import { waitForStability } from './lib/stability';
import {
  BookCandidate,
  FileStat,
  findBookCandidates,
  findLooseFileCandidates,
  buildSingleBookCandidate,
  clampIno,
  type WalkResult,
} from './lib/walk';
import { ScannerRepository } from './scanner.repository';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { LIBRARY_METADATA_PRECEDENCE_DEFAULT } from '../library/library.constants';

interface BookEntry {
  id: number;
  status: string;
  folderPath: string;
  primaryFileId?: number | null;
}

interface FileByPathEntry {
  id: number;
  bookId: number;
  ino: number;
  sizeBytes: number | null;
  mtime: Date | null;
  fileHash: string | null;
  sortOrder: number | null;
}

interface FileByInoEntry {
  id: number;
  bookId: number;
  absolutePath: string;
  sizeBytes: number | null;
  mtime: Date | null;
}

interface ScanLookupMaps {
  bookByFolderPath: Map<string, BookEntry>;
  booksByParentDir: Map<string, BookEntry[]>;
  fileByPath: Map<string, FileByPathEntry>;
  fileByIno: Map<number, FileByInoEntry>;
  fileIdsByBookId: Map<number, Set<number>>;
}

interface LibraryScanSettings {
  allowedFormats: string[];
  formatPriority: string[];
  metadataPrecedence: string[];
  excludePatterns: string[];
  organizationMode: OrganizationMode;
}

type TargetedScanJob = { type: 'book'; path: string; libraryId: number } | { type: 'directory'; path: string; libraryId: number };

const METADATA_FORMATS = new Set([
  'epub',
  'kepub',
  'mobi',
  'azw3',
  'azw',
  'cbz',
  'cbr',
  'cb7',
  'fb2',
  'pdf',
  'm4b',
  'mp3',
  'm4a',
  'opus',
  'ogg',
  'flac',
  'opf',
]);
const SCANNER_METADATA_SOURCES = ['embedded', 'opfFile'] as const;
const COVER_REFRESH_BATCH_SIZE = 5;
const BOOK_EMIT_BUFFER_SIZE = 20;
const BOOK_EMIT_FLUSH_INTERVAL_MS = 1000;
const BOOK_STATUS_NOTIFY_DEBOUNCE_MS = 1000;
const BOOK_MISSING_NOTIFY_DEBOUNCE_MS = 5000;
const WATCHER_NOTIFY_DEBOUNCE_MS = 30_000;
const TARGETED_BOOK_SCAN_MAX_CONCURRENCY = 8;
const MISSING_FILE_STAT_BATCH_SIZE = 50;
type OrganizationMode = 'book_per_file' | 'book_per_folder';

interface ScanCounts {
  addedCount: number;
  updatedCount: number;
  missingCount: number;
}

type ScannerMetadataSource = (typeof SCANNER_METADATA_SOURCES)[number];

interface RegisteredFile {
  fileId: number;
  format: string | null;
  role: FileRole;
  absolutePath: string;
  isNew: boolean;
  wasReassigned: boolean;
  wasChanged: boolean;
}

interface MetadataExtractionSource {
  key: ScannerMetadataSource;
  file: RegisteredFile;
  format: string;
}

interface ProcessedFileResult {
  isNew: boolean;
  reassigned: boolean;
  changed: boolean;
  fileId: number | null;
}

interface UpsertBookResult extends BookEntry {
  created: boolean;
}

interface ProcessCandidateResult {
  bookId: number;
  added: number;
  updated: number;
  retainedFileIds: Set<number>;
  becameVisible: boolean;
  created: boolean;
}

function normalizeOrganizationMode(mode: string | null | undefined): OrganizationMode {
  return mode === 'book_per_file' ? 'book_per_file' : 'book_per_folder';
}

function normalizeMetadataPrecedence(metadataPrecedence: string[] | null | undefined): ScannerMetadataSource[] {
  const result: ScannerMetadataSource[] = [];
  const configured = metadataPrecedence && metadataPrecedence.length > 0 ? metadataPrecedence : LIBRARY_METADATA_PRECEDENCE_DEFAULT;

  for (const source of configured) {
    if (!SCANNER_METADATA_SOURCES.includes(source as ScannerMetadataSource)) continue;
    const knownSource = source as ScannerMetadataSource;
    if (!result.includes(knownSource)) result.push(knownSource);
  }

  for (const fallbackSource of SCANNER_METADATA_SOURCES) {
    if (!result.includes(fallbackSource)) result.push(fallbackSource);
  }

  return result;
}

function fileStem(absolutePath: string): string {
  const name = basename(absolutePath);
  const index = name.lastIndexOf('.');
  return (index > 0 ? name.slice(0, index) : name).toLowerCase();
}

function hasMetadataSourceChanged(file: RegisteredFile): boolean {
  return file.isNew || file.wasReassigned || file.wasChanged;
}

function formatBooksUnavailableMessage(count: number): string {
  return count === 1 ? '1 book is no longer available on disk.' : `${count} books are no longer available on disk.`;
}

function formatBooksRestoredMessage(count: number): string {
  return count === 1 ? '1 book was restored on disk.' : `${count} books were restored on disk.`;
}

@Injectable()
export class ScannerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private readonly scannerRepo: ScannerRepository,
    private readonly metadataService: MetadataService,
    private readonly scanJobStore: ScanJobStore,
    private readonly scanGateway: ScanGateway,
    private readonly notificationService: NotificationService,
    @Optional() private readonly autoFetchOrchestrator?: BookMetadataFetchOrchestratorService,
    @Optional() private readonly achievementEvents?: AchievementEventsService,
  ) {}

  // ── Live book emission buffer ──────────────────────────────────────────────
  private readonly bookEmitBuffer = new Map<number, number[]>();
  private readonly bookEmitTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // ── Watcher change notification buffer (debounced, 30s) ───────────────────
  private readonly watcherNotifyBuffer = new Map<number, { added: number; removed: number }>();
  private readonly watcherNotifyTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // ── Missing book notification buffer (debounced, 1s) ──────────────────────
  private readonly booksUnavailableNotifyBuffer = new Map<number, Set<number>>();
  private readonly booksUnavailableNotifyTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly bookMissingEmitBuffer = new Map<number, Set<number>>();
  private readonly bookMissingEmitTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // ── Restored book notification buffer (debounced, 1s) ─────────────────────
  private readonly booksRestoredNotifyBuffer = new Map<number, Set<number>>();
  private readonly booksRestoredNotifyTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // ── Settings hash for incremental scan invalidation ────────────────────────
  private readonly lastSettingsHash = new Map<number, string>();

  // ── Targeted watcher scans ─────────────────────────────────────────────────
  private readonly targetedBookScanQueue: TargetedScanJob[] = [];
  private activeTargetedBookScans = 0;

  private static computeSettingsHash(
    allowedFormats: string[],
    formatPriority: string[],
    metadataPrecedence: string[],
    excludePatterns: string[],
    organizationMode: string,
  ): string {
    const payload = JSON.stringify({ allowedFormats, formatPriority, metadataPrecedence, excludePatterns, organizationMode });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  private static buildLookupMaps(
    knownBooks: Array<{ id: number; status: string; folderPath: string; primaryFileId?: number | null }>,
    knownFiles: Array<{
      id: number;
      bookId: number;
      absolutePath: string;
      ino: number;
      sizeBytes: number | null;
      mtime: Date | null;
      fileHash: string | null;
      sortOrder?: number | null;
    }>,
  ): ScanLookupMaps {
    const bookByFolderPath = new Map<string, BookEntry>(
      knownBooks.map((b) => [b.folderPath, { id: b.id, status: b.status, folderPath: b.folderPath, primaryFileId: b.primaryFileId }]),
    );

    const booksByParentDir = new Map<string, BookEntry[]>();
    for (const b of knownBooks) {
      const parentDir = dirname(b.folderPath);
      let arr = booksByParentDir.get(parentDir);
      if (!arr) {
        arr = [];
        booksByParentDir.set(parentDir, arr);
      }
      arr.push({ id: b.id, status: b.status, folderPath: b.folderPath, primaryFileId: b.primaryFileId });
    }

    const fileByPath = new Map<string, FileByPathEntry>(
      knownFiles.map((f) => [
        f.absolutePath,
        { id: f.id, bookId: f.bookId, ino: f.ino, sizeBytes: f.sizeBytes, mtime: f.mtime, fileHash: f.fileHash, sortOrder: f.sortOrder ?? null },
      ]),
    );

    const fileByIno = new Map<number, FileByInoEntry>(
      knownFiles
        .filter((f) => f.ino !== 0)
        .map((f) => [f.ino, { id: f.id, bookId: f.bookId, absolutePath: f.absolutePath, sizeBytes: f.sizeBytes, mtime: f.mtime }]),
    );

    const fileIdsByBookId = new Map<number, Set<number>>();
    for (const f of knownFiles) {
      let s = fileIdsByBookId.get(f.bookId);
      if (!s) {
        s = new Set();
        fileIdsByBookId.set(f.bookId, s);
      }
      s.add(f.id);
    }

    return { bookByFolderPath, booksByParentDir, fileByPath, fileByIno, fileIdsByBookId };
  }

  private bufferBookForEmit(libraryId: number, bookId: number): void {
    let ids = this.bookEmitBuffer.get(libraryId);
    if (!ids) {
      ids = [];
      this.bookEmitBuffer.set(libraryId, ids);
    }
    ids.push(bookId);

    if (ids.length >= BOOK_EMIT_BUFFER_SIZE) {
      this.flushBookEmitBuffer(libraryId);
      return;
    }

    if (!this.bookEmitTimers.has(libraryId)) {
      this.bookEmitTimers.set(
        libraryId,
        setTimeout(() => this.flushBookEmitBuffer(libraryId), BOOK_EMIT_FLUSH_INTERVAL_MS),
      );
    }
  }

  private flushBookEmitBuffer(libraryId: number): void {
    const timer = this.bookEmitTimers.get(libraryId);
    if (timer) clearTimeout(timer);
    this.bookEmitTimers.delete(libraryId);

    const ids = this.bookEmitBuffer.get(libraryId);
    this.bookEmitBuffer.delete(libraryId);
    if (!ids || ids.length === 0) return;

    this.buildAndEmitBookCards(libraryId, ids).catch((err) => {
      this.logger.warn(
        `[scanner.emit_books_added] [fail] libraryId=${libraryId} bookCount=${ids.length} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - failed to emit added books`,
      );
    });
  }

  private async buildAndEmitBookCards(libraryId: number, bookIds: number[]): Promise<void> {
    const { rows, authorRows, fileRows, genreRows } = await this.scannerRepo.findBookCardData(bookIds);
    const cards = assembleBookCards(rows, authorRows, fileRows, genreRows, []);
    if (cards.length > 0) {
      this.scanGateway.emitBooksAdded({ libraryId, books: cards } satisfies ScanBooksAddedEvent);
    }
  }

  bufferWatcherNotification(libraryId: number, delta: { added?: number; removed?: number }): void {
    const current = this.watcherNotifyBuffer.get(libraryId) ?? { added: 0, removed: 0 };
    current.added += delta.added ?? 0;
    current.removed += delta.removed ?? 0;
    this.watcherNotifyBuffer.set(libraryId, current);

    const existing = this.watcherNotifyTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.watcherNotifyTimers.set(
      libraryId,
      setTimeout(() => this.flushWatcherNotification(libraryId), WATCHER_NOTIFY_DEBOUNCE_MS),
    );
  }

  bufferBooksUnavailableNotification(libraryId: number, bookIds: number[]): void {
    if (bookIds.length === 0) return;
    const current = this.booksUnavailableNotifyBuffer.get(libraryId) ?? new Set<number>();
    for (const bookId of bookIds) current.add(bookId);
    this.booksUnavailableNotifyBuffer.set(libraryId, current);

    const existing = this.booksUnavailableNotifyTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.booksUnavailableNotifyTimers.set(
      libraryId,
      setTimeout(() => this.flushBooksUnavailableNotification(libraryId), BOOK_MISSING_NOTIFY_DEBOUNCE_MS),
    );
  }

  bufferBookMissingEvent(libraryId: number, bookIds: number[]): void {
    if (bookIds.length === 0) return;
    const current = this.bookMissingEmitBuffer.get(libraryId) ?? new Set<number>();
    for (const bookId of bookIds) current.add(bookId);
    this.bookMissingEmitBuffer.set(libraryId, current);

    const existing = this.bookMissingEmitTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.bookMissingEmitTimers.set(
      libraryId,
      setTimeout(() => {
        this.flushBookMissingEvent(libraryId).catch((err) => {
          this.logger.warn(
            `[scanner.emit_book_missing] [fail] libraryId=${libraryId} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - failed to emit missing books`,
          );
        });
      }, BOOK_MISSING_NOTIFY_DEBOUNCE_MS),
    );
  }

  cancelBooksUnavailableNotification(libraryId: number, bookIds: number[]): void {
    if (bookIds.length === 0) return;
    this.cancelBookMissingEvent(libraryId, bookIds);

    const current = this.booksUnavailableNotifyBuffer.get(libraryId);
    if (!current) return;

    for (const bookId of bookIds) current.delete(bookId);
    if (current.size > 0) return;

    this.booksUnavailableNotifyBuffer.delete(libraryId);
    const existing = this.booksUnavailableNotifyTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.booksUnavailableNotifyTimers.delete(libraryId);
  }

  private cancelBookMissingEvent(libraryId: number, bookIds: number[]): void {
    const current = this.bookMissingEmitBuffer.get(libraryId);
    if (!current) return;

    for (const bookId of bookIds) current.delete(bookId);
    if (current.size > 0) return;

    this.bookMissingEmitBuffer.delete(libraryId);
    const existing = this.bookMissingEmitTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.bookMissingEmitTimers.delete(libraryId);
  }

  private async flushBookMissingEvent(libraryId: number): Promise<void> {
    const existing = this.bookMissingEmitTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.bookMissingEmitTimers.delete(libraryId);

    const bookIds = [...(this.bookMissingEmitBuffer.get(libraryId) ?? [])];
    this.bookMissingEmitBuffer.delete(libraryId);
    if (bookIds.length === 0) return;

    const rows = await this.scannerRepo.findBooksByIds(bookIds);
    const stillMissingIds = rows.filter((book) => book.libraryId === libraryId && book.status === 'missing').map((book) => book.id);
    if (stillMissingIds.length === 0) return;

    this.scanGateway.emitBookMissing({ libraryId, bookIds: stillMissingIds } satisfies BookMissingEvent);
  }

  private flushBooksUnavailableNotification(libraryId: number): void {
    const existing = this.booksUnavailableNotifyTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.booksUnavailableNotifyTimers.delete(libraryId);

    const bookIds = [...(this.booksUnavailableNotifyBuffer.get(libraryId) ?? [])];
    this.booksUnavailableNotifyBuffer.delete(libraryId);
    if (bookIds.length === 0) return;

    const count = bookIds.length;
    this.notificationService
      .notify({
        type: NotificationType.BooksUnavailable,
        title: count === 1 ? 'Book unavailable' : 'Books unavailable',
        message: formatBooksUnavailableMessage(count),
        actionUrl: `/library/${libraryId}`,
        scope: { kind: 'library', libraryId },
        meta: { libraryId, count },
      })
      .catch(() => {});

    this.emitLibraryCatalogChangedForLibrary(libraryId);
  }

  bufferBooksRestoredNotification(libraryId: number, bookIds: number[]): void {
    if (bookIds.length === 0) return;
    this.cancelBooksUnavailableNotification(libraryId, bookIds);

    const current = this.booksRestoredNotifyBuffer.get(libraryId) ?? new Set<number>();
    for (const bookId of bookIds) current.add(bookId);
    this.booksRestoredNotifyBuffer.set(libraryId, current);

    const existing = this.booksRestoredNotifyTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.booksRestoredNotifyTimers.set(
      libraryId,
      setTimeout(() => this.flushBooksRestoredNotification(libraryId), BOOK_STATUS_NOTIFY_DEBOUNCE_MS),
    );
  }

  private flushBooksRestoredNotification(libraryId: number): void {
    const existing = this.booksRestoredNotifyTimers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.booksRestoredNotifyTimers.delete(libraryId);

    const bookIds = [...(this.booksRestoredNotifyBuffer.get(libraryId) ?? [])];
    this.booksRestoredNotifyBuffer.delete(libraryId);
    if (bookIds.length === 0) return;

    const count = bookIds.length;
    this.notificationService
      .notify({
        type: NotificationType.BooksRestored,
        title: count === 1 ? 'Book restored' : 'Books restored',
        message: formatBooksRestoredMessage(count),
        actionUrl: `/library/${libraryId}`,
        scope: { kind: 'library', libraryId },
        meta: { libraryId, count },
      })
      .catch(() => {});

    this.emitLibraryCatalogChangedForLibrary(libraryId);
  }

  private flushWatcherNotification(libraryId: number): void {
    this.watcherNotifyTimers.delete(libraryId);
    const delta = this.watcherNotifyBuffer.get(libraryId);
    this.watcherNotifyBuffer.delete(libraryId);
    if (!delta || (delta.added === 0 && delta.removed === 0)) return;

    this.scannerRepo
      .findLibraryName(libraryId)
      .then((name) => {
        const label = name ?? `Library ${libraryId}`;
        const parts: string[] = [];
        if (delta.added > 0) parts.push(`${delta.added} added`);
        if (delta.removed > 0) parts.push(`${delta.removed} removed`);
        return this.notificationService.notify({
          type: NotificationType.ScanCompleted,
          title: `${label} updated`,
          message: parts.join(', '),
          scope: { kind: 'library', libraryId },
          meta: { libraryId },
        });
      })
      .catch(() => {});

    this.emitLibraryCatalogChangedForLibrary(libraryId);
  }

  private emitLibraryCatalogChangedForUsers(libraryId: number, userIds: number[]): void {
    if (!this.achievementEvents || userIds.length === 0) return;
    for (const userId of userIds) {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId, libraryId });
    }
  }

  private emitLibraryCatalogChangedForLibrary(libraryId: number): void {
    if (!this.achievementEvents) return;

    this.scannerRepo
      .findLibraryAccessibleUserIds(libraryId)
      .then((userIds) => this.emitLibraryCatalogChangedForUsers(libraryId, userIds))
      .catch((err) => {
        this.logger.warn(
          `[scanner.achievement_emit] [fail] libraryId=${libraryId} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - failed to emit library catalog achievement event`,
        );
      });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.scannerRepo.failAllRunningJobs('Server restarted during scan');
  }

  async startScan(libraryId: number, triggeredBy: 'manual' | 'watcher' | 'schedule', forceFullScan = false): Promise<{ jobId: number }> {
    const event = 'scanner.start_scan';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} triggeredBy=${triggeredBy} forceFullScan=${forceFullScan} - scan start requested`);
    if (!this.scanJobStore.acquireStartLock(libraryId)) {
      throw new ConflictException(`A scan is already starting for library ${libraryId}`);
    }
    try {
      if (this.scanJobStore.isRunning(libraryId)) {
        throw new ConflictException(`A scan is already running for library ${libraryId}`);
      }

      const [folders, settings] = await Promise.all([
        this.scannerRepo.findLibraryFolders(libraryId),
        this.scannerRepo.findLibrarySettings(libraryId),
      ]);
      if (folders.length === 0) throw new NotFoundException(`Library ${libraryId} has no folders`);

      const allowedFormats = settings?.allowedFormats ?? [];
      const formatPriority = settings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY;
      const metadataPrecedence = settings?.metadataPrecedence ?? [...LIBRARY_METADATA_PRECEDENCE_DEFAULT];
      const excludePatterns = settings?.excludePatterns ?? [];
      const organizationMode = normalizeOrganizationMode(settings?.organizationMode);

      // Invalidate incremental scan cache when scan-affecting settings change.
      // On first scan after restart (no stored hash), force full scan to avoid
      // using stale dir state that was built under different settings.
      const currentHash = ScannerService.computeSettingsHash(allowedFormats, formatPriority, metadataPrecedence, excludePatterns, organizationMode);
      const lastHash = this.lastSettingsHash.get(libraryId);
      if (lastHash === undefined || lastHash !== currentHash) {
        forceFullScan = true;
        if (lastHash !== undefined) {
          this.logger.log(`[scanner.start_scan] libraryId=${libraryId} - scan settings changed, forcing full rescan`);
        }
      }
      this.lastSettingsHash.set(libraryId, currentHash);

      const job = await this.scannerRepo.createScanJob(libraryId, triggeredBy);

      this.scanJobStore.create(job.id, libraryId, 0);
      this.emitFromStore(libraryId, job.id, 'running');

      this.runScan(
        libraryId,
        job.id,
        folders,
        allowedFormats,
        formatPriority,
        metadataPrecedence,
        excludePatterns,
        organizationMode,
        forceFullScan,
      ).catch((err) => {
        const errorClass = err instanceof Error ? err.name : 'Error';
        const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
        this.logger.error(
          `[scanner.run_scan] [fail] libraryId=${libraryId} jobId=${job.id} errorClass=${errorClass} error="${errorMessage}" - scan job crashed unexpectedly`,
        );
      });

      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} triggeredBy=${triggeredBy} durationMs=${Date.now() - startedAt} jobId=${job.id} - scan start accepted`,
      );
      return { jobId: job.id };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} triggeredBy=${triggeredBy} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - scan start failed`,
      );
      throw err;
    } finally {
      this.scanJobStore.releaseStartLock(libraryId);
    }
  }

  async refreshCovers(libraryId: number): Promise<{ queued: number }> {
    const event = 'scanner.refresh_covers';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} - cover refresh started`);
    try {
      const rows = await this.scannerRepo.findPrimaryBookFilesByLibrary(libraryId);
      const candidates = rows.filter((r) => r.format && METADATA_FORMATS.has(r.format));
      const total = candidates.length;
      const backgroundStartedAt = Date.now();

      this.scanGateway.emitCoverRefreshProgress({ libraryId, processed: 0, total, status: 'running' });

      (async () => {
        let processed = 0;
        let refreshedCount = 0;
        for (let i = 0; i < candidates.length; i += COVER_REFRESH_BATCH_SIZE) {
          const batch = candidates.slice(i, i + COVER_REFRESH_BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(async (row) => {
              const refreshed = await this.metadataService.refreshCoverForBook(row.bookId, row.absolutePath, row.format!);
              return { bookId: row.bookId, refreshed };
            }),
          );
          for (const result of results) {
            processed++;
            if (result.status === 'fulfilled' && result.value.refreshed) {
              refreshedCount++;
              this.scanGateway.emitCoverRefreshed({ bookId: result.value.bookId, libraryId } satisfies CoverRefreshedEvent);
            }
          }
          this.scanGateway.emitCoverRefreshProgress({
            libraryId,
            processed,
            total,
            status: processed < total ? 'running' : 'completed',
          } satisfies CoverRefreshProgressEvent);
        }
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - backgroundStartedAt} queued=${total} processed=${processed} refreshed=${refreshedCount} - cover refresh completed`,
        );
      })().catch((err) => {
        const errorClass = err instanceof Error ? err.name : 'Error';
        const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
        this.logger.warn(
          `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - backgroundStartedAt} errorClass=${errorClass} error="${errorMessage}" - cover refresh crashed`,
        );
      });

      this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} queued=${total} - cover refresh queued`);
      return { queued: total };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover refresh failed`,
      );
      throw err;
    }
  }

  startScanAsync(libraryId: number): void {
    if (this.scanJobStore.isRunning(libraryId) || this.scanJobStore.isStartLocked(libraryId)) {
      this.scanJobStore.markPendingRescan(libraryId);
      return;
    }
    this.startScan(libraryId, 'watcher').catch((err) =>
      this.logger.error(
        `[scanner.start_scan] [fail] libraryId=${libraryId} triggeredBy=watcher errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - auto-scan failed to start`,
      ),
    );
  }

  isScanRunning(libraryId: number): boolean {
    return this.scanJobStore.isRunning(libraryId);
  }

  scanBookFolderAsync(filePath: string, libraryId: number): void {
    this.targetedBookScanQueue.push({ type: 'book', path: filePath, libraryId });
    this.drainTargetedBookScanQueue();
  }

  scanBookDirectoryAsync(dirPath: string, libraryId: number): void {
    this.targetedBookScanQueue.push({ type: 'directory', path: dirPath, libraryId });
    this.drainTargetedBookScanQueue();
  }

  private drainTargetedBookScanQueue(): void {
    while (this.activeTargetedBookScans < TARGETED_BOOK_SCAN_MAX_CONCURRENCY && this.targetedBookScanQueue.length > 0) {
      const job = this.targetedBookScanQueue.shift()!;
      this.activeTargetedBookScans += 1;
      const scan = job.type === 'directory' ? this.scanBookDirectory(job.path, job.libraryId) : this.scanBookFolder(job.path, job.libraryId);
      scan
        .catch((err) =>
          job.type === 'directory'
            ? this.logTargetedDirectoryScanFailure(job.path, job.libraryId, err)
            : this.logTargetedBookScanFailure(job.path, job.libraryId, err),
        )
        .finally(() => {
          this.activeTargetedBookScans -= 1;
          this.drainTargetedBookScanQueue();
        });
    }
  }

  private logTargetedBookScanFailure(filePath: string, libraryId: number, err: unknown): void {
    this.logger.error(
      `[scanner.targeted_book_scan] [fail] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - targeted book scan failed`,
    );
  }

  private logTargetedDirectoryScanFailure(dirPath: string, libraryId: number, err: unknown): void {
    this.logger.error(
      `[scanner.targeted_directory_scan] [fail] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - targeted directory scan failed`,
    );
  }

  private async scanBookFolder(filePath: string, libraryId: number): Promise<void> {
    const event = 'scanner.targeted_book_scan';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" - targeted book scan started`);
    if (this.scanJobStore.isRunning(libraryId)) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} skippedDueToRunningFullScan=true - targeted book scan completed`,
      );
      return;
    }
    const allFolders = await this.scannerRepo.findLibraryFolders(libraryId);
    const libraryFolder = allFolders.find((f) => filePath.startsWith(f.path + sep));
    if (!libraryFolder) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} matchedLibraryFolder=false - targeted book scan completed`,
      );
      return;
    }

    const rawSettings = await this.scannerRepo.findLibrarySettings(libraryId);
    const settings: LibraryScanSettings = {
      allowedFormats: rawSettings?.allowedFormats ?? [],
      formatPriority: rawSettings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY,
      metadataPrecedence: rawSettings?.metadataPrecedence ?? [...LIBRARY_METADATA_PRECEDENCE_DEFAULT],
      excludePatterns: rawSettings?.excludePatterns ?? [],
      organizationMode: normalizeOrganizationMode(rawSettings?.organizationMode),
    };

    if (settings.organizationMode === 'book_per_file') {
      return this.handleScanBookPerFile(filePath, libraryId, libraryFolder, settings, event, startedAt);
    }

    const bookFolder = dirname(filePath);
    if (bookFolder === libraryFolder.path) {
      return this.handleScanRootLevelFile(filePath, libraryId, libraryFolder, settings, event, startedAt);
    }

    return this.handleScanFolderNormal(filePath, libraryId, libraryFolder, settings, event, startedAt);
  }

  private async scanBookDirectory(dirPath: string, libraryId: number): Promise<void> {
    const event = 'scanner.targeted_directory_scan';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" - targeted directory scan started`);

    if (this.scanJobStore.isRunning(libraryId)) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" durationMs=${Date.now() - startedAt} skippedDueToRunningFullScan=true - targeted directory scan completed`,
      );
      return;
    }

    const allFolders = await this.scannerRepo.findLibraryFolders(libraryId);
    const libraryFolder = allFolders.find((f) => dirPath === f.path || dirPath.startsWith(f.path + sep));
    if (!libraryFolder) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" durationMs=${Date.now() - startedAt} matchedLibraryFolder=false - targeted directory scan completed`,
      );
      return;
    }

    const rawSettings = await this.scannerRepo.findLibrarySettings(libraryId);
    const settings: LibraryScanSettings = {
      allowedFormats: rawSettings?.allowedFormats ?? [],
      formatPriority: rawSettings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY,
      metadataPrecedence: rawSettings?.metadataPrecedence ?? [...LIBRARY_METADATA_PRECEDENCE_DEFAULT],
      excludePatterns: rawSettings?.excludePatterns ?? [],
      organizationMode: normalizeOrganizationMode(rawSettings?.organizationMode),
    };

    const walkLogger = (msg: string) =>
      this.logger.warn(
        `[scanner.walk_candidates] [fail] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" error="${sanitizeLogValue(msg)}" - candidate walk warning`,
      );

    let candidates: BookCandidate[];
    let skippedDirs: Set<string>;
    try {
      if (settings.organizationMode === 'book_per_file') {
        const walkResult = await findLooseFileCandidates(dirPath, settings.excludePatterns, walkLogger);
        candidates = walkResult.candidates;
        skippedDirs = walkResult.skippedDirs;
      } else {
        const [singleCandidate, walkResult] = await Promise.all([
          buildSingleBookCandidate(dirPath, libraryFolder.path, settings.excludePatterns, walkLogger),
          findBookCandidates(dirPath, settings.excludePatterns, walkLogger),
        ]);
        const nestedCandidates = walkResult.candidates.filter(
          (candidate) =>
            !(candidate.files.length === 1 && candidate.files[0].absolutePath === candidate.folderPath && dirname(candidate.folderPath) === dirPath),
        );
        candidates = singleCandidate ? [singleCandidate, ...nestedCandidates] : nestedCandidates;
        skippedDirs = walkResult.skippedDirs;
      }
    } catch (err) {
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - cannot walk target directory`,
      );
      return;
    }

    if (candidates.length === 0) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" durationMs=${Date.now() - startedAt} candidateCount=0 skippedDirCount=${skippedDirs.size} - targeted directory scan completed`,
      );
      return;
    }

    candidates = candidates.map((candidate) => ({
      ...candidate,
      files: candidate.files.map((file) => ({ ...file, relPath: relative(libraryFolder.path, file.absolutePath) })),
    }));

    const allowed = settings.allowedFormats.length > 0 ? new Set(settings.allowedFormats) : null;
    if (allowed) {
      candidates = candidates
        .map((candidate) => ({
          ...candidate,
          files: candidate.files.filter((file) => {
            const role = file.role ?? classifyFile(file.absolutePath).role;
            const format = file.format ?? classifyFile(file.absolutePath).format;
            return role !== 'content' || (format !== null && allowed.has(format));
          }),
        }))
        .filter((candidate) => candidate.files.some((file) => (file.role ?? classifyFile(file.absolutePath).role) === 'content'));
    }

    const maps = await this.loadCandidateMaps(dirPath, libraryId);
    const totals = { added: 0, updated: 0 };
    const allRetainedFileIds = new Set<number>();
    const seenBookIds = new Set<number>();
    const importedBookIds: number[] = [];
    const candidateFolderPaths = new Set(candidates.map((candidate) => candidate.folderPath));
    for (const candidate of candidates) {
      const result = await this.processCandidate(
        candidate,
        libraryId,
        libraryFolder.id,
        maps,
        settings.formatPriority,
        settings.metadataPrecedence,
        false,
        candidateFolderPaths,
      );
      this.emitTargetedScanResult(libraryId, result);
      seenBookIds.add(result.bookId);
      if (result.created) importedBookIds.push(result.bookId);
      for (const fid of result.retainedFileIds) allRetainedFileIds.add(fid);
      totals.added += result.added;
      totals.updated += result.updated;
    }

    const pruneCounts = { added: 0, updated: 0 };
    for (const bookId of seenBookIds) {
      await this.pruneMissingBookFiles(bookId, allRetainedFileIds, maps.fileIdsByBookId, maps.fileByPath, maps.fileByIno, pruneCounts);
    }
    totals.updated += pruneCounts.updated;
    await this.scheduleImportedBookMetadataFetch(libraryId, importedBookIds);

    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(dirPath)}" durationMs=${Date.now() - startedAt} candidateCount=${candidates.length} skippedDirCount=${skippedDirs.size} added=${totals.added} updated=${totals.updated} - targeted directory scan completed`,
    );
  }

  private async loadCandidateMaps(folderPath: string, libraryId: number): Promise<ScanLookupMaps> {
    const knownBooks = await this.scannerRepo.findBooksByFolderPath(folderPath, libraryId);
    const knownFiles = await this.scannerRepo.findBookFilesByBookIds(knownBooks.map((b) => b.id));
    return ScannerService.buildLookupMaps(
      knownBooks.map((b) => ({ id: b.id, status: b.status, folderPath: b.folderPath, primaryFileId: b.primaryFileId })),
      knownFiles.map((f) => ({
        id: f.id,
        bookId: f.bookId,
        absolutePath: f.absolutePath,
        ino: f.ino,
        sizeBytes: f.sizeBytes,
        mtime: f.mtime,
        fileHash: f.fileHash,
      })),
    );
  }

  private emitTargetedScanResult(libraryId: number, result: { becameVisible: boolean; added: number; bookId: number }): void {
    if (result.becameVisible) {
      this.bufferBookForEmit(libraryId, result.bookId);
      this.flushBookEmitBuffer(libraryId);
    }
    if (result.added > 0) {
      this.bufferWatcherNotification(libraryId, { added: result.added });
    }
  }

  private async handleScanBookPerFile(
    filePath: string,
    libraryId: number,
    libraryFolder: { id: number; path: string },
    settings: LibraryScanSettings,
    event: string,
    startedAt: number,
  ): Promise<void> {
    const { role, format } = classifyFile(filePath);
    if (role !== 'content') {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} skippedNonContent=true scanScope=file - targeted book scan completed`,
      );
      return;
    }

    const allowed = settings.allowedFormats.length > 0 ? new Set(settings.allowedFormats) : null;
    if (allowed && format !== null && !allowed.has(format)) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} skippedByAllowedFormats=true scanScope=file - targeted book scan completed`,
      );
      return;
    }

    const fileStat = await stat(filePath, { bigint: true }).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} candidateFound=false scanScope=file - targeted book scan completed`,
      );
      return;
    }

    const candidate: BookCandidate = {
      folderPath: filePath,
      files: [
        {
          absolutePath: filePath,
          relPath: relative(libraryFolder.path, filePath),
          ino: clampIno(fileStat.ino),
          sizeBytes: Number(fileStat.size),
          mtime: fileStat.mtime,
          format,
          role,
        },
      ],
    };

    const maps = await this.loadCandidateMaps(filePath, libraryId);
    const result = await this.processCandidate(
      candidate,
      libraryId,
      libraryFolder.id,
      maps,
      settings.formatPriority,
      settings.metadataPrecedence,
      false,
      new Set([candidate.folderPath]),
    );
    await this.pruneMissingBookFiles(result.bookId, result.retainedFileIds, maps.fileIdsByBookId, maps.fileByPath, maps.fileByIno, {
      added: 0,
      updated: 0,
    });
    this.emitTargetedScanResult(libraryId, result);
    await this.scheduleImportedBookMetadataFetch(libraryId, result.created ? [result.bookId] : []);
    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} added=${result.added} updated=${result.updated} scanScope=file - targeted book scan completed`,
    );
  }

  private async handleScanRootLevelFile(
    filePath: string,
    libraryId: number,
    libraryFolder: { id: number; path: string },
    settings: LibraryScanSettings,
    event: string,
    startedAt: number,
  ): Promise<void> {
    const fileStat = await stat(filePath, { bigint: true }).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} candidateFound=false scanScope=root_file - targeted book scan completed`,
      );
      return;
    }

    const { role, format } = classifyFile(filePath);
    if (role !== 'content') {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} skippedNonContent=true scanScope=root_file - targeted book scan completed`,
      );
      return;
    }

    const allowed = settings.allowedFormats.length > 0 ? new Set(settings.allowedFormats) : null;
    if (allowed && format !== null && !allowed.has(format)) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} skippedByAllowedFormats=true scanScope=root_file - targeted book scan completed`,
      );
      return;
    }

    const candidate: BookCandidate = {
      folderPath: filePath,
      files: [
        {
          absolutePath: filePath,
          relPath: relative(libraryFolder.path, filePath),
          ino: clampIno(fileStat.ino),
          sizeBytes: Number(fileStat.size),
          mtime: fileStat.mtime,
          format,
          role,
        },
      ],
    };

    const maps = await this.loadCandidateMaps(filePath, libraryId);
    const result = await this.processCandidate(
      candidate,
      libraryId,
      libraryFolder.id,
      maps,
      settings.formatPriority,
      settings.metadataPrecedence,
      false,
      new Set([candidate.folderPath]),
    );
    await this.pruneMissingBookFiles(result.bookId, result.retainedFileIds, maps.fileIdsByBookId, maps.fileByPath, maps.fileByIno, {
      added: 0,
      updated: 0,
    });
    this.emitTargetedScanResult(libraryId, result);
    await this.scheduleImportedBookMetadataFetch(libraryId, result.created ? [result.bookId] : []);
    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} added=${result.added} updated=${result.updated} scanScope=root_file - targeted book scan completed`,
    );
  }

  private async handleScanFolderNormal(
    filePath: string,
    libraryId: number,
    libraryFolder: { id: number; path: string },
    settings: LibraryScanSettings,
    event: string,
    startedAt: number,
  ): Promise<void> {
    const bookFolder = dirname(filePath);

    // Walk up one level if this folder is a stem-named audio subfolder of its parent
    // (e.g. mp3 files in "BookTitle/" alongside "BookTitle.epub" in the parent).
    // In that case the parent is the real book folder.
    let resolvedBookFolder = bookFolder;
    const parentFolder = dirname(bookFolder);
    if (parentFolder !== bookFolder && parentFolder !== libraryFolder.path) {
      try {
        const parentEntries = await readdir(parentFolder, { withFileTypes: true });
        const folderStem = basename(bookFolder);
        const hasStemSibling = parentEntries.some((e) => {
          if (!e.isFile() || e.name.startsWith('.')) return false;
          const i = e.name.lastIndexOf('.');
          return (i > 0 ? e.name.slice(0, i) : e.name) === folderStem;
        });
        if (hasStemSibling) resolvedBookFolder = parentFolder;
      } catch {
        /* ignore unreadable parent */
      }
    }

    let candidate: BookCandidate | null;
    try {
      candidate = await buildSingleBookCandidate(resolvedBookFolder, libraryFolder.path, settings.excludePatterns, (msg) =>
        this.logger.warn(
          `[scanner.walk_candidates] [fail] libraryId=${libraryId} path="${sanitizeLogValue(resolvedBookFolder)}" error="${sanitizeLogValue(msg)}" - candidate walk warning`,
        ),
      );
    } catch (err) {
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} scanScope=folder errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - cannot walk target book folder`,
      );
      return;
    }

    if (!candidate) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} candidateFound=false scanScope=folder - targeted book scan completed`,
      );
      return;
    }

    const allowed = settings.allowedFormats.length > 0 ? new Set(settings.allowedFormats) : null;
    if (allowed) {
      const filtered = candidate.files.filter((f) => {
        const role = f.role ?? classifyFile(f.absolutePath).role;
        const format = f.format ?? classifyFile(f.absolutePath).format;
        return role !== 'content' || (format !== null && allowed.has(format));
      });
      if (!filtered.some((f) => (f.role ?? classifyFile(f.absolutePath).role) === 'content')) {
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} candidateFound=true skippedByAllowedFormats=true scanScope=folder - targeted book scan completed`,
        );
        return;
      }
      candidate = { ...candidate, files: filtered };
    }

    const maps = await this.loadCandidateMaps(resolvedBookFolder, libraryId);
    const result = await this.processCandidate(
      candidate,
      libraryId,
      libraryFolder.id,
      maps,
      settings.formatPriority,
      settings.metadataPrecedence,
      false,
      new Set([candidate.folderPath]),
    );
    await this.pruneMissingBookFiles(result.bookId, result.retainedFileIds, maps.fileIdsByBookId, maps.fileByPath, maps.fileByIno, {
      added: 0,
      updated: 0,
    });
    this.emitTargetedScanResult(libraryId, result);
    await this.scheduleImportedBookMetadataFetch(libraryId, result.created ? [result.bookId] : []);
    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} path="${sanitizeLogValue(filePath)}" durationMs=${Date.now() - startedAt} scanScope=folder folder="${sanitizeLogValue(basename(resolvedBookFolder))}" added=${result.added} updated=${result.updated} - targeted book scan completed`,
    );
  }

  private async runScan(
    libraryId: number,
    jobId: number,
    folders: Awaited<ReturnType<ScannerRepository['findLibraryFolders']>>,
    allowedFormats: string[],
    formatPriority: string[],
    metadataPrecedence: string[],
    excludePatterns: string[],
    organizationMode: OrganizationMode,
    forceFullScan = false,
  ): Promise<void> {
    const event = 'scanner.run_scan';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] libraryId=${libraryId} jobId=${jobId} folderCount=${folders.length} forceFullScan=${forceFullScan} - scan job started`,
    );

    let totalCandidates = 0;

    const allowed = allowedFormats.length > 0 ? new Set(allowedFormats) : null;

    const totals: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    try {
      this.scanJobStore.setTotal(libraryId, 0);
      this.emitFromStore(libraryId, jobId, 'running');

      for (const folder of folders) {
        let candidates: BookCandidate[] = [];
        let skippedDirs = new Set<string>();
        let unchangedDirs = new Set<string>();
        let dirMtimes = new Map<string, number>();

        // Load stored dir mtimes for incremental scanning (unless forced full)
        let knownDirMtimes: Map<string, number> | undefined;
        if (!forceFullScan) {
          try {
            knownDirMtimes = await this.scannerRepo.findDirScanState(folder.id);
          } catch {
            // If loading fails, fall back to full scan for this folder
          }
        } else {
          await this.scannerRepo.clearDirScanState(folder.id).catch(() => {});
        }

        try {
          const walkLogger = (msg: string) =>
            this.logger.warn(
              `[scanner.walk_candidates] [fail] libraryId=${libraryId} path="${sanitizeLogValue(folder.path)}" error="${sanitizeLogValue(msg)}" - candidate walk warning`,
            );
          const walkResult: WalkResult =
            organizationMode === 'book_per_file'
              ? await findLooseFileCandidates(folder.path, excludePatterns, walkLogger, knownDirMtimes)
              : await findBookCandidates(folder.path, excludePatterns, walkLogger, knownDirMtimes);
          candidates = walkResult.candidates;
          skippedDirs = walkResult.skippedDirs;
          unchangedDirs = walkResult.unchangedDirs;
          dirMtimes = walkResult.dirMtimes;
        } catch (err) {
          this.logger.warn(
            `[${event}] [fail] libraryId=${libraryId} jobId=${jobId} path="${sanitizeLogValue(folder.path)}" durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - cannot walk folder`,
          );
        }

        if (allowed) {
          candidates = candidates
            .map((c) => ({
              ...c,
              files: c.files.filter((f) => {
                const role = f.role ?? classifyFile(f.absolutePath).role;
                const format = f.format ?? classifyFile(f.absolutePath).format;
                return role !== 'content' || (format !== null && allowed.has(format));
              }),
            }))
            .filter((c) => c.files.some((f) => (f.role ?? classifyFile(f.absolutePath).role) === 'content'));
        }

        totalCandidates += candidates.length;
        this.scanJobStore.setTotal(libraryId, totalCandidates);

        const counts = await this.scanFolderCandidates(
          folder.id,
          libraryId,
          candidates,
          jobId,
          formatPriority,
          metadataPrecedence,
          skippedDirs,
          unchangedDirs,
        );
        totals.addedCount += counts.addedCount;
        totals.updatedCount += counts.updatedCount;
        totals.missingCount += counts.missingCount;

        // Persist dir scan state after successful folder processing
        if (dirMtimes.size > 0) {
          try {
            const entries = [...dirMtimes].map(([dirPath, mtimeMs]) => ({ dirPath, mtimeMs }));
            await this.scannerRepo.upsertDirScanState(folder.id, entries);
            await this.scannerRepo.deleteStaleDirScanState(folder.id, new Set(dirMtimes.keys()));
          } catch (err) {
            this.logger.warn(
              `[${event}] [fail] libraryId=${libraryId} jobId=${jobId} libraryFolderId=${folder.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - dir scan state persistence failed`,
            );
          }
        }
      }

      await this.scannerRepo.completeScanJob(jobId, totals);
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} jobId=${jobId} durationMs=${Date.now() - startedAt} addedCount=${totals.addedCount} updatedCount=${totals.updatedCount} missingCount=${totals.missingCount} - scan job completed`,
      );
      this.scanJobStore.increment(libraryId, { added: totals.addedCount, updated: totals.updatedCount });
      this.emitFromStore(libraryId, jobId, 'completed');

      this.notificationService
        .notify({
          type: NotificationType.ScanCompleted,
          title: 'Library scan completed',
          message: `Added ${totals.addedCount} books, updated ${totals.updatedCount}, ${totals.missingCount} missing`,
          scope: { kind: 'library', libraryId },
          meta: { libraryId, jobId, ...totals },
        })
        .catch(() => {});

      if (totals.addedCount > 0 || totals.updatedCount > 0 || totals.missingCount > 0) {
        this.emitLibraryCatalogChangedForLibrary(libraryId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.scannerRepo.failScanJob(jobId, message).catch(() => {
        // Job row may have been cascade-deleted if library was deleted.
      });
      this.logger.error(
        `[${event}] [fail] libraryId=${libraryId} jobId=${jobId} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(message)}" - scan job failed`,
      );
      this.emitFromStore(libraryId, jobId, 'failed', message);

      this.notificationService
        .notify({
          type: NotificationType.ScanFailed,
          title: 'Library scan failed',
          message: message.slice(0, 200),
          scope: { kind: 'library', libraryId },
          meta: { libraryId, jobId },
        })
        .catch(() => {});
    } finally {
      this.flushBookEmitBuffer(libraryId);
      this.flushBooksUnavailableNotification(libraryId);
      this.flushBooksRestoredNotification(libraryId);
      this.scanJobStore.delete(libraryId);

      if (this.scanJobStore.consumePendingRescan(libraryId)) {
        this.startScanAsync(libraryId);
      }
    }
  }

  private async scanFolderCandidates(
    libraryFolderId: number,
    libraryId: number,
    candidates: BookCandidate[],
    jobId: number,
    formatPriority: string[],
    metadataPrecedence: string[],
    skippedDirs: Set<string> = new Set(),
    unchangedDirs: Set<string> = new Set(),
  ): Promise<ScanCounts> {
    const event = 'scanner.scan_folder_candidates';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] libraryId=${libraryId} jobId=${jobId} libraryFolderId=${libraryFolderId} candidateCount=${candidates.length} skippedDirCount=${skippedDirs.size} unchangedDirCount=${unchangedDirs.size} - folder candidate scan started`,
    );
    try {
      const counts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
      const [knownBooks, knownFiles] = await Promise.all([
        this.scannerRepo.findBooksByLibraryFolder(libraryFolderId),
        this.scannerRepo.findBookFilesByLibraryFolder(libraryFolderId),
      ]);

      const isFirstScan = knownBooks.length === 0 && knownFiles.length === 0;
      const maps = ScannerService.buildLookupMaps(knownBooks, knownFiles);

      const seenBookIds = new Set<number>();
      const allRetainedFileIds = new Set<number>();
      const importedBookIds: number[] = [];
      const candidateFolderPaths = new Set(candidates.map((candidate) => candidate.folderPath));

      for (const candidate of candidates) {
        const result = await this.processCandidate(
          candidate,
          libraryId,
          libraryFolderId,
          maps,
          formatPriority,
          metadataPrecedence,
          isFirstScan,
          candidateFolderPaths,
        );
        seenBookIds.add(result.bookId);
        if (result.created) importedBookIds.push(result.bookId);
        for (const fid of result.retainedFileIds) allRetainedFileIds.add(fid);
        counts.addedCount += result.added;
        counts.updatedCount += result.updated;
        if (result.becameVisible) {
          this.bufferBookForEmit(libraryId, result.bookId);
          this.flushBookEmitBuffer(libraryId);
        }

        const entry = this.scanJobStore.increment(libraryId, { processed: 1 });
        if (entry && this.scanJobStore.shouldEmit(entry)) {
          this.emitFromStore(libraryId, jobId, 'running');
          this.scanJobStore.markEmitted(entry);
        }
      }

      // Deferred prune: delete book files not retained by any candidate.
      // Must happen after ALL batches so cross-book file moves are visible.
      const pruneCounts = { added: 0, updated: 0 };
      for (const bookId of seenBookIds) {
        await this.pruneMissingBookFiles(bookId, allRetainedFileIds, maps.fileIdsByBookId, maps.fileByPath, maps.fileByIno, pruneCounts);
      }
      counts.updatedCount += pruneCounts.updated;

      // Don't mark books as missing if their folder was skipped due to permission errors
      const isUnderSkippedDir = (folderPath: string) => {
        for (const dir of skippedDirs) {
          if (folderPath === dir || folderPath.startsWith(dir + sep)) return true;
        }
        return false;
      };
      // Incremental scan: don't mark books as missing if their folder was unchanged
      const isInUnchangedDir = (folderPath: string) => {
        // For book_per_folder: folderPath is the dir itself
        if (unchangedDirs.has(folderPath)) return true;
        // For book_per_file: folderPath is the file path, check its parent dir
        const parentDir = dirname(folderPath);
        if (unchangedDirs.has(parentDir)) return true;
        return false;
      };
      const missingCandidates = knownBooks
        .filter((b) => !seenBookIds.has(b.id) && !isUnderSkippedDir(b.folderPath) && !isInUnchangedDir(b.folderPath))
        .map((b) => b.id);
      const missingIds = await this.filterBookIdsMissingOnDisk(missingCandidates);
      if (missingIds.length > 0) {
        await this.scannerRepo.markBooksAsMissing(missingIds);
        counts.missingCount += missingIds.length;
        this.scanJobStore.increment(libraryId, { missing: missingIds.length });
        this.scanGateway.emitBookMissing({ libraryId, bookIds: missingIds } satisfies BookMissingEvent);
        this.bufferBooksUnavailableNotification(libraryId, missingIds);
      }

      await this.scheduleImportedBookMetadataFetch(libraryId, importedBookIds);

      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} jobId=${jobId} libraryFolderId=${libraryFolderId} durationMs=${Date.now() - startedAt} addedCount=${counts.addedCount} updatedCount=${counts.updatedCount} missingCount=${counts.missingCount} - folder candidate scan completed`,
      );
      return counts;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} jobId=${jobId} libraryFolderId=${libraryFolderId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - folder candidate scan failed`,
      );
      throw err;
    }
  }

  private async processCandidate(
    candidate: BookCandidate,
    libraryId: number,
    libraryFolderId: number,
    maps: ScanLookupMaps,
    formatPriority: string[],
    metadataPrecedence: string[],
    isFirstScan: boolean,
    candidateFolderPaths: Set<string>,
  ): Promise<ProcessCandidateResult> {
    const { bookByFolderPath, booksByParentDir, fileByPath, fileByIno } = maps;
    const counts = { added: 0, updated: 0 };
    const fileCounts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
    const retainedFileIds = new Set<number>();

    const book = await this.upsertBook(
      candidate,
      libraryId,
      libraryFolderId,
      bookByFolderPath,
      booksByParentDir,
      fileByPath,
      fileByIno,
      fileCounts,
      candidateFolderPaths,
    );
    // If the book was transferred from another library, its files exist globally
    // but not in our local maps - we need global lookups even on a "first scan"
    const skipGlobalLookups = isFirstScan && fileCounts.addedCount > 0;
    counts.added += fileCounts.addedCount;
    counts.updated += fileCounts.updatedCount;

    // Phase 1: Register every file in bookFiles. No metadata extraction yet.
    const registeredFiles: RegisteredFile[] = [];

    for (let sortOrder = 0; sortOrder < candidate.files.length; sortOrder++) {
      const fileStat = candidate.files[sortOrder];
      const format = fileStat.format ?? classifyFile(fileStat.absolutePath).format;
      const role = fileStat.role ?? classifyFile(fileStat.absolutePath).role;

      if (role === 'content' && fileStat.sizeBytes === 0) {
        this.logger.warn(
          `[scanner.process_file] [fail] bookId=${book.id} path="${sanitizeLogValue(fileStat.absolutePath)}" reason=zero_byte_content - content file skipped`,
        );
        continue;
      }

      const fileCount: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
      let processResult: ProcessedFileResult;

      try {
        processResult = await this.processFile(
          fileStat,
          format,
          role,
          sortOrder,
          book.id,
          libraryFolderId,
          fileByPath,
          fileByIno,
          fileCount,
          skipGlobalLookups,
        );
      } catch (err) {
        this.logger.warn(
          `[scanner.process_file] [fail] bookId=${book.id} path="${sanitizeLogValue(fileStat.absolutePath)}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - file processing failed`,
        );
        continue;
      }

      counts.updated += fileCount.addedCount + fileCount.updatedCount;

      if (processResult.fileId !== null) {
        registeredFiles.push({
          fileId: processResult.fileId,
          format,
          role,
          absolutePath: fileStat.absolutePath,
          isNew: processResult.isNew,
          wasReassigned: processResult.reassigned,
          wasChanged: processResult.changed,
        });
        retainedFileIds.add(processResult.fileId);
      }
    }

    // Phase 2: Pick winner (primary file) from all registered content files.
    const contentFiles = registeredFiles.filter((f) => f.role === 'content');

    const winner =
      formatPriority.reduce<RegisteredFile | null>((found, fmt) => found ?? contentFiles.find((f) => f.format === fmt) ?? null, null) ??
      contentFiles[0] ??
      null;

    await this.scannerRepo.updateBookPrimaryFile(book.id, winner?.fileId ?? null);

    // Phase 3: Metadata extraction, source-precedence driven, triggered by new/reassigned/changed metadata sources.
    //
    // Design rules:
    //   - Text metadata (title, authors, cover, etc.) comes from the first available configured source.
    //   - Audio-specific fields (chapters, narrators, duration) always come from audio if present.
    //   - Extraction only fires when at least one configured metadata source is new, reassigned, or changed.

    const metadataSources = this.buildMetadataExtractionSources(registeredFiles, winner, metadataPrecedence);
    const shouldExtractMetadata =
      metadataSources.some((source) => hasMetadataSourceChanged(source.file)) || (book.primaryFileId === null && winner !== null);
    const audioContentFiles = contentFiles.filter((f) => f.format !== null && isAudioFormat(f.format!));
    const changedAudioFiles = audioContentFiles.filter(hasMetadataSourceChanged);
    const winnerIsAudio = winner !== null && winner.format !== null && isAudioFormat(winner.format);

    // 3a: Extract shared metadata from the first available configured source.
    if (shouldExtractMetadata) {
      await this.extractFirstAvailableMetadataSource(book.id, metadataSources);
    }

    // 3b: When winner is not audio, extract audio-specific fields (chapters, narrators)
    //     from the first audio file if any audio file is new, reassigned, or changed.
    //     Cover is intentionally skipped here - shared metadata already owns it from step 3a.
    if (!winnerIsAudio && changedAudioFiles.length > 0) {
      const sortedAudio = [...audioContentFiles].sort((a, b) =>
        basename(a.absolutePath).localeCompare(basename(b.absolutePath), undefined, { numeric: true }),
      );
      const firstAudio = sortedAudio[0];
      try {
        await this.metadataService.extractAudioChaptersAndNarrators(book.id, firstAudio.absolutePath, firstAudio.format!);
      } catch (err) {
        this.logger.warn(
          `[scanner.extract_audio_chapters] [fail] bookId=${book.id} path="${sanitizeLogValue(firstAudio.absolutePath)}" format=${firstAudio.format} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - audio chapters/narrators extraction failed`,
        );
      }
    }

    // 3c: Write per-file duration to bookFiles for every new/reassigned/changed audio file.
    //     Running this for all new audio files (including the winner) ensures
    //     aggregateAudioDuration has accurate per-file data for the total.
    if (changedAudioFiles.length > 0) {
      await Promise.all(
        changedAudioFiles.map(async (audioFile) => {
          try {
            await this.metadataService.extractAudioFileDuration(book.id, audioFile.absolutePath);
          } catch (err) {
            this.logger.warn(
              `[scanner.extract_audio_duration] [fail] bookId=${book.id} path="${sanitizeLogValue(audioFile.absolutePath)}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - audio duration extraction failed`,
            );
          }
        }),
      );
    }

    // 3d: Re-aggregate total duration whenever audio files exist and anything changed.
    if (audioContentFiles.length > 0 && (shouldExtractMetadata || changedAudioFiles.length > 0)) {
      try {
        await this.metadataService.aggregateAudioDuration(book.id);
      } catch (err) {
        this.logger.warn(
          `[scanner.aggregate_audio_duration] [fail] bookId=${book.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - audio duration aggregation failed`,
        );
      }
    }

    const becameVisible = await this.scannerRepo.promoteProcessingBookToPresent(book.id);
    return { bookId: book.id, ...counts, retainedFileIds, becameVisible, created: book.created };
  }

  private buildMetadataExtractionSources(
    registeredFiles: RegisteredFile[],
    winner: RegisteredFile | null,
    metadataPrecedence: string[],
  ): MetadataExtractionSource[] {
    const sourcesByKey = new Map<ScannerMetadataSource, MetadataExtractionSource>();

    if (winner?.format && METADATA_FORMATS.has(winner.format)) {
      sourcesByKey.set('embedded', { key: 'embedded', file: winner, format: winner.format });
    }

    const opfFile = this.selectOpfMetadataFile(registeredFiles, winner);
    if (opfFile) {
      sourcesByKey.set('opfFile', { key: 'opfFile', file: opfFile, format: 'opf' });
    }

    return normalizeMetadataPrecedence(metadataPrecedence).flatMap((sourceKey) => {
      const source = sourcesByKey.get(sourceKey);
      return source ? [source] : [];
    });
  }

  private selectOpfMetadataFile(registeredFiles: RegisteredFile[], winner: RegisteredFile | null): RegisteredFile | null {
    const opfFiles = registeredFiles.filter((file) => file.role === 'metadata' && file.format === 'opf');
    if (opfFiles.length === 0) return null;

    const metadataOpf = opfFiles.find((file) => basename(file.absolutePath).toLowerCase() === 'metadata.opf');
    if (metadataOpf) return metadataOpf;

    if (winner) {
      const winnerStem = fileStem(winner.absolutePath);
      const stemMatch = opfFiles.find((file) => fileStem(file.absolutePath) === winnerStem);
      if (stemMatch) return stemMatch;
    }

    return [...opfFiles].sort((a, b) => basename(a.absolutePath).localeCompare(basename(b.absolutePath), undefined, { numeric: true }))[0] ?? null;
  }

  private async extractFirstAvailableMetadataSource(bookId: number, sources: MetadataExtractionSource[]): Promise<void> {
    for (const source of sources) {
      try {
        const extracted = await this.extractMetadataSource(bookId, source.file.absolutePath, source.format);
        if (extracted) return;
      } catch (err) {
        this.logger.warn(
          `[scanner.extract_metadata] [fail] bookId=${bookId} source=${source.key} path="${sanitizeLogValue(source.file.absolutePath)}" format=${source.format} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - metadata extraction failed`,
        );
        return;
      }
    }
  }

  private async extractMetadataSource(bookId: number, absolutePath: string, format: string): Promise<boolean> {
    const metadataService = this.metadataService as MetadataService & {
      extractAndSaveIfAvailable?: (bookId: number, absolutePath: string, format: string) => Promise<boolean>;
    };

    if (typeof metadataService.extractAndSaveIfAvailable === 'function') {
      return metadataService.extractAndSaveIfAvailable(bookId, absolutePath, format);
    }

    await this.metadataService.extractAndSave(bookId, absolutePath, format);
    return true;
  }

  private async upsertBook(
    candidate: BookCandidate,
    libraryId: number,
    libraryFolderId: number,
    bookByFolderPath: Map<string, BookEntry>,
    booksByParentDir: Map<string, BookEntry[]>,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: ScanCounts,
    candidateFolderPaths: Set<string>,
  ): Promise<UpsertBookResult> {
    const existing = bookByFolderPath.get(candidate.folderPath);
    const candidateOwnedBookIds = new Set<number>();
    for (const file of candidate.files) {
      const byPath = fileByPath.get(file.absolutePath);
      if (byPath) candidateOwnedBookIds.add(byPath.bookId);
      if (file.ino !== 0) {
        const byIno = fileByIno.get(file.ino);
        if (byIno) candidateOwnedBookIds.add(byIno.bookId);
      }
    }

    if (!existing) {
      // Detect series-to-single-book merge: files were renamed so all stems match,
      // turning what was a virtual multi-book folder into one real-directory book.
      // Find any known books whose folderPaths are virtual children of this directory
      // and pick the lowest-ID one as the survivor to preserve its reading progress.
      // Use pre-built parent-dir index instead of O(N) filter
      const virtualChildren = (booksByParentDir.get(candidate.folderPath) ?? []).filter(
        (b) =>
          b.folderPath !== candidate.folderPath &&
          b.folderPath.startsWith(candidate.folderPath + sep) &&
          !candidateFolderPaths.has(b.folderPath) &&
          candidateOwnedBookIds.has(b.id),
      );

      if (virtualChildren.length > 0) {
        const survivor = virtualChildren.reduce((a, b) => (a.id < b.id ? a : b));
        await this.scannerRepo.updateBookFolderPath(survivor.id, candidate.folderPath);
        if (survivor.status === 'missing') {
          await this.scannerRepo.updateBookStatus(survivor.id, 'present');
          counts.updatedCount++;
          this.scanGateway.emitBookRestored({ libraryId, bookIds: [survivor.id] });
          this.bufferBooksRestoredNotification(libraryId, [survivor.id]);
        }
        bookByFolderPath.set(candidate.folderPath, { ...survivor, folderPath: candidate.folderPath });
        this.logger.log(
          `[scanner.upsert_book] [end] libraryId=${libraryId} bookId=${survivor.id} folder="${sanitizeLogValue(candidate.folderPath)}" mergedCount=${virtualChildren.length} action=merge_stem_split - stem-split books merged`,
        );
        return { ...survivor, folderPath: candidate.folderPath, created: false };
      }

      const movedInLibrary = await this.tryReuseMovedBookInLibrary(candidate, libraryId, bookByFolderPath, fileByPath, fileByIno, counts);
      if (movedInLibrary) return { ...movedInLibrary, created: false };

      const transferred = await this.tryTransferMissingBook(candidate, libraryId, libraryFolderId, bookByFolderPath, counts);
      if (transferred) return { ...transferred, created: false };

      const book = await this.scannerRepo.createBook({
        libraryId,
        libraryFolderId,
        folderPath: candidate.folderPath,
        status: 'processing',
      });
      counts.addedCount++;
      const entry = { id: book.id, status: book.status, folderPath: book.folderPath, primaryFileId: book.primaryFileId ?? null };
      bookByFolderPath.set(candidate.folderPath, entry);
      return { ...entry, created: true };
    }

    if (existing.status === 'missing') {
      await this.scannerRepo.updateBookStatus(existing.id, 'present');
      counts.updatedCount++;
      this.scanGateway.emitBookRestored({ libraryId, bookIds: [existing.id] });
      this.bufferBooksRestoredNotification(libraryId, [existing.id]);
    }

    // Defer virtual sibling cleanup until the final missing pass so real nested
    // book folders can still be processed when their own candidates appear later.
    // Use pre-built parent-dir index instead of O(N) filter.
    const virtualSiblings = (booksByParentDir.get(candidate.folderPath) ?? []).filter(
      (b) =>
        b.id !== existing.id &&
        b.folderPath !== candidate.folderPath &&
        b.folderPath.startsWith(candidate.folderPath + sep) &&
        !candidateFolderPaths.has(b.folderPath),
    );
    if (virtualSiblings.length > 0) {
      this.logger.log(
        `[scanner.upsert_book] [end] libraryId=${libraryId} bookId=${existing.id} folder="${sanitizeLogValue(candidate.folderPath)}" siblingCount=${virtualSiblings.length} action=defer_virtual_siblings - virtual sibling cleanup deferred`,
      );
    }

    return { ...existing, created: false };
  }

  private async scheduleImportedBookMetadataFetch(libraryId: number, bookIds: readonly number[]): Promise<void> {
    const ids = [...new Set(bookIds)].filter((bookId) => Number.isInteger(bookId) && bookId > 0);
    if (ids.length === 0 || !this.autoFetchOrchestrator) return;

    const event = 'scanner.schedule_metadata_fetch';
    const startedAt = Date.now();
    this.logger.debug(`[${event}] [start] libraryId=${libraryId} bookCount=${ids.length} - metadata fetch scheduling started`);
    try {
      const queued = await this.autoFetchOrchestrator.scheduleImportedBooksIfEligible(libraryId, ids);
      this.logger.debug(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} bookCount=${ids.length} queued=${queued} - metadata fetch scheduling completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} bookCount=${ids.length} errorClass=${errorClass} error="${errorMessage}" - metadata fetch scheduling failed`,
      );
    }
  }

  private async tryReuseMovedBookInLibrary(
    candidate: BookCandidate,
    libraryId: number,
    bookByFolderPath: Map<string, BookEntry>,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: ScanCounts,
  ): Promise<BookEntry | null> {
    const contentFiles = candidate.files.filter((file) => {
      const role = file.role ?? classifyFile(file.absolutePath).role;
      return role === 'content' && file.sizeBytes > 0;
    });
    if (contentFiles.length === 0) return null;
    const isFileAsBookCandidate = contentFiles.length === 1 && candidate.folderPath === contentFiles[0].absolutePath;

    let sourceBookId: number | null = null;

    for (const file of contentFiles) {
      if (file.ino === 0) continue;
      const byIno = fileByIno.get(file.ino);
      if (!byIno || byIno.absolutePath === file.absolutePath) continue;
      sourceBookId = byIno.bookId;
      break;
    }

    if (sourceBookId == null && !isFileAsBookCandidate) {
      for (const file of contentFiles) {
        let fileHash: string;
        try {
          fileHash = await computeFileHash(file.absolutePath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'EACCES') continue;
          throw err;
        }
        const byHash = this.findLocalFileByHash(fileHash, file.absolutePath, fileByPath);
        if (!byHash) continue;
        sourceBookId = byHash.bookId;
        break;
      }
    }

    if (sourceBookId == null) return null;

    const sourceBook = this.findBookEntryById(bookByFolderPath, sourceBookId);
    if (!sourceBook) return null;
    if (sourceBook.folderPath === candidate.folderPath) return sourceBook;

    await this.scannerRepo.updateBookFolderPath(sourceBook.id, candidate.folderPath);

    const restored = sourceBook.status === 'missing';
    if (restored) {
      await this.scannerRepo.updateBookStatus(sourceBook.id, 'present');
      counts.updatedCount++;
      this.scanGateway.emitBookRestored({ libraryId, bookIds: [sourceBook.id] });
      this.bufferBooksRestoredNotification(libraryId, [sourceBook.id]);
    }

    const moved: BookEntry = {
      id: sourceBook.id,
      status: restored ? 'present' : sourceBook.status,
      folderPath: candidate.folderPath,
      primaryFileId: sourceBook.primaryFileId,
    };
    bookByFolderPath.delete(sourceBook.folderPath);
    bookByFolderPath.set(candidate.folderPath, moved);
    this.logger.log(
      `[scanner.upsert_book] [end] libraryId=${libraryId} bookId=${moved.id} folder="${sanitizeLogValue(candidate.folderPath)}" action=reuse_moved_book - reused existing book for moved folder`,
    );
    return moved;
  }

  private findBookEntryById(bookByFolderPath: Map<string, BookEntry>, bookId: number): BookEntry | null {
    for (const entry of bookByFolderPath.values()) {
      if (entry.id === bookId) return entry;
    }
    return null;
  }

  private findLocalFileByHash(fileHash: string, absolutePath: string, fileByPath: Map<string, FileByPathEntry>): FileByPathEntry | null {
    for (const [path, entry] of fileByPath) {
      if (path === absolutePath) continue;
      if (entry.fileHash === fileHash) return entry;
    }
    return null;
  }

  private async filterBookIdsMissingOnDisk(bookIds: number[]): Promise<number[]> {
    if (bookIds.length === 0) return [];

    const files = (await this.scannerRepo.findBookFilesByBookIds(bookIds)).filter((file) => file.role === 'content');
    const presentBookIds = new Set<number>();

    for (let i = 0; i < files.length; i += MISSING_FILE_STAT_BATCH_SIZE) {
      const batch = files.slice(i, i + MISSING_FILE_STAT_BATCH_SIZE);
      await Promise.all(
        batch.map(async (file) => {
          const fileStat = await stat(file.absolutePath).catch(() => null);
          if (fileStat?.isFile()) presentBookIds.add(file.bookId);
        }),
      );
    }

    return bookIds.filter((bookId) => !presentBookIds.has(bookId));
  }

  private async tryTransferMissingBook(
    candidate: BookCandidate,
    libraryId: number,
    libraryFolderId: number,
    bookByFolderPath: Map<string, BookEntry>,
    counts: ScanCounts,
  ): Promise<BookEntry | null> {
    const contentFiles = candidate.files.filter((file) => {
      const role = file.role ?? classifyFile(file.absolutePath).role;
      return role === 'content' && file.sizeBytes > 0;
    });
    if (contentFiles.length === 0) return null;

    let sourceBookId: number | null = null;
    let sourceLibraryId: number | null = null;

    for (const file of contentFiles) {
      if (file.ino === 0) continue;
      const byIno = await this.scannerRepo.findMissingBookFileWithContextByIno(file.ino);
      if (!byIno) continue;
      sourceBookId = byIno.file.bookId;
      sourceLibraryId = byIno.libraryId;
      break;
    }

    if (sourceBookId == null) {
      for (const file of contentFiles) {
        if (file.ino === 0) continue;
        const byIno = await this.scannerRepo.findBookFileWithContextByIno(file.ino);
        if (!byIno || byIno.file.absolutePath === file.absolutePath) continue;
        const previousPathStat = await stat(byIno.file.absolutePath).catch(() => null);
        if (previousPathStat?.isFile()) continue;
        sourceBookId = byIno.file.bookId;
        sourceLibraryId = byIno.libraryId;
        break;
      }
    }

    if (sourceBookId == null) {
      for (const file of contentFiles) {
        let fileHash: string;
        try {
          fileHash = await computeFileHash(file.absolutePath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'EACCES') continue;
          throw err;
        }

        const byHash = await this.scannerRepo.findMissingBookFileWithContextByHash(fileHash);
        if (byHash) {
          sourceBookId = byHash.file.bookId;
          sourceLibraryId = byHash.libraryId;
          break;
        }

        const byHashAny = await this.scannerRepo.findBookFileWithContextByHash(fileHash);
        if (!byHashAny || byHashAny.file.absolutePath === file.absolutePath) continue;
        const previousPathStat = await stat(byHashAny.file.absolutePath).catch(() => null);
        if (previousPathStat?.isFile()) continue;
        sourceBookId = byHashAny.file.bookId;
        sourceLibraryId = byHashAny.libraryId;
        break;
      }
    }

    if (sourceBookId == null) return null;

    const moved = await this.scannerRepo.moveBookToLibrary(sourceBookId, libraryId, libraryFolderId, candidate.folderPath);
    if (!moved) return null;

    counts.updatedCount++;
    const previousLibraryId = moved.previousLibraryId ?? sourceLibraryId;
    if (previousLibraryId != null) this.cancelBooksUnavailableNotification(previousLibraryId, [sourceBookId]);
    const libraryChanged = moved.libraryChanged ?? (previousLibraryId != null && previousLibraryId !== libraryId);
    if (libraryChanged && previousLibraryId != null && previousLibraryId !== libraryId) {
      this.scanGateway.emitBookTransferred({
        fromLibraryId: previousLibraryId,
        toLibraryId: libraryId,
        bookIds: [moved.id],
      } satisfies BookTransferredEvent);
    }
    const transferred = { id: moved.id, status: moved.status, folderPath: moved.folderPath };
    bookByFolderPath.set(candidate.folderPath, transferred);
    this.logger.log(
      `[scanner.upsert_book] [end] libraryId=${libraryId} bookId=${moved.id} folder="${sanitizeLogValue(candidate.folderPath)}" action=transfer_missing_book - missing book transferred into destination library`,
    );
    return transferred;
  }

  private async processFile(
    fileStat: FileStat,
    format: string | null,
    role: FileRole,
    sortOrder: number,
    bookId: number,
    libraryFolderId: number,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: ScanCounts,
    isFirstScan: boolean,
  ): Promise<ProcessedFileResult> {
    const byPath = fileByPath.get(fileStat.absolutePath);
    if (byPath) {
      return this.resolveExistingFilePath(byPath, fileStat, format, role, sortOrder, bookId, libraryFolderId, fileByPath, fileByIno, counts);
    }

    await waitForStability(fileStat.absolutePath, fileStat.mtime.getTime());

    if (fileStat.ino !== 0) {
      const byInoResult = await this.resolveByLocalIno(fileStat, format, role, sortOrder, bookId, libraryFolderId, fileByPath, fileByIno, counts);
      if (byInoResult) return byInoResult;

      if (!isFirstScan) {
        const byGlobalInoResult = await this.resolveByGlobalIno(
          fileStat,
          format,
          role,
          sortOrder,
          bookId,
          libraryFolderId,
          fileByPath,
          fileByIno,
          counts,
        );
        if (byGlobalInoResult) return byGlobalInoResult;
      }
    }

    return this.resolveByHashOrCreate(fileStat, format, role, sortOrder, bookId, libraryFolderId, fileByPath, fileByIno, counts, isFirstScan);
  }

  private async resolveExistingFilePath(
    byPath: FileByPathEntry,
    fileStat: FileStat,
    format: string | null,
    role: FileRole,
    sortOrder: number,
    bookId: number,
    libraryFolderId: number,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: ScanCounts,
  ): Promise<ProcessedFileResult & { fileId: number }> {
    const sizeUnchanged = fileStat.sizeBytes === byPath.sizeBytes;
    const mtimeUnchanged = fileStat.mtime.getTime() === byPath.mtime?.getTime();
    const reassigned = byPath.bookId !== bookId;
    const sortOrderUnchanged = sortOrder === byPath.sortOrder;

    if (sizeUnchanged && mtimeUnchanged && !reassigned && sortOrderUnchanged) {
      return { isNew: false, reassigned: false, changed: false, fileId: byPath.id };
    }

    await waitForStability(fileStat.absolutePath, fileStat.mtime.getTime());

    if (!sizeUnchanged || !mtimeUnchanged || reassigned) {
      await this.scannerRepo.updateBookFile(byPath.id, {
        ...(reassigned && { bookId }),
        libraryFolderId,
        ino: fileStat.ino,
        sizeBytes: fileStat.sizeBytes,
        mtime: fileStat.mtime,
        format,
        role,
        sortOrder,
      });
      counts.updatedCount++;
    } else {
      await this.scannerRepo.updateBookFile(byPath.id, { sortOrder });
    }
    if (byPath.ino !== fileStat.ino) {
      const previousIno = fileByIno.get(byPath.ino);
      if (previousIno?.id === byPath.id) {
        fileByIno.delete(byPath.ino);
      }
    }
    fileByPath.set(fileStat.absolutePath, {
      id: byPath.id,
      bookId,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      fileHash: byPath.fileHash,
      sortOrder,
    });
    if (fileStat.ino !== 0) {
      fileByIno.set(fileStat.ino, {
        id: byPath.id,
        bookId,
        absolutePath: fileStat.absolutePath,
        sizeBytes: fileStat.sizeBytes,
        mtime: fileStat.mtime,
      });
    }
    return { isNew: false, reassigned, changed: !sizeUnchanged || !mtimeUnchanged, fileId: byPath.id };
  }

  private async resolveByLocalIno(
    fileStat: FileStat,
    format: string | null,
    role: FileRole,
    sortOrder: number,
    bookId: number,
    libraryFolderId: number,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: ScanCounts,
  ): Promise<(ProcessedFileResult & { fileId: number }) | null> {
    const byIno = fileByIno.get(fileStat.ino);
    if (!byIno) return null;

    const oldAbsolutePath = byIno.absolutePath;
    const sizeUnchanged = fileStat.sizeBytes === byIno.sizeBytes;
    const mtimeUnchanged = fileStat.mtime.getTime() === byIno.mtime?.getTime();
    await this.scannerRepo.updateBookFile(byIno.id, {
      bookId,
      libraryFolderId,
      absolutePath: fileStat.absolutePath,
      relPath: fileStat.relPath,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      format,
      role,
      sortOrder,
    });
    counts.updatedCount++;
    const oldPathEntry = fileByPath.get(oldAbsolutePath);
    if (oldPathEntry?.id === byIno.id) {
      fileByPath.delete(oldAbsolutePath);
    }
    fileByPath.set(fileStat.absolutePath, {
      id: byIno.id,
      bookId,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      fileHash: oldPathEntry?.fileHash ?? null,
      sortOrder,
    });
    fileByIno.set(fileStat.ino, { id: byIno.id, bookId, absolutePath: fileStat.absolutePath, sizeBytes: fileStat.sizeBytes, mtime: fileStat.mtime });
    return { isNew: false, reassigned: byIno.bookId !== bookId, changed: !sizeUnchanged || !mtimeUnchanged, fileId: byIno.id };
  }

  private async resolveByGlobalIno(
    fileStat: FileStat,
    format: string | null,
    role: FileRole,
    sortOrder: number,
    bookId: number,
    libraryFolderId: number,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: ScanCounts,
  ): Promise<(ProcessedFileResult & { fileId: number }) | null> {
    let globalByIno = await this.scannerRepo.findBookFileWithContextByIno(fileStat.ino);
    if (
      !globalByIno ||
      globalByIno.file.absolutePath === fileStat.absolutePath ||
      (globalByIno.file.bookId !== bookId && globalByIno.bookStatus !== 'missing')
    ) {
      globalByIno = await this.scannerRepo.findMissingBookFileWithContextByIno(fileStat.ino);
    }

    if (
      !globalByIno ||
      globalByIno.file.absolutePath === fileStat.absolutePath ||
      !(globalByIno.file.bookId === bookId || globalByIno.bookStatus === 'missing')
    ) {
      return null;
    }

    const oldAbsolutePath = globalByIno.file.absolutePath;
    const sizeUnchanged = fileStat.sizeBytes === globalByIno.file.sizeBytes;
    const mtimeUnchanged = fileStat.mtime.getTime() === globalByIno.file.mtime?.getTime();
    await this.scannerRepo.updateBookFile(globalByIno.file.id, {
      bookId,
      libraryFolderId,
      absolutePath: fileStat.absolutePath,
      relPath: fileStat.relPath,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      format,
      role,
      sortOrder,
    });
    counts.updatedCount++;
    const oldPathEntry = fileByPath.get(oldAbsolutePath);
    if (oldPathEntry?.id === globalByIno.file.id) {
      fileByPath.delete(oldAbsolutePath);
    }
    const oldInoEntry = fileByIno.get(globalByIno.file.ino);
    if (oldInoEntry?.id === globalByIno.file.id) {
      fileByIno.delete(globalByIno.file.ino);
    }
    fileByPath.set(fileStat.absolutePath, {
      id: globalByIno.file.id,
      bookId,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      fileHash: globalByIno.file.fileHash,
      sortOrder,
    });
    fileByIno.set(fileStat.ino, {
      id: globalByIno.file.id,
      bookId,
      absolutePath: fileStat.absolutePath,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
    });
    return {
      isNew: false,
      reassigned: globalByIno.file.bookId !== bookId,
      changed: !sizeUnchanged || !mtimeUnchanged,
      fileId: globalByIno.file.id,
    };
  }

  private async resolveByHashOrCreate(
    fileStat: FileStat,
    format: string | null,
    role: FileRole,
    sortOrder: number,
    bookId: number,
    libraryFolderId: number,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: ScanCounts,
    isFirstScan: boolean,
  ): Promise<ProcessedFileResult> {
    let fileHash: string;
    try {
      fileHash = await computeFileHash(fileStat.absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EACCES') {
        this.logger.debug(
          `[scanner.process_file] [end] bookId=${bookId} path="${sanitizeLogValue(fileStat.absolutePath)}" action=skip_inaccessible - file no longer accessible`,
        );
        return { isNew: false, reassigned: false, changed: false, fileId: null };
      }
      throw err;
    }

    if (!isFirstScan) {
      const byHash = await this.scannerRepo.findBookFileByHash(fileHash, libraryFolderId);
      if (byHash) {
        const oldAbsolutePath = byHash.absolutePath;
        await this.scannerRepo.updateBookFile(byHash.id, {
          bookId,
          libraryFolderId,
          absolutePath: fileStat.absolutePath,
          relPath: fileStat.relPath,
          ino: fileStat.ino,
          sizeBytes: fileStat.sizeBytes,
          mtime: fileStat.mtime,
          format,
          role,
          sortOrder,
        });
        counts.updatedCount++;
        const oldPathEntry = fileByPath.get(oldAbsolutePath);
        if (oldPathEntry?.id === byHash.id) {
          fileByPath.delete(oldAbsolutePath);
        }
        const oldInoEntry = fileByIno.get(byHash.ino);
        if (oldInoEntry?.id === byHash.id) {
          fileByIno.delete(byHash.ino);
        }
        fileByPath.set(fileStat.absolutePath, {
          id: byHash.id,
          bookId,
          ino: fileStat.ino,
          sizeBytes: fileStat.sizeBytes,
          mtime: fileStat.mtime,
          fileHash: byHash.fileHash,
          sortOrder,
        });
        if (fileStat.ino !== 0) {
          fileByIno.set(fileStat.ino, {
            id: byHash.id,
            bookId,
            absolutePath: fileStat.absolutePath,
            sizeBytes: fileStat.sizeBytes,
            mtime: fileStat.mtime,
          });
        }
        return { isNew: false, reassigned: byHash.bookId !== bookId, changed: false, fileId: byHash.id };
      }

      let globalByHash = await this.scannerRepo.findBookFileWithContextByHash(fileHash);
      if (
        !globalByHash ||
        globalByHash.file.absolutePath === fileStat.absolutePath ||
        (globalByHash.file.bookId !== bookId && globalByHash.bookStatus !== 'missing')
      ) {
        globalByHash = await this.scannerRepo.findMissingBookFileWithContextByHash(fileHash);
      }

      if (
        globalByHash &&
        globalByHash.file.absolutePath !== fileStat.absolutePath &&
        (globalByHash.file.bookId === bookId || globalByHash.bookStatus === 'missing')
      ) {
        const oldAbsolutePath = globalByHash.file.absolutePath;
        await this.scannerRepo.updateBookFile(globalByHash.file.id, {
          bookId,
          libraryFolderId,
          absolutePath: fileStat.absolutePath,
          relPath: fileStat.relPath,
          ino: fileStat.ino,
          sizeBytes: fileStat.sizeBytes,
          mtime: fileStat.mtime,
          fileHash,
          format,
          role,
          sortOrder,
        });
        counts.updatedCount++;
        const oldPathEntry = fileByPath.get(oldAbsolutePath);
        if (oldPathEntry?.id === globalByHash.file.id) {
          fileByPath.delete(oldAbsolutePath);
        }
        const oldInoEntry = fileByIno.get(globalByHash.file.ino);
        if (oldInoEntry?.id === globalByHash.file.id) {
          fileByIno.delete(globalByHash.file.ino);
        }
        fileByPath.set(fileStat.absolutePath, {
          id: globalByHash.file.id,
          bookId,
          ino: fileStat.ino,
          sizeBytes: fileStat.sizeBytes,
          mtime: fileStat.mtime,
          fileHash,
          sortOrder,
        });
        if (fileStat.ino !== 0) {
          fileByIno.set(fileStat.ino, {
            id: globalByHash.file.id,
            bookId,
            absolutePath: fileStat.absolutePath,
            sizeBytes: fileStat.sizeBytes,
            mtime: fileStat.mtime,
          });
        }
        return { isNew: false, reassigned: globalByHash.file.bookId !== bookId, changed: false, fileId: globalByHash.file.id };
      }
    }

    const fileData = {
      bookId,
      libraryFolderId,
      absolutePath: fileStat.absolutePath,
      relPath: fileStat.relPath,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      fileHash,
      format,
      role,
      sortOrder,
    };
    let created: Awaited<ReturnType<ScannerRepository['createBookFile']>>;
    try {
      created = await this.scannerRepo.createBookFile(fileData);
    } catch (err) {
      const concurrent = await this.scannerRepo.findBookFileByAbsolutePath(fileStat.absolutePath);
      if (!concurrent) throw err;
      return this.resolveExistingFilePath(
        {
          id: concurrent.file.id,
          bookId: concurrent.file.bookId,
          ino: concurrent.file.ino,
          sizeBytes: concurrent.file.sizeBytes,
          mtime: concurrent.file.mtime,
          fileHash: concurrent.file.fileHash,
          sortOrder: concurrent.file.sortOrder,
        },
        fileStat,
        format,
        role,
        sortOrder,
        bookId,
        libraryFolderId,
        fileByPath,
        fileByIno,
        counts,
      );
    }
    counts.addedCount++;
    fileByPath.set(fileStat.absolutePath, {
      id: created.id,
      bookId,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      fileHash,
      sortOrder,
    });
    if (fileStat.ino !== 0) {
      fileByIno.set(fileStat.ino, {
        id: created.id,
        bookId,
        absolutePath: fileStat.absolutePath,
        sizeBytes: fileStat.sizeBytes,
        mtime: fileStat.mtime,
      });
    }
    return { isNew: true, reassigned: false, changed: true, fileId: created.id };
  }

  private async pruneMissingBookFiles(
    bookId: number,
    retainedFileIds: Set<number>,
    fileIdsByBookId: Map<number, Set<number>>,
    fileByPath: Map<string, FileByPathEntry>,
    fileByIno: Map<number, FileByInoEntry>,
    counts: { added: number; updated: number },
  ): Promise<void> {
    // Use in-memory index instead of DB query per book
    const knownFileIds = fileIdsByBookId.get(bookId);
    if (!knownFileIds) return;

    const missingIds: number[] = [];
    for (const fileId of knownFileIds) {
      if (!retainedFileIds.has(fileId)) {
        missingIds.push(fileId);
      }
    }
    if (missingIds.length === 0) return;

    for (const fileId of missingIds) {
      await this.scannerRepo.deleteBookFile(fileId);
      counts.updated += 1;

      // Clean up in-memory maps
      for (const [path, entry] of fileByPath) {
        if (entry.id === fileId) {
          fileByPath.delete(path);
          break;
        }
      }
      for (const [ino, entry] of fileByIno) {
        if (entry.id === fileId) {
          fileByIno.delete(ino);
          break;
        }
      }
    }
  }

  private emitFromStore(libraryId: number, jobId: number, status: 'running' | 'completed' | 'failed', errorMessage?: string): void {
    const entry = this.scanJobStore.get(libraryId);
    const event: ScanProgressEvent = {
      jobId,
      libraryId,
      status,
      processed: entry?.processed ?? 0,
      total: entry?.total ?? 0,
      added: entry?.added ?? 0,
      updated: entry?.updated ?? 0,
      missing: entry?.missing ?? 0,
      errorMessage,
    };
    this.scanGateway.emitProgress(event);
  }
}
