import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional } from '@nestjs/common';

import type { BookMissingEvent, CoverRefreshedEvent, CoverRefreshProgressEvent, ScanProgressEvent } from '@projectx/types';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { MetadataService } from '../metadata/metadata.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { classifyFile, FileRole } from './lib/classify';
import { fingerprintFile } from './lib/hash';
import { waitForStability } from './lib/stability';
import { BookCandidate, FileStat, findBookCandidates } from './lib/walk';
import { ScannerRepository } from './scanner.repository';

const METADATA_FORMATS = new Set(['epub', 'mobi', 'azw3', 'azw', 'cbz', 'cbr', 'cb7', 'fb2', 'pdf']);
const BATCH_SIZE = 5;

interface ScanCounts {
  addedCount: number;
  updatedCount: number;
  missingCount: number;
}

@Injectable()
export class ScannerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private readonly scannerRepo: ScannerRepository,
    private readonly metadataService: MetadataService,
    private readonly scanJobStore: ScanJobStore,
    private readonly scanGateway: ScanGateway,
    @Optional() private readonly autoFetchOrchestrator?: BookMetadataFetchOrchestratorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.scannerRepo.failAllRunningJobs('Server restarted during scan');
  }

  async startScan(libraryId: number, triggeredBy: 'manual' | 'watcher' | 'schedule'): Promise<{ jobId: number }> {
    if (this.scanJobStore.isRunning(libraryId)) {
      throw new ConflictException(`A scan is already running for library ${libraryId}`);
    }

    const [folders, settings] = await Promise.all([this.scannerRepo.findLibraryFolders(libraryId), this.scannerRepo.findLibrarySettings(libraryId)]);
    if (folders.length === 0) throw new NotFoundException(`Library ${libraryId} has no folders`);

    const allowedFormats = settings?.allowedFormats ?? [];
    const formatPriority = settings?.formatPriority ?? ['epub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2'];

    const job = await this.scannerRepo.createScanJob(libraryId, triggeredBy);

    this.scanJobStore.create(job.id, libraryId, 0);
    this.emitFromStore(libraryId, job.id, 'running');

    this.runScan(libraryId, job.id, folders, allowedFormats, formatPriority).catch((err) =>
      this.logger.error(`Scan job ${job.id} crashed unexpectedly: ${(err as Error).message}`),
    );

    return { jobId: job.id };
  }

  async refreshCovers(libraryId: number): Promise<{ queued: number }> {
    const rows = await this.scannerRepo.findPrimaryBookFilesByLibrary(libraryId);
    const candidates = rows.filter((r) => r.format && METADATA_FORMATS.has(r.format));
    const total = candidates.length;

    this.scanGateway.emitCoverRefreshProgress({ libraryId, processed: 0, total, status: 'running' });

    (async () => {
      let processed = 0;
      for (const row of candidates) {
        const refreshed = await this.metadataService.refreshCoverForBook(row.bookId, row.absolutePath, row.format!);
        processed++;
        if (refreshed) {
          this.scanGateway.emitCoverRefreshed({ bookId: row.bookId, libraryId } satisfies CoverRefreshedEvent);
        }
        this.scanGateway.emitCoverRefreshProgress({
          libraryId,
          processed,
          total,
          status: processed < total ? 'running' : 'completed',
        } satisfies CoverRefreshProgressEvent);
      }
    })().catch((err) => this.logger.warn(`Cover refresh crashed for library ${libraryId}: ${(err as Error).message}`));

    return { queued: total };
  }

  startScanAsync(libraryId: number): void {
    if (this.scanJobStore.isRunning(libraryId)) return;
    this.startScan(libraryId, 'manual').catch((err) =>
      this.logger.error(`Auto-scan failed to start for library ${libraryId}: ${(err as Error).message}`),
    );
  }

  private async runScan(
    libraryId: number,
    jobId: number,
    folders: Awaited<ReturnType<ScannerRepository['findLibraryFolders']>>,
    allowedFormats: string[],
    formatPriority: string[],
  ): Promise<void> {
    this.logger.log(`Scan job ${jobId} started for library ${libraryId}`);

    type FolderWork = {
      id: number;
      libraryId: number;
      path: string;
      candidates: BookCandidate[];
      knownBooks: Awaited<ReturnType<ScannerRepository['findBooksByLibraryFolder']>>;
      knownFiles: Awaited<ReturnType<ScannerRepository['findBookFilesByLibraryFolder']>>;
    };

    const folderWork: FolderWork[] = [];
    let totalCandidates = 0;

    const allowed = allowedFormats.length > 0 ? new Set(allowedFormats) : null;

    for (const folder of folders) {
      let candidates: BookCandidate[] = [];
      try {
        candidates = await findBookCandidates(folder.path);
      } catch (err) {
        this.logger.warn(`Cannot walk ${folder.path}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (allowed) {
        candidates = candidates
          .map((c) => ({
            ...c,
            files: c.files.filter((f) => {
              const { role, format } = classifyFile(f.absolutePath);
              return role !== 'primary' || (format !== null && allowed.has(format));
            }),
          }))
          .filter((c) => c.files.some((f) => classifyFile(f.absolutePath).role === 'primary'));
      }

      const [knownBooks, knownFiles] = await Promise.all([
        this.scannerRepo.findBooksByLibraryFolder(folder.id),
        this.scannerRepo.findBookFilesByLibraryFolder(folder.id),
      ]);

      folderWork.push({ ...folder, candidates, knownBooks, knownFiles });
      totalCandidates += candidates.length;
    }

    this.scanJobStore.setTotal(libraryId, totalCandidates);
    this.emitFromStore(libraryId, jobId, 'running');

    const totals: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    try {
      for (const { id: folderId, path: folderPath, candidates, knownBooks, knownFiles } of folderWork) {
        const counts = await this.scanFolderCandidates(folderId, libraryId, folderPath, candidates, knownBooks, knownFiles, jobId, formatPriority);
        totals.addedCount += counts.addedCount;
        totals.updatedCount += counts.updatedCount;
        totals.missingCount += counts.missingCount;
      }

      await this.scannerRepo.completeScanJob(jobId, totals);
      this.logger.log(`Scan job ${jobId} completed — ${JSON.stringify(totals)}`);
      this.scanJobStore.increment(libraryId, { added: totals.addedCount, updated: totals.updatedCount });
      this.emitFromStore(libraryId, jobId, 'completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.scannerRepo.failScanJob(jobId, message).catch(() => {
        // Job row may have been cascade-deleted if library was deleted.
      });
      this.logger.error(`Scan job ${jobId} failed: ${message}`);
      this.emitFromStore(libraryId, jobId, 'failed', message);
    } finally {
      this.scanJobStore.delete(libraryId);
    }
  }

  private async scanFolderCandidates(
    libraryFolderId: number,
    libraryId: number,
    _folderPath: string,
    candidates: BookCandidate[],
    knownBooks: Awaited<ReturnType<ScannerRepository['findBooksByLibraryFolder']>>,
    knownFiles: Awaited<ReturnType<ScannerRepository['findBookFilesByLibraryFolder']>>,
    jobId: number,
    formatPriority: string[],
  ): Promise<ScanCounts> {
    const counts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    const bookByFolderPath = new Map(knownBooks.map((b) => [b.folderPath, b]));
    const fileByPath = new Map(knownFiles.map((f) => [f.absolutePath, f]));
    const fileByIno = new Map(knownFiles.map((f) => [f.ino, f]));
    const seenBookIds = new Set<number>();

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map((c) => this.processCandidate(c, libraryId, libraryFolderId, bookByFolderPath, fileByPath, fileByIno, formatPriority)),
      );

      for (const r of results) {
        seenBookIds.add(r.bookId);
        counts.addedCount += r.added;
        counts.updatedCount += r.updated;
      }

      const entry = this.scanJobStore.increment(libraryId, { processed: batch.length });
      if (entry && this.scanJobStore.shouldEmit(entry)) {
        this.emitFromStore(libraryId, jobId, 'running');
        this.scanJobStore.markEmitted(entry);
      }
    }

    const missingIds = knownBooks.filter((b) => !seenBookIds.has(b.id)).map((b) => b.id);
    if (missingIds.length > 0) {
      await this.scannerRepo.markBooksAsMissing(missingIds);
      counts.missingCount += missingIds.length;
      this.scanJobStore.increment(libraryId, { missing: missingIds.length });
      this.scanGateway.emitBookMissing({ libraryId, bookIds: missingIds } satisfies BookMissingEvent);
    }

    return counts;
  }

  private async processCandidate(
    candidate: BookCandidate,
    libraryId: number,
    libraryFolderId: number,
    bookByFolderPath: Map<string, { id: number; status: string; folderPath: string }>,
    fileByPath: Map<string, { id: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }>,
    fileByIno: Map<number, { id: number; absolutePath: string }>,
    formatPriority: string[],
  ): Promise<{ bookId: number; added: number; updated: number }> {
    const counts = { added: 0, updated: 0 };
    const fileCounts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    const book = await this.upsertBook(candidate, libraryId, libraryFolderId, bookByFolderPath, fileCounts);
    counts.added += fileCounts.addedCount;
    counts.updated += fileCounts.updatedCount;

    // Determine which format gets the 'primary' role when multiple primary-format files exist.
    const primaryFiles = candidate.files.filter((f) => classifyFile(f.absolutePath).role === 'primary');
    const chosenFormat =
      primaryFiles.length > 1 ? (formatPriority.find((fmt) => primaryFiles.some((f) => classifyFile(f.absolutePath).format === fmt)) ?? null) : null;

    for (const fileStat of candidate.files) {
      const { format, role: classifiedRole } = classifyFile(fileStat.absolutePath);
      const role: FileRole =
        chosenFormat !== null && classifiedRole === 'primary' ? (format === chosenFormat ? 'primary' : 'supplementary') : classifiedRole;

      const fileCount: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
      let isNew: boolean;

      try {
        isNew = await this.processFile(fileStat, format, role, book.id, libraryFolderId, fileByPath, fileByIno, fileCount);
      } catch (err) {
        this.logger.warn(`Failed to process file ${fileStat.absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      counts.added += fileCount.addedCount;
      counts.updated += fileCount.updatedCount;

      if (isNew && format && METADATA_FORMATS.has(format)) {
        try {
          await this.metadataService.extractAndSave(book.id, fileStat.absolutePath, format);
        } catch (err) {
          this.logger.warn(`Metadata extraction failed for ${fileStat.absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return { bookId: book.id, ...counts };
  }

  private async upsertBook(
    candidate: BookCandidate,
    libraryId: number,
    libraryFolderId: number,
    bookByFolderPath: Map<string, { id: number; status: string; folderPath: string }>,
    counts: ScanCounts,
  ) {
    const existing = bookByFolderPath.get(candidate.folderPath);

    if (!existing) {
      const book = await this.scannerRepo.createBook({
        libraryId,
        libraryFolderId,
        folderPath: candidate.folderPath,
        status: 'present',
      });
      counts.addedCount++;
      this.autoFetchOrchestrator
        ?.scheduleIfEligible(book.id, libraryId, 'event_import')
        .catch((err: Error) => this.logger.warn(`book-metadata-fetch schedule failed for book ${book.id}: ${err.message}`));
      return book;
    }

    if (existing.status === 'missing') {
      await this.scannerRepo.updateBookStatus(existing.id, 'present');
      counts.updatedCount++;
    }

    return existing;
  }

  private async processFile(
    fileStat: FileStat,
    format: string | null,
    role: FileRole,
    bookId: number,
    libraryFolderId: number,
    fileByPath: Map<string, { id: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }>,
    fileByIno: Map<number, { id: number; absolutePath: string }>,
    counts: ScanCounts,
  ): Promise<boolean> {
    await waitForStability(fileStat.absolutePath);

    // 1. Path match — file didn't move.
    const byPath = fileByPath.get(fileStat.absolutePath);
    if (byPath) {
      const changed = fileStat.sizeBytes !== byPath.sizeBytes || fileStat.mtime.getTime() !== byPath.mtime?.getTime();
      if (changed) {
        await this.scannerRepo.updateBookFile(byPath.id, {
          ino: fileStat.ino,
          sizeBytes: fileStat.sizeBytes,
          mtime: fileStat.mtime,
          format,
          role,
        });
        counts.updatedCount++;
      }
      return false;
    }

    // 2. Inode match — renamed/moved within the same filesystem.
    const byIno = fileByIno.get(fileStat.ino);
    if (byIno) {
      await this.scannerRepo.updateBookFile(byIno.id, {
        absolutePath: fileStat.absolutePath,
        relPath: fileStat.relPath,
        sizeBytes: fileStat.sizeBytes,
        mtime: fileStat.mtime,
        format,
        role,
      });
      counts.updatedCount++;
      return false;
    }

    // 3. Hash match — cross-filesystem copy (expensive, last resort).
    const hash = await fingerprintFile(fileStat.absolutePath);
    const byHash = await this.scannerRepo.findBookFileByHash(hash, libraryFolderId);
    if (byHash) {
      await this.scannerRepo.updateBookFile(byHash.id, {
        absolutePath: fileStat.absolutePath,
        relPath: fileStat.relPath,
        ino: fileStat.ino,
        sizeBytes: fileStat.sizeBytes,
        mtime: fileStat.mtime,
        format,
        role,
      });
      counts.updatedCount++;
      return false;
    }

    // 4. Genuinely new file.
    await this.scannerRepo.createBookFile({
      bookId,
      libraryFolderId,
      absolutePath: fileStat.absolutePath,
      relPath: fileStat.relPath,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      hash,
      format,
      role,
    });
    counts.addedCount++;
    return true;
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
