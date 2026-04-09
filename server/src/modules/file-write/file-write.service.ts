import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

import type { WriteResult } from '@projectx/types';
import { bookCoverDirPath, findPreferredBookCoverFileName } from '../../common/book-cover-storage';
import { FORMAT_CB7, FORMAT_CBZ, FORMAT_EPUB, FORMAT_PDF, createBookWriteFieldMask } from './file-write.constants';
import { FileLockService } from './file-lock.service';
import { FileWriteRepository } from './file-write.repository';
import { FormatWriterRegistry } from './format-writer.registry';
import type { BookWritePayload } from './interfaces/book-write-payload.interface';

const FILE_WRITE_EVENT = 'file_write.write';
const FILE_WRITE_SCHEDULE_EVENT = 'file_write.schedule';
const FILE_WRITE_COVER_EVENT = 'file_write.cover_load';
const UNKNOWN_FORMAT = 'unknown';
const DEFAULT_WRITE_DEBOUNCE_MS = 3_000;
const DEFAULT_MAX_CONCURRENT_WRITES = 2;

@Injectable()
export class FileWriteService implements OnModuleDestroy {
  private readonly logger = new Logger(FileWriteService.name);
  private readonly appDataPath: string;
  private readonly debounceMs: number;
  private readonly maxConcurrentWrites: number;
  private readonly debounceMap = new Map<number, NodeJS.Timeout>();
  private readonly scheduledWriteRuns = new Set<Promise<unknown>>();
  private readonly writeQueue: Array<() => void> = [];
  private activeWrites = 0;

  constructor(
    private readonly fileWriteRepo: FileWriteRepository,
    private readonly registry: FormatWriterRegistry,
    private readonly lockService: FileLockService,
    private readonly config: ConfigService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
    this.debounceMs = resolvePositiveInteger(this.config.get('fileWrite.debounceMs'), DEFAULT_WRITE_DEBOUNCE_MS);
    this.maxConcurrentWrites = resolvePositiveInteger(this.config.get('fileWrite.maxConcurrentWrites'), DEFAULT_MAX_CONCURRENT_WRITES);
  }

  scheduleWrite(bookId: number, triggeredBy: 'auto' | 'sync', userId?: number): void {
    const existing = this.debounceMap.get(bookId);
    if (existing) clearTimeout(existing);

    this.logger.debug(
      `[${FILE_WRITE_SCHEDULE_EVENT}] [start] bookId=${bookId} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} debounceMs=${this.debounceMs} - scheduled file write queued`,
    );

    const timer = setTimeout(() => {
      this.debounceMap.delete(bookId);
      this.logger.debug(
        `[${FILE_WRITE_SCHEDULE_EVENT}] [end] bookId=${bookId} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} - scheduled file write fired`,
      );
      const run = this.writeToFile(bookId, triggeredBy, userId)
        .catch((err: Error) =>
          this.logger.warn(
            `[${FILE_WRITE_SCHEDULE_EVENT}] [fail] bookId=${bookId} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} errorClass=${err.name} error="${sanitizeErrorMessage(err.message)}" - scheduled file write failed`,
          ),
        )
        .finally(() => {
          this.scheduledWriteRuns.delete(run);
        });
      this.scheduledWriteRuns.add(run);
    }, this.debounceMs);
    this.debounceMap.set(bookId, timer);
  }

  onModuleDestroy(): void {
    this.clearScheduledWrites();
    for (const release of this.writeQueue) {
      release();
    }
    this.writeQueue.length = 0;
  }

  async drainScheduledWritesForTests(): Promise<void> {
    this.clearScheduledWrites();
    while (this.scheduledWriteRuns.size > 0) {
      await Promise.allSettled([...this.scheduledWriteRuns]);
    }
  }

  private clearScheduledWrites(): void {
    for (const timer of this.debounceMap.values()) clearTimeout(timer);
    this.debounceMap.clear();
  }

  async writeToFile(bookId: number, triggeredBy: 'auto' | 'sync', userId?: number, dryRun = false): Promise<WriteResult> {
    await this.acquireWriteSlot();

    const startedAt = Date.now();
    this.logger.log(
      `[${FILE_WRITE_EVENT}] [start] bookId=${bookId} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} dryRun=${dryRun} - file write started`,
    );

    try {
      const file = await this.fileWriteRepo.findPrimaryFileForBook(bookId);
      if (!file) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no primary file' };
        this.logWriteEnd(bookId, UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const format = (file.format ?? '').toLowerCase();
      if (!this.registry.supports(format)) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format not supported' };
        if (triggeredBy === 'sync') {
          await this.fileWriteRepo.insertLog({
            bookId,
            bookFileId: file.id,
            userId: userId ?? null,
            format: format || UNKNOWN_FORMAT,
            result,
            triggeredBy,
          });
        }
        this.logWriteEnd(bookId, format || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const libConfig = await this.fileWriteRepo.findLibraryFileWriteConfig(file.libraryId);
      if (!libConfig) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'library not found' };
        this.logWriteEnd(bookId, format || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      if (!libConfig.fileWriteEnabled && !dryRun) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'disabled' };
        this.logWriteEnd(bookId, format || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const formatSettings = resolveFormatSettings(libConfig, format);
      if (!formatSettings.enabled) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format disabled' };
        if (triggeredBy === 'sync') {
          await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
        }
        this.logWriteEnd(bookId, format, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const sizeBytes = file.sizeBytes ?? 0;
      if (sizeBytes > formatSettings.maxFileSizeBytes) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'file exceeds size limit' };
        if (triggeredBy === 'sync') {
          await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
        }
        this.logWriteEnd(bookId, format, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const rawPayload = await this.fileWriteRepo.loadPayload(bookId);
      if (!rawPayload) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no metadata' };
        this.logWriteEnd(bookId, format, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const payload: BookWritePayload = { ...rawPayload };

      if (libConfig.fileWriteWriteCover && !dryRun) {
        payload.coverBytes = await this.loadCoverBytes(bookId);
      }

      const writer = this.registry.get(format)!;

      let result: WriteResult;
      try {
        result = await this.lockService.withLock(file.absolutePath, () =>
          writer.write(file.absolutePath, payload, { fieldMask: createBookWriteFieldMask(), dryRun }),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result = { status: 'failed', fieldsWritten: [], durationMs: 0, reason };
        this.logWriteFail(bookId, format, triggeredBy, userId, dryRun, startedAt, error);
        await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
        return result;
      }

      await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
      if (result.status === 'success') {
        await this.fileWriteRepo.setLastWrittenAt(bookId, new Date());
      }
      this.logWriteEnd(bookId, format, triggeredBy, userId, dryRun, startedAt, result);
      return result;
    } finally {
      this.releaseWriteSlot();
    }
  }

  findWriteLog(bookId: number, limit = 20) {
    return this.fileWriteRepo.findWriteLog(bookId, limit);
  }

  findNonMissingPrimaryFilesByLibrary(libraryId: number) {
    return this.fileWriteRepo.findNonMissingPrimaryFilesByLibrary(libraryId);
  }

  private async loadCoverBytes(bookId: number): Promise<Buffer | null> {
    const startedAt = Date.now();
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    try {
      const files = await readdir(dir);
      const cover = findPreferredBookCoverFileName(files);
      if (!cover) return null;
      return readFile(join(dir, cover));
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      this.logger.debug(
        `[${FILE_WRITE_COVER_EVENT}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover bytes unavailable`,
      );
      return null;
    }
  }

  private logWriteEnd(
    bookId: number,
    format: string,
    triggeredBy: 'auto' | 'sync',
    userId: number | undefined,
    dryRun: boolean,
    startedAt: number,
    result: WriteResult,
  ): void {
    const reasonPart = result.reason ? ` reason="${sanitizeErrorMessage(result.reason)}"` : '';
    this.logger.log(
      `[${FILE_WRITE_EVENT}] [end] bookId=${bookId} format=${format || UNKNOWN_FORMAT} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} dryRun=${dryRun} durationMs=${Date.now() - startedAt} status=${result.status} fieldsWritten=${result.fieldsWritten.length}${reasonPart} - file write completed`,
    );
  }

  private logWriteFail(
    bookId: number,
    format: string,
    triggeredBy: 'auto' | 'sync',
    userId: number | undefined,
    dryRun: boolean,
    startedAt: number,
    error: unknown,
  ): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    this.logger.warn(
      `[${FILE_WRITE_EVENT}] [fail] bookId=${bookId} format=${format || UNKNOWN_FORMAT} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} dryRun=${dryRun} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - file write failed`,
    );
  }

  private async acquireWriteSlot(): Promise<void> {
    if (this.activeWrites < this.maxConcurrentWrites) {
      this.activeWrites++;
      return;
    }

    await new Promise<void>((resolve) => {
      this.writeQueue.push(resolve);
    });
    this.activeWrites++;
  }

  private releaseWriteSlot(): void {
    this.activeWrites = Math.max(this.activeWrites - 1, 0);
    const next = this.writeQueue.shift();
    if (next) {
      next();
    }
  }
}

type LibraryFileWriteConfig = {
  fileWriteEnabled: boolean;
  fileWriteWriteCover: boolean;
  fileWriteEpubEnabled: boolean;
  fileWriteEpubMaxFileSizeMb: number;
  fileWritePdfEnabled: boolean;
  fileWritePdfMaxFileSizeMb: number;
  fileWriteCbxEnabled: boolean;
  fileWriteCbxMaxFileSizeMb: number;
};

function resolveFormatSettings(config: LibraryFileWriteConfig, format: string): { enabled: boolean; maxFileSizeBytes: number } {
  switch (format) {
    case FORMAT_EPUB:
      return { enabled: config.fileWriteEpubEnabled, maxFileSizeBytes: config.fileWriteEpubMaxFileSizeMb * 1024 * 1024 };
    case FORMAT_PDF:
      return { enabled: config.fileWritePdfEnabled, maxFileSizeBytes: config.fileWritePdfMaxFileSizeMb * 1024 * 1024 };
    case FORMAT_CBZ:
    case FORMAT_CB7:
      return { enabled: config.fileWriteCbxEnabled, maxFileSizeBytes: config.fileWriteCbxMaxFileSizeMb * 1024 * 1024 };
    default:
      return { enabled: false, maxFileSizeBytes: 0 };
  }
}

function resolvePositiveInteger(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.floor(numeric);
}

function formatUserId(userId: number | undefined): string {
  return userId == null ? 'null' : String(userId);
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(/"/g, '\\"');
}
