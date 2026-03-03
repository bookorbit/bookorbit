import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

import type { WriteResult } from '@projectx/types';
import { FileLockService } from './file-lock.service';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteSettingsService } from './file-write-settings.service';
import { FormatWriterRegistry } from './format-writer.registry';
import type { BookWritePayload, BookWritePayloadKey } from './interfaces/book-write-payload.interface';

// All known payload fields for Phase 1 full-write mask
const ALL_FIELDS = new Set<BookWritePayloadKey>([
  'title',
  'subtitle',
  'description',
  'publisher',
  'publishedYear',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
  'isbn10',
  'isbn13',
  'rating',
  'authors',
  'genres',
  'tags',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'openLibraryId',
  'coverBytes',
]);

@Injectable()
export class FileWriteService implements OnModuleDestroy {
  private readonly logger = new Logger(FileWriteService.name);
  private readonly booksPath: string;
  private readonly debounceMap = new Map<number, NodeJS.Timeout>();

  constructor(
    private readonly fileWriteRepo: FileWriteRepository,
    private readonly settingsService: FileWriteSettingsService,
    private readonly registry: FormatWriterRegistry,
    private readonly lockService: FileLockService,
    private readonly config: ConfigService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  scheduleWrite(bookId: number, triggeredBy: 'auto' | 'sync', userId?: number): void {
    const existing = this.debounceMap.get(bookId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceMap.delete(bookId);
      this.logger.debug(`Scheduled write firing for book ${bookId} (${triggeredBy})`);
      this.writeToFile(bookId, triggeredBy, userId).catch((err: Error) =>
        this.logger.warn(`Background write failed for book ${bookId}: ${err.message}`),
      );
    }, 3_000);
    this.debounceMap.set(bookId, timer);
  }

  onModuleDestroy(): void {
    for (const timer of this.debounceMap.values()) clearTimeout(timer);
    this.debounceMap.clear();
  }

  async writeToFile(bookId: number, triggeredBy: 'auto' | 'sync', userId?: number, dryRun = false): Promise<WriteResult> {
    const file = await this.fileWriteRepo.findPrimaryFileForBook(bookId);
    if (!file) {
      return { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no primary file' };
    }

    const format = (file.format ?? '').toLowerCase();
    if (!this.registry.supports(format)) {
      const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format not supported' };
      this.logger.debug(`Write skipped for book ${bookId}: format not supported (${format || 'unknown'})`);
      if (triggeredBy === 'sync') {
        await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format: format || 'unknown', result, triggeredBy });
      }
      return result;
    }

    const settings = await this.settingsService.resolve(file.libraryId);
    if (!settings.enabled && !dryRun) {
      this.logger.debug(`Write skipped for book ${bookId}: file write is disabled`);
      return { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'disabled' };
    }

    const sizeBytes = file.sizeBytes ?? 0;
    if (sizeBytes > settings.maxFileSizeBytes) {
      const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'file exceeds size limit' };
      this.logger.debug(`Write skipped for book ${bookId}: file size ${sizeBytes} exceeds limit ${settings.maxFileSizeBytes}`);
      if (triggeredBy === 'sync') {
        await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
      }
      return result;
    }

    const rawPayload = await this.fileWriteRepo.loadPayload(bookId);
    if (!rawPayload) {
      return { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no metadata' };
    }

    const payload: BookWritePayload = { ...rawPayload };

    if (settings.writeCover && !dryRun) {
      payload.coverBytes = await this.loadCoverBytes(bookId);
    }

    const writer = this.registry.get(format)!;

    let result: WriteResult;
    try {
      result = await this.lockService.withLock(file.absolutePath, () => writer.write(file.absolutePath, payload, { fieldMask: ALL_FIELDS, dryRun }));
    } catch (err) {
      result = { status: 'failed', fieldsWritten: [], durationMs: 0, reason: (err as Error).message };
      this.logger.warn(`Write failed for book ${bookId}: ${(err as Error).message}`);
      await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
      return result;
    }

    await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
    if (result.status === 'success') {
      await this.fileWriteRepo.setLastWrittenAt(bookId, new Date());
      this.logger.log(`Wrote metadata to file for book ${bookId} (${format}, ${result.fieldsWritten.length} fields, ${result.durationMs}ms)`);
    }
    return result;
  }

  private async loadCoverBytes(bookId: number): Promise<Buffer | null> {
    const dir = join(this.booksPath, 'covers', String(bookId));
    try {
      const files = await readdir(dir);
      const cover = files.find((f) => f.startsWith('cover_custom.')) ?? files.find((f) => f.startsWith('cover_extracted.'));
      if (!cover) return null;
      return readFile(join(dir, cover));
    } catch {
      return null;
    }
  }
}
