import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rm } from 'fs/promises';
import { join } from 'path';
import type {
  BrokenCoverEntry,
  CoverSweep,
  MissingBookEntry,
  MissingResourceCleanupResult,
  MissingResourcePage,
  MissingResourcesSummary,
  OrphanedCoverDirEntry,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { LibraryService } from '../library/library.service';
import { CoverSweepStore, type SweepRecord } from './cover-sweep.store';
import { COVER_DISK_CONCURRENCY, hasServableCover, mapWithConcurrency, measureCoverDir, readCoverDirBookIds } from './lib/cover-disk';
import { MissingResourcesRepository } from './missing-resources.repository';
import type { MissingResourceCleanupDto } from './dto/missing-resources.dto';

const SWEEP_BATCH_SIZE = 1000;
const DELETE_BATCH_SIZE = 500;
const MAX_CLEANUP_IDS = 5000;

@Injectable()
export class MissingResourcesService {
  private readonly logger = new Logger(MissingResourcesService.name);
  private readonly coversRoot: string;

  constructor(
    private readonly repo: MissingResourcesRepository,
    private readonly store: CoverSweepStore,
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
    config: ConfigService,
  ) {
    this.coversRoot = join(config.get<string>('storage.appDataPath')!, 'covers');
  }

  async getSummary(user: RequestUser): Promise<MissingResourcesSummary> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const missingBooks = await this.repo.countMissingBooks(libraryIds);
    return { missingBooks, sweep: this.toSweep(this.store.get(user.id)) };
  }

  getSweep(user: RequestUser): CoverSweep | null {
    return this.toSweep(this.store.get(user.id));
  }

  async startSweep(user: RequestUser): Promise<CoverSweep> {
    if (this.store.isRunning(user.id)) throw new ConflictException('A cover sweep is already running');
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const record = this.store.start(user.id, libraryIds);
    void this.runSweep(user, record);
    return this.toSweep(record)!;
  }

  async listMissingBooks(user: RequestUser, page: number, pageSize: number): Promise<MissingResourcePage<MissingBookEntry>> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const total = await this.repo.countMissingBooks(libraryIds);
    const rows = await this.repo.findMissingBooks(libraryIds, (page - 1) * pageSize, pageSize);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        authors: row.authors ?? [],
        libraryId: row.libraryId,
        libraryName: row.libraryName,
        folderPath: row.folderPath,
        formats: row.formats ?? [],
        updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async listBrokenCovers(user: RequestUser, page: number, pageSize: number): Promise<MissingResourcePage<BrokenCoverEntry>> {
    const record = this.requireCompletedSweep(user);
    const pageIds = record.brokenCoverBookIds.slice((page - 1) * pageSize, page * pageSize);
    const rows = await this.repo.findBrokenCoverEntries(pageIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: pageIds.flatMap((bookId) => {
        const row = byId.get(bookId);
        if (!row || (row.coverSource !== 'extracted' && row.coverSource !== 'custom')) return [];
        return [
          {
            id: row.id,
            title: row.title,
            authors: row.authors ?? [],
            libraryId: row.libraryId,
            libraryName: row.libraryName,
            coverSource: row.coverSource,
          },
        ];
      }),
      total: record.brokenCoverBookIds.length,
      page,
      pageSize,
    };
  }

  listOrphanedCoverDirs(user: RequestUser, page: number, pageSize: number): MissingResourcePage<OrphanedCoverDirEntry> {
    const record = this.requireCompletedSweep(user);
    return {
      items: record.orphanedCoverDirs.slice((page - 1) * pageSize, page * pageSize),
      total: record.orphanedCoverDirs.length,
      page,
      pageSize,
    };
  }

  async cleanMissingBooks(user: RequestUser, dto: MissingResourceCleanupDto): Promise<MissingResourceCleanupResult> {
    const event = 'maintenance.clean_missing_books';
    const startedAt = Date.now();
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const requestedIds = dto.all ? await this.repo.findMissingBookIds(libraryIds, 0, MAX_CLEANUP_IDS) : this.requireBookIds(dto);
    const targets = dto.all ? requestedIds : await this.repo.filterStillMissingBookIds(requestedIds, libraryIds);

    this.logger.log(`[${event}] [start] userId=${user.id} requested=${requestedIds.length} targets=${targets.length} - missing book cleanup started`);
    try {
      let cleaned = 0;
      for (let index = 0; index < targets.length; index += DELETE_BATCH_SIZE) {
        const batch = targets.slice(index, index + DELETE_BATCH_SIZE);
        const result = await this.bookService.deleteBooks(batch, user);
        cleaned += result.total;
      }
      const remaining = await this.repo.countMissingBooks(libraryIds);
      this.logger.log(
        `[${event}] [end] userId=${user.id} requested=${requestedIds.length} cleaned=${cleaned} remaining=${remaining} durationMs=${Date.now() - startedAt} - missing book cleanup completed`,
      );
      return { category: 'missing_books', requested: requestedIds.length, cleaned, skipped: requestedIds.length - cleaned, remaining };
    } catch (err) {
      this.logFailure(event, user, startedAt, err);
      throw err;
    }
  }

  async cleanBrokenCovers(user: RequestUser, dto: MissingResourceCleanupDto): Promise<MissingResourceCleanupResult> {
    const event = 'maintenance.clean_broken_covers';
    const startedAt = Date.now();
    const record = this.requireCompletedSweep(user);
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const requestedIds = dto.all ? record.brokenCoverBookIds.slice(0, MAX_CLEANUP_IDS) : this.requireBookIds(dto);
    const known = new Set(record.brokenCoverBookIds);
    const candidates = await this.repo.filterBookIdsWithCoverSource(
      requestedIds.filter((bookId) => known.has(bookId)),
      libraryIds,
    );

    this.logger.log(
      `[${event}] [start] userId=${user.id} requested=${requestedIds.length} candidates=${candidates.length} - broken cover cleanup started`,
    );
    try {
      const stillBroken: number[] = [];
      await mapWithConcurrency(candidates, COVER_DISK_CONCURRENCY, async (bookId) => {
        if (!(await hasServableCover(this.coversRoot, bookId))) stillBroken.push(bookId);
      });

      let cleaned = 0;
      for (let index = 0; index < stillBroken.length; index += DELETE_BATCH_SIZE) {
        cleaned += await this.repo.clearCoverSource(stillBroken.slice(index, index + DELETE_BATCH_SIZE));
      }
      const handled = new Set(requestedIds);
      record.brokenCoverBookIds = record.brokenCoverBookIds.filter((bookId) => !handled.has(bookId));
      record.brokenCoverCount = Math.max(0, record.brokenCoverCount - cleaned);
      this.logger.log(
        `[${event}] [end] userId=${user.id} requested=${requestedIds.length} cleaned=${cleaned} remaining=${record.brokenCoverBookIds.length} durationMs=${Date.now() - startedAt} - broken cover cleanup completed`,
      );
      return {
        category: 'broken_covers',
        requested: requestedIds.length,
        cleaned,
        skipped: requestedIds.length - cleaned,
        remaining: record.brokenCoverBookIds.length,
      };
    } catch (err) {
      this.logFailure(event, user, startedAt, err);
      throw err;
    }
  }

  async cleanOrphanedCoverDirs(user: RequestUser, dto: MissingResourceCleanupDto): Promise<MissingResourceCleanupResult> {
    const event = 'maintenance.clean_orphaned_covers';
    const startedAt = Date.now();
    const record = this.requireCompletedSweep(user);
    const known = new Set(record.orphanedCoverDirs.map((dir) => dir.bookId));
    const requestedIds = dto.all ? [...known].slice(0, MAX_CLEANUP_IDS) : this.requireBookIds(dto);
    const candidates = requestedIds.filter((bookId) => known.has(bookId));

    this.logger.log(
      `[${event}] [start] userId=${user.id} requested=${requestedIds.length} candidates=${candidates.length} - orphaned cover cleanup started`,
    );
    try {
      let cleaned = 0;
      let failed = 0;
      const removed = new Set<number>();
      for (let index = 0; index < candidates.length; index += SWEEP_BATCH_SIZE) {
        const batch = candidates.slice(index, index + SWEEP_BATCH_SIZE);
        // Re-check against the database: a book id that came back (restored, re-imported) is not an orphan.
        const revived = new Set(await this.repo.findExistingBookIds(batch));
        const removable = batch.filter((bookId) => !revived.has(bookId));
        await mapWithConcurrency(removable, COVER_DISK_CONCURRENCY, async (bookId) => {
          const dir = join(this.coversRoot, String(bookId));
          try {
            await rm(dir, { recursive: true, force: true });
            removed.add(bookId);
            cleaned += 1;
          } catch (err) {
            failed += 1;
            const errorClass = err instanceof Error ? err.name : 'Error';
            const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
            this.logger.warn(
              `[${event}] [fail] userId=${user.id} bookId=${bookId} path="${sanitizeLogValue(dir)}" errorClass=${errorClass} error="${errorMessage}" - orphaned cover directory removal failed`,
            );
          }
        });
      }
      record.orphanedCoverDirs = record.orphanedCoverDirs.filter((dir) => !removed.has(dir.bookId));
      record.orphanedCoverDirCount = Math.max(0, record.orphanedCoverDirCount - cleaned);
      record.orphanedBytes = record.orphanedCoverDirs.reduce((total, dir) => total + dir.sizeBytes, 0);
      this.logger.log(
        `[${event}] [end] userId=${user.id} requested=${requestedIds.length} cleaned=${cleaned} failed=${failed} remaining=${record.orphanedCoverDirs.length} durationMs=${Date.now() - startedAt} - orphaned cover cleanup completed`,
      );
      return {
        category: 'orphaned_cover_dirs',
        requested: requestedIds.length,
        cleaned,
        skipped: requestedIds.length - cleaned,
        remaining: record.orphanedCoverDirs.length,
      };
    } catch (err) {
      this.logFailure(event, user, startedAt, err);
      throw err;
    }
  }

  private async runSweep(user: RequestUser, record: SweepRecord): Promise<void> {
    const event = 'maintenance.cover_sweep';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} libraryCount=${record.libraryIds.length} - cover sweep started`);
    try {
      record.totalBooks = await this.repo.countBooksWithCoverSource(record.libraryIds);
      const diskBookIds = await readCoverDirBookIds(this.coversRoot);

      let afterId = 0;
      for (;;) {
        const batch = await this.repo.findBookIdsWithCoverSource(record.libraryIds, afterId, SWEEP_BATCH_SIZE);
        if (batch.length === 0) break;
        afterId = batch[batch.length - 1]!;

        const onDisk = batch.filter((bookId) => diskBookIds.has(bookId));
        const broken = batch.filter((bookId) => !diskBookIds.has(bookId));
        await mapWithConcurrency(onDisk, COVER_DISK_CONCURRENCY, async (bookId) => {
          if (!(await hasServableCover(this.coversRoot, bookId))) broken.push(bookId);
        });

        this.store.addBrokenCovers(record, broken);
        record.processedBooks += batch.length;
      }

      await this.collectOrphanedCoverDirs(record, diskBookIds);
      this.store.complete(user.id);
      this.logger.log(
        `[${event}] [end] userId=${user.id} processedBooks=${record.processedBooks} brokenCovers=${record.brokenCoverCount} orphanedDirs=${record.orphanedCoverDirCount} truncated=${record.truncated} durationMs=${Date.now() - startedAt} - cover sweep completed`,
      );
      if (record.truncated) {
        this.logger.warn(
          `[${event}] [end] userId=${user.id} retained=${record.brokenCoverBookIds.length + record.orphanedCoverDirs.length} brokenCovers=${record.brokenCoverCount} orphanedDirs=${record.orphanedCoverDirCount} - sweep results truncated, re-run after cleaning to see the rest`,
        );
      }
    } catch (err) {
      this.store.fail(user.id, 'cover_sweep_failed');
      this.logFailure(event, user, startedAt, err);
    }
  }

  private async collectOrphanedCoverDirs(record: SweepRecord, diskBookIds: Set<number>): Promise<void> {
    const diskIds = [...diskBookIds];
    for (let index = 0; index < diskIds.length; index += SWEEP_BATCH_SIZE) {
      const batch = diskIds.slice(index, index + SWEEP_BATCH_SIZE);
      const existing = new Set(await this.repo.findExistingBookIds(batch));
      const orphanIds = batch.filter((bookId) => !existing.has(bookId));
      const orphans = await mapWithConcurrency(orphanIds, COVER_DISK_CONCURRENCY, async (bookId) => ({
        bookId,
        ...(await measureCoverDir(this.coversRoot, bookId)),
      }));
      this.store.addOrphanedCoverDirs(record, orphans);
    }
  }

  private requireBookIds(dto: MissingResourceCleanupDto): number[] {
    if (!dto.bookIds || dto.bookIds.length === 0) throw new BadRequestException('Either bookIds or all must be provided');
    if (dto.bookIds.length > MAX_CLEANUP_IDS) throw new BadRequestException(`At most ${MAX_CLEANUP_IDS} ids can be cleaned per request`);
    return [...new Set(dto.bookIds)];
  }

  private requireCompletedSweep(user: RequestUser): SweepRecord {
    const record = this.store.get(user.id);
    if (!record) throw new ConflictException('Run a cover sweep first');
    if (record.status !== 'completed') throw new ConflictException('The cover sweep is not complete');
    return record;
  }

  private toSweep(record: SweepRecord | undefined): CoverSweep | null {
    if (!record) return null;
    const progressPercent =
      record.totalBooks === null || record.totalBooks === 0
        ? record.status === 'running'
          ? null
          : 100
        : Math.min(100, Math.round((record.processedBooks / record.totalBooks) * 100));
    return {
      status: record.status,
      processedBooks: record.processedBooks,
      totalBooks: record.totalBooks,
      progressPercent,
      brokenCovers: record.brokenCoverCount,
      orphanedCoverDirs: record.orphanedCoverDirCount,
      orphanedBytes: record.orphanedBytes,
      truncated: record.truncated,
      errorCode: record.errorCode,
      startedAt: new Date(record.startedAt).toISOString(),
      completedAt: record.completedAt === null ? null : new Date(record.completedAt).toISOString(),
    };
  }

  private logFailure(event: string, user: RequestUser, startedAt: number, err: unknown): void {
    const errorClass = err instanceof Error ? err.name : 'Error';
    const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    this.logger.warn(`[${event}] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}"`);
  }
}
