import { Injectable, Logger, NotFoundException } from '@nestjs/common';

const METADATA_FORMATS = new Set(['epub', 'mobi', 'azw3', 'azw', 'cbz', 'cbr', 'cb7', 'pdf']);

import { MetadataService } from '../metadata/metadata.service';
import { classifyFile } from './lib/classify';
import { sha256File } from './lib/hash';
import { waitForStability } from './lib/stability';
import { BookCandidate, FileStat, findBookCandidates } from './lib/walk';
import { ScannerRepository } from './scanner.repository';

interface ScanCounts {
  addedCount: number;
  updatedCount: number;
  missingCount: number;
}

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private readonly scannerRepo: ScannerRepository,
    private readonly metadataService: MetadataService,
  ) {}

  async scan(libraryId: number, triggeredBy: 'manual' | 'watcher' | 'schedule' = 'manual') {
    const folders = await this.scannerRepo.findLibraryFolders(libraryId);
    if (folders.length === 0) throw new NotFoundException(`Library ${libraryId} has no folders`);

    const job = await this.scannerRepo.createScanJob(libraryId, triggeredBy);
    this.logger.log(`Scan job ${job.id} started for library ${libraryId}`);

    const totals: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    try {
      for (const folder of folders) {
        this.logger.log(`Scanning folder: ${folder.path}`);
        const counts = await this.scanFolder(folder.id, folder.libraryId, folder.path);
        totals.addedCount += counts.addedCount;
        totals.updatedCount += counts.updatedCount;
        totals.missingCount += counts.missingCount;
      }

      await this.scannerRepo.completeScanJob(job.id, totals);
      this.logger.log(`Scan job ${job.id} completed — ${JSON.stringify(totals)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.scannerRepo.failScanJob(job.id, message);
      this.logger.error(`Scan job ${job.id} failed: ${message}`);
      throw err;
    }

    return { jobId: job.id, ...totals };
  }

  private async scanFolder(libraryFolderId: number, libraryId: number, folderPath: string): Promise<ScanCounts> {
    const counts: ScanCounts = { addedCount: 0, updatedCount: 0, missingCount: 0 };

    const [knownBooks, knownFiles] = await Promise.all([
      this.scannerRepo.findBooksByLibraryFolder(libraryFolderId),
      this.scannerRepo.findBookFilesByLibraryFolder(libraryFolderId),
    ]);

    const bookByFolderPath = new Map(knownBooks.map((b) => [b.folderPath, b]));
    const fileByPath = new Map(knownFiles.map((f) => [f.absolutePath, f]));
    const fileByIno = new Map(knownFiles.map((f) => [f.ino, f]));
    const seenBookIds = new Set<number>();

    let candidates: BookCandidate[];
    try {
      candidates = await findBookCandidates(folderPath);
    } catch (err) {
      this.logger.warn(`Cannot walk ${folderPath}: ${err}`);
      return counts;
    }

    for (const candidate of candidates) {
      const book = await this.upsertBook(candidate, libraryId, libraryFolderId, bookByFolderPath, counts);
      seenBookIds.add(book.id);

      for (const fileStat of candidate.files) {
        const { format } = classifyFile(fileStat.absolutePath);
        const isNew = await this.processFile(fileStat, book.id, libraryFolderId, fileByPath, fileByIno, counts);
        if (isNew && format && METADATA_FORMATS.has(format)) {
          await this.metadataService.extractAndSave(book.id, fileStat.absolutePath, format);
        }
      }
    }

    const missingIds = knownBooks.filter((b) => !seenBookIds.has(b.id)).map((b) => b.id);

    await this.scannerRepo.markBooksAsMissing(missingIds);
    counts.missingCount += missingIds.length;

    return counts;
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
      return book;
    }

    if (existing.status === 'missing') {
      await this.scannerRepo.updateBookStatus(existing.id, 'present');
      counts.updatedCount++;
    }

    return existing;
  }

  // Returns true if a new file record was created (triggers metadata extraction).
  private async processFile(
    fileStat: FileStat,
    bookId: number,
    libraryFolderId: number,
    fileByPath: Map<string, { id: number; ino: number; sizeBytes: number | null; mtime: Date | null; hash: string | null }>,
    fileByIno: Map<number, { id: number; absolutePath: string }>,
    counts: ScanCounts,
  ): Promise<boolean> {
    await waitForStability(fileStat.absolutePath);

    const { format, role } = classifyFile(fileStat.absolutePath);

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
    const hash = await sha256File(fileStat.absolutePath);
    const byHash = await this.scannerRepo.findBookFileByHash(hash);
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
}
