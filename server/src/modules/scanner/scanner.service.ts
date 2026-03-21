import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional } from '@nestjs/common';

import type { BookMissingEvent, CoverRefreshedEvent, CoverRefreshProgressEvent, ScanProgressEvent } from '@projectx/types';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { MetadataService } from '../metadata/metadata.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { basename, dirname, sep } from 'path';
import { readdir } from 'fs/promises';

import { classifyFile, DEFAULT_FORMAT_PRIORITY, FileRole, isAudioFormat } from './lib/classify';
import { fingerprintFile } from './lib/hash';
import { waitForStability } from './lib/stability';
import { BookCandidate, FileStat, findBookCandidates, buildSingleBookCandidate } from './lib/walk';
import { ScannerRepository } from './scanner.repository';

const METADATA_FORMATS = new Set(['epub', 'mobi', 'azw3', 'azw', 'cbz', 'cbr', 'cb7', 'fb2', 'pdf', 'm4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac']);
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
    const formatPriority = settings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY;
    const excludePatterns = settings?.excludePatterns ?? [];

    const job = await this.scannerRepo.createScanJob(libraryId, triggeredBy);

    this.scanJobStore.create(job.id, libraryId, 0);
    this.emitFromStore(libraryId, job.id, 'running');

    this.runScan(libraryId, job.id, folders, allowedFormats, formatPriority, excludePatterns).catch((err) =>
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

  scanBookFolderAsync(filePath: string, libraryId: number): void {
    this.scanBookFolder(filePath, libraryId).catch((err) =>
      this.logger.error(`Targeted folder scan failed for ${filePath}: ${(err as Error).message}`),
    );
  }

  private async scanBookFolder(filePath: string, libraryId: number): Promise<void> {
    const allFolders = await this.scannerRepo.findLibraryFolders(libraryId);
    const libraryFolder = allFolders.find((f) => filePath.startsWith(f.path + sep));
    if (!libraryFolder) return;

    const bookFolder = dirname(filePath);

    // If the file sits directly inside the library root, a targeted scan would
    // walk the entire root — treat it as a full scan instead.
    if (bookFolder === libraryFolder.path) {
      this.startScanAsync(libraryId);
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

    const settings = await this.scannerRepo.findLibrarySettings(libraryId);
    const allowedFormats = settings?.allowedFormats ?? [];
    const formatPriority = settings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY;
    const excludePatterns = settings?.excludePatterns ?? [];

    let candidate: BookCandidate | null;
    try {
      candidate = await buildSingleBookCandidate(resolvedBookFolder, libraryFolder.path, excludePatterns, (msg) => this.logger.warn(msg));
    } catch (err) {
      this.logger.warn(`Cannot walk ${resolvedBookFolder}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (!candidate) return;

    const allowed = allowedFormats.length > 0 ? new Set(allowedFormats) : null;
    if (allowed) {
      const filtered = candidate.files.filter((f) => {
        const { role, format } = classifyFile(f.absolutePath);
        return role !== 'content' || (format !== null && allowed.has(format));
      });
      if (!filtered.some((f) => classifyFile(f.absolutePath).role === 'content')) return;
      candidate = { ...candidate, files: filtered };
    }

    // Load only books/files relevant to this specific folder (including any
    // virtual stem-split children so the merge logic in upsertBook can run).
    const knownBooks = await this.scannerRepo.findBooksByFolderPath(resolvedBookFolder);
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

    this.logger.log(`Targeted scan of ${basename(resolvedBookFolder)}: added=${result.added}, updated=${result.updated}`);
  }

  private async runScan(
    libraryId: number,
    jobId: number,
    folders: Awaited<ReturnType<ScannerRepository['findLibraryFolders']>>,
    allowedFormats: string[],
    formatPriority: string[],
    excludePatterns: string[],
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
        candidates = await findBookCandidates(folder.path, excludePatterns, (msg) => this.logger.warn(msg));
      } catch (err) {
        this.logger.warn(`Cannot walk ${folder.path}: ${err instanceof Error ? err.message : String(err)}`);
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
      for (const { id: folderId, candidates, knownBooks, knownFiles } of folderWork) {
        const counts = await this.scanFolderCandidates(folderId, libraryId, candidates, knownBooks, knownFiles, jobId, formatPriority);
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
    candidates: BookCandidate[],
    knownBooks: Awaited<ReturnType<ScannerRepository['findBooksByLibraryFolder']>>,
    knownFiles: Awaited<ReturnType<ScannerRepository['findBookFilesByLibraryFolder']>>,
    jobId: number,
    formatPriority: string[],
  ): Promise<ScanCounts> {
    const counts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

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
    fileByPath: Map<string, { id: number; bookId: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }>,
    fileByIno: Map<number, { id: number; bookId: number; absolutePath: string }>,
    formatPriority: string[],
  ): Promise<{ bookId: number; added: number; updated: number }> {
    const counts = { added: 0, updated: 0 };
    const fileCounts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    this.logger.log(`Processing: ${basename(candidate.folderPath)} (${candidate.files.length} file${candidate.files.length !== 1 ? 's' : ''})`);

    const book = await this.upsertBook(candidate, libraryId, libraryFolderId, bookByFolderPath, fileCounts);
    counts.added += fileCounts.addedCount;
    counts.updated += fileCounts.updatedCount;

    // Determine which format wins primary selection when multiple content-format files exist.
    // Exclude zero-byte files from the election so a corrupt/empty file doesn't shadow a valid one.
    const contentFiles = candidate.files.filter((f) => classifyFile(f.absolutePath).role === 'content' && f.sizeBytes > 0);
    const chosenFormat =
      contentFiles.length > 1 ? (formatPriority.find((fmt) => contentFiles.some((f) => classifyFile(f.absolutePath).format === fmt)) ?? null) : null;

    const contentCandidates: { fileId: number; format: string | null }[] = [];
    // New audio content files collected for batch metadata processing after the file loop.
    const newAudioContentFiles: { absolutePath: string; format: string }[] = [];
    // Track whether a non-audio format already extracted book metadata in this scan.
    // If so, the audio block should only extract duration, not overwrite metadata.
    let nonAudioMetadataExtracted = false;

    for (let sortOrder = 0; sortOrder < candidate.files.length; sortOrder++) {
      const fileStat = candidate.files[sortOrder];
      const { format, role: classifiedRole } = classifyFile(fileStat.absolutePath);

      if (classifiedRole === 'content' && fileStat.sizeBytes === 0) {
        this.logger.warn(`Zero-byte content file skipped: ${fileStat.absolutePath}`);
        continue;
      }

      const role: FileRole = classifiedRole;

      const fileCount: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };
      let processResult: { isNew: boolean; reassigned: boolean; fileId: number | null };

      try {
        processResult = await this.processFile(fileStat, format, role, sortOrder, book.id, libraryFolderId, fileByPath, fileByIno, fileCount);
      } catch (err) {
        this.logger.warn(`Failed to process file ${fileStat.absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      counts.added += fileCount.addedCount;
      counts.updated += fileCount.updatedCount;

      if (classifiedRole === 'content' && processResult.fileId !== null) {
        contentCandidates.push({ fileId: processResult.fileId, format });
      }

      if ((processResult.isNew || processResult.reassigned) && format && METADATA_FORMATS.has(format)) {
        if (role === 'content' && isAudioFormat(format)) {
          newAudioContentFiles.push({ absolutePath: fileStat.absolutePath, format });
        } else if (!isAudioFormat(format)) {
          try {
            await this.metadataService.extractAndSave(book.id, fileStat.absolutePath, format);
            nonAudioMetadataExtracted = true;
          } catch (err) {
            this.logger.warn(`Metadata extraction failed for ${fileStat.absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    const winner =
      formatPriority.reduce<{ fileId: number; format: string | null } | null>(
        (found, fmt) => found ?? contentCandidates.find((f) => f.format === fmt) ?? null,
        null,
      ) ??
      (chosenFormat ? (contentCandidates.find((f) => f.format === chosenFormat) ?? null) : null) ??
      contentCandidates[0] ??
      null;

    await this.scannerRepo.updateBookPrimaryFile(book.id, winner?.fileId ?? null);

    // For audiobooks: extract full metadata from the first (natural-sorted) content file,
    // duration-only from the rest, then aggregate total duration into bookMetadata.
    // If a non-audio format (epub, mobi, etc.) already extracted metadata in this scan,
    // skip extractAndSave for audio and only collect durations — the ebook metadata wins.
    if (newAudioContentFiles.length > 0) {
      newAudioContentFiles.sort((a, b) => basename(a.absolutePath).localeCompare(basename(b.absolutePath), undefined, { numeric: true }));

      const [first, ...rest] = newAudioContentFiles;

      if (!nonAudioMetadataExtracted) {
        try {
          await this.metadataService.extractAndSave(book.id, first.absolutePath, first.format);
        } catch (err) {
          this.logger.warn(`Audio metadata extraction failed for ${first.absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // When ebook metadata already won, all audio files only contribute duration.
      const durationOnlyFiles = nonAudioMetadataExtracted ? newAudioContentFiles : rest;
      await Promise.all(
        durationOnlyFiles.map(async (audioFile) => {
          try {
            await this.metadataService.extractAudioFileDuration(book.id, audioFile.absolutePath);
          } catch (err) {
            this.logger.warn(`Audio duration extraction failed for ${audioFile.absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );

      try {
        await this.metadataService.aggregateAudioDuration(book.id);
      } catch (err) {
        this.logger.warn(`Audio duration aggregation failed for book ${book.id}: ${err instanceof Error ? err.message : String(err)}`);
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
        this.logger.log(`Merged ${virtualChildren.length} stem-split book(s) into book ${survivor.id}: ${basename(candidate.folderPath)}`);
        return { ...survivor, folderPath: candidate.folderPath };
      }

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
      this.logger.log(`Drained ${virtualSiblings.length} virtual sibling(s) into book ${existing.id}: ${basename(candidate.folderPath)}`);
    }

    return existing;
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
      return { isNew: false, reassigned: reassigned, fileId: byPath.id };
    }

    // 2. Inode match — renamed/moved within the same filesystem.
    const byIno = fileByIno.get(fileStat.ino);
    if (byIno) {
      await this.scannerRepo.updateBookFile(byIno.id, {
        bookId,
        absolutePath: fileStat.absolutePath,
        relPath: fileStat.relPath,
        sizeBytes: fileStat.sizeBytes,
        mtime: fileStat.mtime,
        format,
        role,
        sortOrder,
      });
      counts.updatedCount++;
      return { isNew: false, reassigned: byIno.bookId !== bookId, fileId: byIno.id };
    }

    // 3. Hash match — cross-filesystem copy (expensive, last resort).
    let hash: string;
    try {
      hash = await fingerprintFile(fileStat.absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EACCES') {
        this.logger.debug(`File no longer accessible, skipping: ${fileStat.absolutePath}`);
        return { isNew: false, reassigned: false, fileId: null };
      }
      throw err;
    }
    const byHash = await this.scannerRepo.findBookFileByHash(hash, libraryFolderId);
    if (byHash) {
      await this.scannerRepo.updateBookFile(byHash.id, {
        bookId,
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
      return { isNew: false, reassigned: byHash.bookId !== bookId, fileId: byHash.id };
    }

    // 4. Genuinely new file.
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
    return { isNew: true, reassigned: false, fileId: created.id };
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
