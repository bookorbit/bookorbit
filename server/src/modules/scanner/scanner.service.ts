import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional } from '@nestjs/common';

import type { BookMissingEvent, CoverRefreshedEvent, CoverRefreshProgressEvent, ScanBooksAddedEvent, ScanProgressEvent } from '@projectx/types';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { MetadataService } from '../metadata/metadata.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { basename, dirname, relative, sep } from 'path';
import { readdir, stat } from 'fs/promises';

import { classifyFile, DEFAULT_FORMAT_PRIORITY, FileRole, isAudioFormat } from './lib/classify';
import { fingerprintFile } from './lib/hash';
import { waitForStability } from './lib/stability';
import { BookCandidate, FileStat, findBookCandidates, findLooseFileCandidates, buildSingleBookCandidate } from './lib/walk';
import { ScannerRepository } from './scanner.repository';
import { assembleBookCards } from '../book/utils/assemble-book-cards';

const METADATA_FORMATS = new Set(['epub', 'mobi', 'azw3', 'azw', 'cbz', 'cbr', 'cb7', 'fb2', 'pdf', 'm4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac']);
const BATCH_SIZE = 3;
const BOOK_EMIT_BUFFER_SIZE = 20;
const BOOK_EMIT_FLUSH_INTERVAL_MS = 1000;
type OrganizationMode = 'book_per_file' | 'book_per_folder';

interface ScanCounts {
  addedCount: number;
  updatedCount: number;
  missingCount: number;
}

function normalizeOrganizationMode(mode: string | null | undefined): OrganizationMode {
  return mode === 'book_per_file' ? 'book_per_file' : 'book_per_folder';
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

  // ── Live book emission buffer ──────────────────────────────────────────────
  private readonly bookEmitBuffer = new Map<number, number[]>();
  private readonly bookEmitTimers = new Map<number, ReturnType<typeof setTimeout>>();

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
        `[scanner.emit_books_added] [fail] libraryId=${libraryId} bookCount=${ids.length} errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - failed to emit added books`,
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

  async onApplicationBootstrap(): Promise<void> {
    await this.scannerRepo.failAllRunningJobs('Server restarted during scan');
  }

  async startScan(libraryId: number, triggeredBy: 'manual' | 'watcher' | 'schedule'): Promise<{ jobId: number }> {
    const event = 'scanner.start_scan';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} triggeredBy=${triggeredBy} - scan start requested`);
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
      const excludePatterns = settings?.excludePatterns ?? [];
      const organizationMode = normalizeOrganizationMode(settings?.organizationMode);

      const job = await this.scannerRepo.createScanJob(libraryId, triggeredBy);

      this.scanJobStore.create(job.id, libraryId, 0);
      this.emitFromStore(libraryId, job.id, 'running');

      this.runScan(libraryId, job.id, folders, allowedFormats, formatPriority, excludePatterns, organizationMode).catch((err) => {
        const errorClass = err instanceof Error ? err.name : 'Error';
        const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
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
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} triggeredBy=${triggeredBy} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - scan start failed`,
      );
      throw err;
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
        for (const row of candidates) {
          const refreshed = await this.metadataService.refreshCoverForBook(row.bookId, row.absolutePath, row.format!);
          processed++;
          if (refreshed) {
            refreshedCount++;
            this.scanGateway.emitCoverRefreshed({ bookId: row.bookId, libraryId } satisfies CoverRefreshedEvent);
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
        const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
        this.logger.warn(
          `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - backgroundStartedAt} errorClass=${errorClass} error="${errorMessage}" - cover refresh crashed`,
        );
      });

      this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} queued=${total} - cover refresh queued`);
      return { queued: total };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover refresh failed`,
      );
      throw err;
    }
  }

  startScanAsync(libraryId: number): void {
    if (this.scanJobStore.isRunning(libraryId)) return;
    this.startScan(libraryId, 'manual').catch((err) =>
      this.logger.error(
        `[scanner.start_scan] [fail] libraryId=${libraryId} triggeredBy=manual errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - auto-scan failed to start`,
      ),
    );
  }

  isScanRunning(libraryId: number): boolean {
    return this.scanJobStore.isRunning(libraryId);
  }

  scanBookFolderAsync(filePath: string, libraryId: number): void {
    this.scanBookFolder(filePath, libraryId).catch((err) =>
      this.logger.error(
        `[scanner.scan_book_folder] [fail] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - targeted folder scan failed`,
      ),
    );
  }

  private async scanBookFolder(filePath: string, libraryId: number): Promise<void> {
    const event = 'scanner.scan_book_folder';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" - targeted folder scan started`);
    if (this.scanJobStore.isRunning(libraryId)) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} skippedDueToRunningFullScan=true - targeted folder scan completed`,
      );
      return;
    }
    const allFolders = await this.scannerRepo.findLibraryFolders(libraryId);
    const libraryFolder = allFolders.find((f) => filePath.startsWith(f.path + sep));
    if (!libraryFolder) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} matchedLibraryFolder=false - targeted folder scan completed`,
      );
      return;
    }

    const settings = await this.scannerRepo.findLibrarySettings(libraryId);
    const allowedFormats = settings?.allowedFormats ?? [];
    const formatPriority = settings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY;
    const excludePatterns = settings?.excludePatterns ?? [];
    const organizationMode = normalizeOrganizationMode(settings?.organizationMode);

    // In book_per_file mode each file is its own book — skip folder resolution entirely
    // and build a single-file candidate directly from the changed file.
    if (organizationMode === 'book_per_file') {
      const { role, format } = classifyFile(filePath);
      if (role !== 'content') {
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} skippedNonContent=true - targeted folder scan completed`,
        );
        return;
      }

      const allowed = allowedFormats.length > 0 ? new Set(allowedFormats) : null;
      if (allowed && format !== null && !allowed.has(format)) {
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} skippedByAllowedFormats=true - targeted folder scan completed`,
        );
        return;
      }

      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} candidateFound=false - targeted folder scan completed`,
        );
        return;
      }

      const candidate: BookCandidate = {
        folderPath: filePath,
        files: [
          {
            absolutePath: filePath,
            relPath: relative(libraryFolder.path, filePath),
            ino: Number(fileStat.ino),
            sizeBytes: Number(fileStat.size),
            mtime: fileStat.mtime,
          },
        ],
      };

      const knownBooks = await this.scannerRepo.findBooksByFolderPath(filePath, libraryId);
      const knownFiles = await this.scannerRepo.findBookFilesByBookIds(knownBooks.map((b) => b.id));

      const bookByFolderPath = new Map<string, { id: number; status: string; folderPath: string }>(
        knownBooks.map((b) => [b.folderPath, { id: b.id, status: b.status, folderPath: b.folderPath }]),
      );
      const fileByPath = new Map<
        string,
        { id: number; bookId: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }
      >(knownFiles.map((f) => [f.absolutePath, { id: f.id, bookId: f.bookId, ino: f.ino, sizeBytes: f.sizeBytes, mtime: f.mtime, hash: f.hash }]));
      const fileByIno = new Map<number, { id: number; bookId: number; absolutePath: string }>(
        knownFiles.map((f) => [f.ino, { id: f.id, bookId: f.bookId, absolutePath: f.absolutePath }]),
      );

      const result = await this.processCandidate(candidate, libraryId, libraryFolder.id, bookByFolderPath, fileByPath, fileByIno, formatPriority);
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} added=${result.added} updated=${result.updated} - targeted folder scan completed`,
      );
      return;
    }

    const bookFolder = dirname(filePath);

    // If the file sits directly inside the library root, a targeted scan would
    // walk the entire root — treat it as a full scan instead.
    if (bookFolder === libraryFolder.path) {
      this.startScanAsync(libraryId);
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} promotedToFullScan=true - targeted folder scan completed`,
      );
      return;
    }

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
      candidate = await buildSingleBookCandidate(resolvedBookFolder, libraryFolder.path, excludePatterns, (msg) =>
        this.logger.warn(
          `[scanner.walk_candidates] [fail] libraryId=${libraryId} path="${resolvedBookFolder.replace(/"/g, '\\"')}" error="${msg.replace(/"/g, '\\"')}" - candidate walk warning`,
        ),
      );
    } catch (err) {
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - cannot walk target folder`,
      );
      return;
    }

    if (!candidate) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} candidateFound=false - targeted folder scan completed`,
      );
      return;
    }

    const allowed = allowedFormats.length > 0 ? new Set(allowedFormats) : null;
    if (allowed) {
      const filtered = candidate.files.filter((f) => {
        const { role, format } = classifyFile(f.absolutePath);
        return role !== 'content' || (format !== null && allowed.has(format));
      });
      if (!filtered.some((f) => classifyFile(f.absolutePath).role === 'content')) {
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} candidateFound=true skippedByAllowedFormats=true - targeted folder scan completed`,
        );
        return;
      }
      candidate = { ...candidate, files: filtered };
    }

    // Load only books/files relevant to this specific folder (including any
    // virtual stem-split children so the merge logic in upsertBook can run).
    const knownBooks = await this.scannerRepo.findBooksByFolderPath(resolvedBookFolder, libraryId);
    const knownFiles = await this.scannerRepo.findBookFilesByBookIds(knownBooks.map((b) => b.id));

    const bookByFolderPath = new Map<string, { id: number; status: string; folderPath: string }>(
      knownBooks.map((b) => [b.folderPath, { id: b.id, status: b.status, folderPath: b.folderPath }]),
    );
    const fileByPath = new Map<
      string,
      { id: number; bookId: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }
    >(knownFiles.map((f) => [f.absolutePath, { id: f.id, bookId: f.bookId, ino: f.ino, sizeBytes: f.sizeBytes, mtime: f.mtime, hash: f.hash }]));
    const fileByIno = new Map<number, { id: number; bookId: number; absolutePath: string }>(
      knownFiles.map((f) => [f.ino, { id: f.id, bookId: f.bookId, absolutePath: f.absolutePath }]),
    );

    const result = await this.processCandidate(candidate, libraryId, libraryFolder.id, bookByFolderPath, fileByPath, fileByIno, formatPriority);

    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} filePath="${filePath.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} folder="${basename(resolvedBookFolder).replace(/"/g, '\\"')}" added=${result.added} updated=${result.updated} - targeted folder scan completed`,
    );
  }

  private async runScan(
    libraryId: number,
    jobId: number,
    folders: Awaited<ReturnType<ScannerRepository['findLibraryFolders']>>,
    allowedFormats: string[],
    formatPriority: string[],
    excludePatterns: string[],
    organizationMode: OrganizationMode,
  ): Promise<void> {
    const event = 'scanner.run_scan';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} jobId=${jobId} folderCount=${folders.length} - scan job started`);

    let totalCandidates = 0;

    const allowed = allowedFormats.length > 0 ? new Set(allowedFormats) : null;

    const totals: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    try {
      this.scanJobStore.setTotal(libraryId, 0);
      this.emitFromStore(libraryId, jobId, 'running');

      for (const folder of folders) {
        let candidates: BookCandidate[] = [];
        try {
          candidates =
            organizationMode === 'book_per_file'
              ? await findLooseFileCandidates(folder.path, excludePatterns, (msg) =>
                  this.logger.warn(
                    `[scanner.walk_candidates] [fail] libraryId=${libraryId} path="${folder.path.replace(/"/g, '\\"')}" error="${msg.replace(/"/g, '\\"')}" - candidate walk warning`,
                  ),
                )
              : await findBookCandidates(folder.path, excludePatterns, (msg) =>
                  this.logger.warn(
                    `[scanner.walk_candidates] [fail] libraryId=${libraryId} path="${folder.path.replace(/"/g, '\\"')}" error="${msg.replace(/"/g, '\\"')}" - candidate walk warning`,
                  ),
                );
        } catch (err) {
          this.logger.warn(
            `[${event}] [fail] libraryId=${libraryId} jobId=${jobId} path="${folder.path.replace(/"/g, '\\"')}" durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - cannot walk folder`,
          );
        }

        if (allowed) {
          candidates = candidates
            .map((c) => ({
              ...c,
              files: c.files.filter((f) => {
                const { role, format } = classifyFile(f.absolutePath);
                return role !== 'content' || (format !== null && allowed.has(format));
              }),
            }))
            .filter((c) => c.files.some((f) => classifyFile(f.absolutePath).role === 'content'));
        }

        totalCandidates += candidates.length;
        this.scanJobStore.setTotal(libraryId, totalCandidates);

        const counts = await this.scanFolderCandidates(folder.id, libraryId, candidates, jobId, formatPriority);
        totals.addedCount += counts.addedCount;
        totals.updatedCount += counts.updatedCount;
        totals.missingCount += counts.missingCount;
      }

      await this.scannerRepo.completeScanJob(jobId, totals);
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} jobId=${jobId} durationMs=${Date.now() - startedAt} addedCount=${totals.addedCount} updatedCount=${totals.updatedCount} missingCount=${totals.missingCount} - scan job completed`,
      );
      this.scanJobStore.increment(libraryId, { added: totals.addedCount, updated: totals.updatedCount });
      this.emitFromStore(libraryId, jobId, 'completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.scannerRepo.failScanJob(jobId, message).catch(() => {
        // Job row may have been cascade-deleted if library was deleted.
      });
      this.logger.error(
        `[${event}] [fail] libraryId=${libraryId} jobId=${jobId} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${message.replace(/"/g, '\\"')}" - scan job failed`,
      );
      this.emitFromStore(libraryId, jobId, 'failed', message);
    } finally {
      this.flushBookEmitBuffer(libraryId);
      this.scanJobStore.delete(libraryId);
    }
  }

  private async scanFolderCandidates(
    libraryFolderId: number,
    libraryId: number,
    candidates: BookCandidate[],
    jobId: number,
    formatPriority: string[],
  ): Promise<ScanCounts> {
    const event = 'scanner.scan_folder_candidates';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] libraryId=${libraryId} jobId=${jobId} libraryFolderId=${libraryFolderId} candidateCount=${candidates.length} - folder candidate scan started`,
    );
    try {
      const counts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
      const [knownBooks, knownFiles] = await Promise.all([
        this.scannerRepo.findBooksByLibraryFolder(libraryFolderId),
        this.scannerRepo.findBookFilesByLibraryFolder(libraryFolderId),
      ]);

      const bookByFolderPath = new Map<string, { id: number; status: string; folderPath: string }>(
        knownBooks.map((b) => [b.folderPath, { id: b.id, status: b.status, folderPath: b.folderPath }]),
      );
      const fileByPath = new Map<
        string,
        { id: number; bookId: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }
      >(knownFiles.map((f) => [f.absolutePath, { id: f.id, bookId: f.bookId, ino: f.ino, sizeBytes: f.sizeBytes, mtime: f.mtime, hash: f.hash }]));
      const fileByIno = new Map<number, { id: number; bookId: number; absolutePath: string }>(
        knownFiles.map((f) => [f.ino, { id: f.id, bookId: f.bookId, absolutePath: f.absolutePath }]),
      );
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
          if (r.added > 0) {
            this.bufferBookForEmit(libraryId, r.bookId);
          }
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

      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} jobId=${jobId} libraryFolderId=${libraryFolderId} durationMs=${Date.now() - startedAt} addedCount=${counts.addedCount} updatedCount=${counts.updatedCount} missingCount=${counts.missingCount} - folder candidate scan completed`,
      );
      return counts;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
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
    bookByFolderPath: Map<string, { id: number; status: string; folderPath: string }>,
    fileByPath: Map<string, { id: number; bookId: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }>,
    fileByIno: Map<number, { id: number; bookId: number; absolutePath: string }>,
    formatPriority: string[],
  ): Promise<{ bookId: number; added: number; updated: number }> {
    const counts = { added: 0, updated: 0 };
    const fileCounts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
    const retainedFileIds = new Set<number>();

    const book = await this.upsertBook(candidate, libraryId, libraryFolderId, bookByFolderPath, fileCounts);
    counts.added += fileCounts.addedCount;
    counts.updated += fileCounts.updatedCount;

    // ── Phase 1: Register every file in bookFiles. No metadata extraction yet. ──
    type RegisteredFile = {
      fileId: number;
      format: string | null;
      role: FileRole;
      absolutePath: string;
      isNew: boolean;
      wasReassigned: boolean;
    };

    const registeredFiles: RegisteredFile[] = [];

    for (let sortOrder = 0; sortOrder < candidate.files.length; sortOrder++) {
      const fileStat = candidate.files[sortOrder];
      const { format, role } = classifyFile(fileStat.absolutePath);

      if (role === 'content' && fileStat.sizeBytes === 0) {
        this.logger.warn(
          `[scanner.process_file] [fail] bookId=${book.id} path="${fileStat.absolutePath.replace(/"/g, '\\"')}" reason=zero_byte_content - content file skipped`,
        );
        continue;
      }

      const fileCount: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
      let processResult: { isNew: boolean; reassigned: boolean; fileId: number | null };

      try {
        processResult = await this.processFile(fileStat, format, role, sortOrder, book.id, libraryFolderId, fileByPath, fileByIno, fileCount);
      } catch (err) {
        this.logger.warn(
          `[scanner.process_file] [fail] bookId=${book.id} path="${fileStat.absolutePath.replace(/"/g, '\\"')}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - file processing failed`,
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
        });
        retainedFileIds.add(processResult.fileId);
      }
    }

    await this.pruneMissingBookFiles(book.id, retainedFileIds, fileByPath, fileByIno, counts);

    // ── Phase 2: Pick winner (primary file) from all registered content files. ──
    const contentFiles = registeredFiles.filter((f) => f.role === 'content');

    const winner =
      formatPriority.reduce<RegisteredFile | null>((found, fmt) => found ?? contentFiles.find((f) => f.format === fmt) ?? null, null) ??
      contentFiles[0] ??
      null;

    await this.scannerRepo.updateBookPrimaryFile(book.id, winner?.fileId ?? null);

    // ── Phase 3: Metadata extraction — winner-driven, triggered by new/reassigned files. ──
    //
    // Design rules (agreed per architecture review):
    //   - Text metadata (title, authors, cover, etc.) comes from winner only.
    //   - Audio-specific fields (chapters, narrators, duration) always come from audio if present.
    //   - Extraction only fires when the relevant source file is new or reassigned.

    const winnerIsNew = winner !== null && (winner.isNew || winner.wasReassigned);
    const audioContentFiles = contentFiles.filter((f) => f.format !== null && isAudioFormat(f.format!));
    const newAudioFiles = audioContentFiles.filter((f) => f.isNew || f.wasReassigned);
    const winnerIsAudio = winner !== null && winner.format !== null && isAudioFormat(winner.format);

    // 3a: Extract all shared metadata from winner when winner file is new or reassigned.
    if (winnerIsNew && winner!.format !== null && METADATA_FORMATS.has(winner!.format)) {
      try {
        await this.metadataService.extractAndSave(book.id, winner!.absolutePath, winner!.format);
      } catch (err) {
        this.logger.warn(
          `[scanner.extract_metadata] [fail] bookId=${book.id} path="${winner!.absolutePath.replace(/"/g, '\\"')}" format=${winner!.format} errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - metadata extraction failed`,
        );
      }
    }

    // 3b: When winner is not audio, extract audio-specific fields (chapters, narrators)
    //     from the first audio file if any audio file is new or reassigned.
    //     Cover is intentionally skipped here — winner already owns it from step 3a.
    if (!winnerIsAudio && newAudioFiles.length > 0) {
      const sortedAudio = [...audioContentFiles].sort((a, b) =>
        basename(a.absolutePath).localeCompare(basename(b.absolutePath), undefined, { numeric: true }),
      );
      const firstAudio = sortedAudio[0];
      try {
        await this.metadataService.extractAudioChaptersAndNarrators(book.id, firstAudio.absolutePath, firstAudio.format!);
      } catch (err) {
        this.logger.warn(
          `[scanner.extract_audio_chapters] [fail] bookId=${book.id} path="${firstAudio.absolutePath.replace(/"/g, '\\"')}" format=${firstAudio.format} errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - audio chapters/narrators extraction failed`,
        );
      }
    }

    // 3c: Write per-file duration to bookFiles for every new/reassigned audio file.
    //     Running this for all new audio files (including the winner) ensures
    //     aggregateAudioDuration has accurate per-file data for the total.
    if (newAudioFiles.length > 0) {
      await Promise.all(
        newAudioFiles.map(async (audioFile) => {
          try {
            await this.metadataService.extractAudioFileDuration(book.id, audioFile.absolutePath);
          } catch (err) {
            this.logger.warn(
              `[scanner.extract_audio_duration] [fail] bookId=${book.id} path="${audioFile.absolutePath.replace(/"/g, '\\"')}" errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - audio duration extraction failed`,
            );
          }
        }),
      );
    }

    // 3d: Re-aggregate total duration whenever audio files exist and anything changed.
    if (audioContentFiles.length > 0 && (winnerIsNew || newAudioFiles.length > 0)) {
      try {
        await this.metadataService.aggregateAudioDuration(book.id);
      } catch (err) {
        this.logger.warn(
          `[scanner.aggregate_audio_duration] [fail] bookId=${book.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - audio duration aggregation failed`,
        );
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
      // Detect series-to-single-book merge: files were renamed so all stems match,
      // turning what was a virtual multi-book folder into one real-directory book.
      // Find any known books whose folderPaths are virtual children of this directory
      // and pick the lowest-ID one as the survivor to preserve its reading progress.
      const dirPrefix = candidate.folderPath + sep;
      const virtualChildren = [...bookByFolderPath.values()].filter((b) => b.folderPath.startsWith(dirPrefix));

      if (virtualChildren.length > 0) {
        const survivor = virtualChildren.reduce((a, b) => (a.id < b.id ? a : b));
        await this.scannerRepo.updateBookFolderPath(survivor.id, candidate.folderPath);
        if (survivor.status === 'missing') {
          await this.scannerRepo.updateBookStatus(survivor.id, 'present');
          counts.updatedCount++;
        }
        bookByFolderPath.set(candidate.folderPath, { ...survivor, folderPath: candidate.folderPath });
        this.logger.log(
          `[scanner.upsert_book] [end] libraryId=${libraryId} bookId=${survivor.id} folder="${candidate.folderPath.replace(/"/g, '\\"')}" mergedCount=${virtualChildren.length} action=merge_stem_split - stem-split books merged`,
        );
        return { ...survivor, folderPath: candidate.folderPath };
      }

      const transferred = await this.tryTransferMissingBook(candidate, libraryId, libraryFolderId, bookByFolderPath, counts);
      if (transferred) return transferred;

      const book = await this.scannerRepo.createBook({
        libraryId,
        libraryFolderId,
        folderPath: candidate.folderPath,
        status: 'present',
      });
      counts.addedCount++;
      this.autoFetchOrchestrator
        ?.scheduleIfEligible(book.id, libraryId, 'event_import')
        .catch((err: Error) =>
          this.logger.warn(
            `[scanner.upsert_book] [fail] libraryId=${libraryId} bookId=${book.id} action=schedule_metadata_fetch errorClass=${err.name} error="${err.message.replace(/"/g, '\\"')}" - metadata fetch schedule failed`,
          ),
        );
      bookByFolderPath.set(candidate.folderPath, { id: book.id, status: book.status, folderPath: book.folderPath });
      return book;
    }

    if (existing.status === 'missing') {
      await this.scannerRepo.updateBookStatus(existing.id, 'present');
      counts.updatedCount++;
    }

    // Drain any virtual siblings that share this real folder (created by old stem-split
    // logic or by detectMovedFile updating a book's folderPath to the real directory).
    // Marking them missing here ensures processFile will reassign their files to
    // `existing`, and reconcile cannot restore them once their files are gone.
    const dirPrefix = candidate.folderPath + sep;
    const virtualSiblings = [...bookByFolderPath.values()].filter((b) => b.id !== existing.id && b.folderPath.startsWith(dirPrefix));
    if (virtualSiblings.length > 0) {
      const siblingIds = virtualSiblings.map((b) => b.id);
      await this.scannerRepo.markBooksAsMissing(siblingIds);
      this.scanGateway.emitBookMissing({ libraryId, bookIds: siblingIds });
      this.logger.log(
        `[scanner.upsert_book] [end] libraryId=${libraryId} bookId=${existing.id} folder="${candidate.folderPath.replace(/"/g, '\\"')}" drainedCount=${virtualSiblings.length} action=drain_virtual_siblings - virtual siblings drained`,
      );
    }

    return existing;
  }

  private async tryTransferMissingBook(
    candidate: BookCandidate,
    libraryId: number,
    libraryFolderId: number,
    bookByFolderPath: Map<string, { id: number; status: string; folderPath: string }>,
    counts: ScanCounts,
  ): Promise<{ id: number; status: string; folderPath: string } | null> {
    const contentFiles = candidate.files.filter((file) => {
      const { role } = classifyFile(file.absolutePath);
      return role === 'content' && file.sizeBytes > 0;
    });
    if (contentFiles.length === 0) return null;

    let sourceBookId: number | null = null;

    for (const file of contentFiles) {
      const byIno = await this.scannerRepo.findMissingBookFileWithContextByIno(file.ino);
      if (!byIno) continue;
      sourceBookId = byIno.file.bookId;
      break;
    }

    if (sourceBookId == null) {
      for (const file of contentFiles) {
        const byIno = await this.scannerRepo.findBookFileWithContextByIno(file.ino);
        if (!byIno || byIno.file.absolutePath === file.absolutePath) continue;
        if (byIno.libraryId === libraryId) continue;
        const previousPathStat = await stat(byIno.file.absolutePath).catch(() => null);
        if (previousPathStat?.isFile()) continue;
        sourceBookId = byIno.file.bookId;
        break;
      }
    }

    if (sourceBookId == null) {
      for (const file of contentFiles) {
        let hash: string;
        try {
          hash = await fingerprintFile(file.absolutePath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'EACCES') continue;
          throw err;
        }

        const byHash = await this.scannerRepo.findMissingBookFileWithContextByHash(hash);
        if (byHash) {
          sourceBookId = byHash.file.bookId;
          break;
        }

        const byHashAny = await this.scannerRepo.findBookFileWithContextByHash(hash);
        if (!byHashAny || byHashAny.file.absolutePath === file.absolutePath) continue;
        if (byHashAny.libraryId === libraryId) continue;
        const previousPathStat = await stat(byHashAny.file.absolutePath).catch(() => null);
        if (previousPathStat?.isFile()) continue;
        sourceBookId = byHashAny.file.bookId;
        break;
      }
    }

    if (sourceBookId == null) return null;

    const moved = await this.scannerRepo.moveBookToLibrary(sourceBookId, libraryId, libraryFolderId, candidate.folderPath);
    if (!moved) return null;

    counts.updatedCount++;
    const transferred = { id: moved.id, status: moved.status, folderPath: moved.folderPath };
    bookByFolderPath.set(candidate.folderPath, transferred);
    this.logger.log(
      `[scanner.upsert_book] [end] libraryId=${libraryId} bookId=${moved.id} folder="${candidate.folderPath.replace(/"/g, '\\"')}" action=transfer_missing_book - missing book transferred into destination library`,
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
    fileByPath: Map<string, { id: number; bookId: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }>,
    fileByIno: Map<number, { id: number; bookId: number; absolutePath: string }>,
    counts: ScanCounts,
  ): Promise<{ isNew: boolean; reassigned: boolean; fileId: number | null }> {
    await waitForStability(fileStat.absolutePath);

    // 1. Path match — file didn't move.
    const byPath = fileByPath.get(fileStat.absolutePath);
    if (byPath) {
      const changed = fileStat.sizeBytes !== byPath.sizeBytes || fileStat.mtime.getTime() !== byPath.mtime?.getTime();
      const reassigned = byPath.bookId !== bookId;
      if (changed || reassigned) {
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
        // Always keep sort order current even when content is unchanged.
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
        hash: byPath.hash,
      });
      fileByIno.set(fileStat.ino, { id: byPath.id, bookId, absolutePath: fileStat.absolutePath });
      return { isNew: false, reassigned: reassigned, fileId: byPath.id };
    }

    // 2. Inode match — renamed/moved within the same filesystem.
    const byIno = fileByIno.get(fileStat.ino);
    if (byIno) {
      const oldAbsolutePath = byIno.absolutePath;
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
        hash: oldPathEntry?.hash ?? null,
      });
      fileByIno.set(fileStat.ino, { id: byIno.id, bookId, absolutePath: fileStat.absolutePath });
      return { isNew: false, reassigned: byIno.bookId !== bookId, fileId: byIno.id };
    }

    // 3. Global inode match — cross-library move / rescan reconciliation.
    let globalByIno = await this.scannerRepo.findBookFileWithContextByIno(fileStat.ino);
    if (
      !globalByIno ||
      globalByIno.file.absolutePath === fileStat.absolutePath ||
      (globalByIno.file.bookId !== bookId && globalByIno.bookStatus !== 'missing')
    ) {
      globalByIno = await this.scannerRepo.findMissingBookFileWithContextByIno(fileStat.ino);
    }

    if (
      globalByIno &&
      globalByIno.file.absolutePath !== fileStat.absolutePath &&
      (globalByIno.file.bookId === bookId || globalByIno.bookStatus === 'missing')
    ) {
      const oldAbsolutePath = globalByIno.file.absolutePath;
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
        hash: globalByIno.file.hash,
      });
      fileByIno.set(fileStat.ino, { id: globalByIno.file.id, bookId, absolutePath: fileStat.absolutePath });
      return { isNew: false, reassigned: globalByIno.file.bookId !== bookId, fileId: globalByIno.file.id };
    }

    // 4. Hash match — cross-filesystem copy (expensive, last resort).
    let hash: string;
    try {
      hash = await fingerprintFile(fileStat.absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EACCES') {
        this.logger.debug(
          `[scanner.process_file] [end] bookId=${bookId} path="${fileStat.absolutePath.replace(/"/g, '\\"')}" action=skip_inaccessible - file no longer accessible`,
        );
        return { isNew: false, reassigned: false, fileId: null };
      }
      throw err;
    }
    const byHash = await this.scannerRepo.findBookFileByHash(hash, libraryFolderId);
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
        hash: byHash.hash,
      });
      fileByIno.set(fileStat.ino, { id: byHash.id, bookId, absolutePath: fileStat.absolutePath });
      return { isNew: false, reassigned: byHash.bookId !== bookId, fileId: byHash.id };
    }

    let globalByHash = await this.scannerRepo.findBookFileWithContextByHash(hash);
    if (
      !globalByHash ||
      globalByHash.file.absolutePath === fileStat.absolutePath ||
      (globalByHash.file.bookId !== bookId && globalByHash.bookStatus !== 'missing')
    ) {
      globalByHash = await this.scannerRepo.findMissingBookFileWithContextByHash(hash);
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
        hash,
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
        hash,
      });
      fileByIno.set(fileStat.ino, { id: globalByHash.file.id, bookId, absolutePath: fileStat.absolutePath });
      return { isNew: false, reassigned: globalByHash.file.bookId !== bookId, fileId: globalByHash.file.id };
    }

    // 5. Genuinely new file.
    const created = await this.scannerRepo.createBookFile({
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
      sortOrder,
    });
    counts.addedCount++;
    fileByPath.set(fileStat.absolutePath, {
      id: created.id,
      bookId,
      ino: fileStat.ino,
      sizeBytes: fileStat.sizeBytes,
      mtime: fileStat.mtime,
      hash,
    });
    fileByIno.set(fileStat.ino, { id: created.id, bookId, absolutePath: fileStat.absolutePath });
    return { isNew: true, reassigned: false, fileId: created.id };
  }

  private async pruneMissingBookFiles(
    bookId: number,
    retainedFileIds: Set<number>,
    fileByPath: Map<string, { id: number; bookId: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }>,
    fileByIno: Map<number, { id: number; bookId: number; absolutePath: string }>,
    counts: { added: number; updated: number },
  ): Promise<void> {
    const existingFiles = await this.scannerRepo.findBookFilesByBookId(bookId);

    for (const existing of existingFiles) {
      if (retainedFileIds.has(existing.id)) continue;

      await this.scannerRepo.deleteBookFile(existing.id);
      counts.updated += 1;

      const byPathEntry = fileByPath.get(existing.absolutePath);
      if (byPathEntry?.id === existing.id) {
        fileByPath.delete(existing.absolutePath);
      }
      const byInoEntry = fileByIno.get(existing.ino);
      if (byInoEntry?.id === existing.id) {
        fileByIno.delete(existing.ino);
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
