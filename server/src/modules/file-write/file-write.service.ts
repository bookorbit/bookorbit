import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

import type { WriteResult } from '@bookorbit/types';
import { isAudioFormat, NotificationType } from '@bookorbit/types';
import { bookCoverDirPath, findPreferredBookCoverFileName } from '../../common/book-cover-storage';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { NotificationService } from '../notification/notification.service';
import { computeFileHash } from '../scanner/lib/hash';
import { AUDIO_WRITE_FORMATS, FORMAT_CB7, FORMAT_CBZ, FORMAT_EPUB, FORMAT_PDF, createBookWriteFieldMask } from './file-write.constants';
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

type FileWriteTarget = {
  id: number;
  absolutePath: string;
  format: string | null;
  sizeBytes: number | null;
  fileHash?: string | null;
  libraryId: number;
};

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
    private readonly notificationService: NotificationService,
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

  cancelPendingWrite(bookId: number): void {
    const existing = this.debounceMap.get(bookId);
    if (existing) {
      clearTimeout(existing);
      this.debounceMap.delete(bookId);
    }
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

  async writeToFile(
    bookId: number,
    triggeredBy: 'auto' | 'sync',
    userId?: number,
    dryRun = false,
    force = false,
    suppressNotification = false,
  ): Promise<WriteResult> {
    await this.acquireWriteSlot();

    const startedAt = Date.now();
    this.logger.debug(
      `[${FILE_WRITE_EVENT}] [start] bookId=${bookId} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} dryRun=${dryRun} force=${force} - file write started`,
    );

    try {
      const primaryFile = await this.fileWriteRepo.findPrimaryFileForBook(bookId);
      if (!primaryFile) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no primary file' };
        this.logWriteEnd(bookId, UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const primaryFormat = normalizeFormat(primaryFile.format);
      const targets = await this.resolveWriteTargets(bookId, primaryFile);
      if (!targets.some((target) => this.registry.supports(normalizeFormat(target.format)))) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format not supported' };
        await Promise.all(targets.map((target) => this.insertTargetLogIfSync(bookId, target, result, triggeredBy, userId)));
        this.logWriteEnd(bookId, primaryFormat || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const libConfig = await this.fileWriteRepo.findLibraryFileWriteConfig(primaryFile.libraryId);
      if (!libConfig) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'library not found' };
        this.logWriteEnd(bookId, primaryFormat || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      if (!libConfig.fileWriteEnabled && !dryRun && !force) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'disabled' };
        this.logWriteEnd(bookId, primaryFormat || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const targetSkips = targets.map((target) => ({
        target,
        result: this.resolveTargetSkip(target, libConfig),
      }));
      if (targetSkips.every(({ result }) => result !== null)) {
        const results = await Promise.all(
          targetSkips.map(async ({ target, result }) => {
            await this.insertTargetLogIfSync(bookId, target, result!, triggeredBy, userId);
            return result!;
          }),
        );
        const result = aggregateWriteResults(results, Date.now() - startedAt);
        this.logWriteEnd(bookId, primaryFormat || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const rawPayload = await this.fileWriteRepo.loadPayload(bookId);
      if (!rawPayload) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no metadata' };
        this.logWriteEnd(bookId, primaryFormat || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const payload: BookWritePayload = { ...rawPayload };

      if (libConfig.fileWriteWriteCover && !dryRun) {
        payload.coverBytes = await this.loadCoverBytes(bookId);
      }

      const targetResults: WriteResult[] = [];
      for (const target of targets) {
        const result = await this.writeTarget(bookId, target, payload, libConfig, {
          triggeredBy,
          userId,
          dryRun,
          suppressNotification,
          startedAt,
        });
        targetResults.push(result);
      }

      const result = aggregateWriteResults(targetResults, Date.now() - startedAt);
      if (result.status === 'success') {
        await this.fileWriteRepo.setLastWrittenAt(bookId, new Date());

        if (userId && triggeredBy === 'sync' && !suppressNotification) {
          this.notificationService
            .notify({
              type: NotificationType.FileWriteBackCompleted,
              title: 'File metadata updated',
              message: `Updated ${result.fieldsWritten.length} fields`,
              scope: { kind: 'user', userId },
              meta: { bookId, fieldsWritten: result.fieldsWritten },
            })
            .catch(() => {});
        }
      }
      this.logWriteEnd(bookId, primaryFormat || UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
      return result;
    } finally {
      this.releaseWriteSlot();
    }
  }

  findWriteLog(bookId: number, limit = 20) {
    return this.fileWriteRepo.findWriteLog(bookId, limit);
  }

  private async resolveWriteTargets(bookId: number, primaryFile: FileWriteTarget): Promise<FileWriteTarget[]> {
    const primaryFormat = normalizeFormat(primaryFile.format);
    if (!primaryFormat || !isAudioFormat(primaryFormat)) {
      return [primaryFile];
    }

    const files = await this.fileWriteRepo.findFilesForBook(bookId);
    const audioFiles = files.filter((file) => {
      const format = normalizeFormat(file.format);
      return Boolean(format && isAudioFormat(format));
    });

    return audioFiles.length > 0 ? audioFiles : [primaryFile];
  }

  private async writeTarget(
    bookId: number,
    file: FileWriteTarget,
    payload: BookWritePayload,
    libConfig: LibraryFileWriteConfig,
    options: {
      triggeredBy: 'auto' | 'sync';
      userId: number | undefined;
      dryRun: boolean;
      suppressNotification: boolean;
      startedAt: number;
    },
  ): Promise<WriteResult> {
    const { triggeredBy, userId, dryRun, suppressNotification, startedAt } = options;
    const format = normalizeFormat(file.format);

    const targetSkip = this.resolveTargetSkip(file, libConfig);
    if (targetSkip) {
      await this.insertTargetLogIfSync(bookId, file, targetSkip, triggeredBy, userId);
      return targetSkip;
    }

    const writer = this.registry.get(format)!;

    if (!dryRun && file.fileHash) {
      await this.fileWriteRepo.recordHashHistory(file.id, file.fileHash, 'file_write');
    }

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

      if (userId && triggeredBy === 'sync' && !suppressNotification) {
        this.notificationService
          .notify({
            type: NotificationType.FileWriteBackFailed,
            title: 'File write-back failed',
            message: reason.slice(0, 200),
            scope: { kind: 'user', userId },
            meta: { bookId },
          })
          .catch(() => {});
      }

      return result;
    }

    await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
    if (result.status === 'success') {
      await this.updateTargetHash(bookId, file);
    }

    return result;
  }

  private resolveTargetSkip(file: FileWriteTarget, libConfig: LibraryFileWriteConfig): WriteResult | null {
    const format = normalizeFormat(file.format);

    if (!format || !this.registry.supports(format)) {
      return { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format not supported' };
    }

    const formatSettings = resolveFormatSettings(libConfig, format);
    if (!formatSettings.enabled) {
      return { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format disabled' };
    }

    const sizeBytes = file.sizeBytes ?? 0;
    if (sizeBytes > formatSettings.maxFileSizeBytes) {
      return { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'file exceeds size limit' };
    }

    return null;
  }

  private async insertTargetLogIfSync(
    bookId: number,
    file: FileWriteTarget,
    result: WriteResult,
    triggeredBy: 'auto' | 'sync',
    userId: number | undefined,
  ): Promise<void> {
    if (triggeredBy !== 'sync') {
      return;
    }

    const format = normalizeFormat(file.format) || UNKNOWN_FORMAT;
    await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
  }

  private async updateTargetHash(bookId: number, file: FileWriteTarget): Promise<void> {
    const newHash = await computeFileHash(file.absolutePath).catch((err: unknown) => {
      this.logger.warn(
        `[file_write.hash_update] [fail] bookId=${bookId} bookFileId=${file.id} errorClass=${err instanceof Error ? err.constructor.name : 'Unknown'} error="${sanitizeErrorMessage(err instanceof Error ? err.message : String(err))}" - post-write hash recompute failed`,
      );
      return null;
    });
    if (newHash) {
      await this.fileWriteRepo.updateFileHash(file.id, newHash);
    }
  }

  findNonMissingPrimaryFilesByLibrary(libraryId: number) {
    return this.fileWriteRepo.findNonMissingPrimaryFilesByLibrary(libraryId);
  }

  findLibraryWriteSettingsForBook(bookId: number) {
    return this.fileWriteRepo.findLibraryWriteSettingsForBook(bookId);
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
    const message = `[${FILE_WRITE_EVENT}] [end] bookId=${bookId} format=${format || UNKNOWN_FORMAT} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} dryRun=${dryRun} durationMs=${Date.now() - startedAt} status=${result.status} fieldsWritten=${result.fieldsWritten.length}${reasonPart} - file write completed`;
    if (triggeredBy === 'auto' && result.status === 'skipped') {
      this.logger.debug(message);
      return;
    }
    this.logger.log(message);
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
  fileWriteAudioEnabled: boolean;
  fileWriteAudioMaxFileSizeMb: number;
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
      if (AUDIO_WRITE_FORMATS.includes(format as (typeof AUDIO_WRITE_FORMATS)[number])) {
        return { enabled: config.fileWriteAudioEnabled, maxFileSizeBytes: config.fileWriteAudioMaxFileSizeMb * 1024 * 1024 };
      }
      return { enabled: false, maxFileSizeBytes: 0 };
  }
}

function aggregateWriteResults(results: WriteResult[], durationMs: number): WriteResult {
  if (results.length === 1) {
    return results[0]!;
  }

  const fieldsWritten = [...new Set(results.flatMap((result) => result.fieldsWritten))];
  const failed = results.filter((result) => result.status === 'failed');
  if (failed.length > 0) {
    return {
      status: 'failed',
      fieldsWritten,
      durationMs,
      reason: `${failed.length} of ${results.length} file writes failed`,
    };
  }

  const succeeded = results.filter((result) => result.status === 'success');
  if (succeeded.length > 0) {
    return { status: 'success', fieldsWritten, durationMs };
  }

  const reasons = [...new Set(results.map((result) => result.reason).filter((reason): reason is string => Boolean(reason)))];
  return {
    status: 'skipped',
    fieldsWritten: [],
    durationMs,
    reason: reasons.length > 0 ? reasons.join('; ') : 'all targets skipped',
  };
}

function normalizeFormat(format: string | null | undefined): string {
  return (format ?? '').toLowerCase();
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
  return sanitizeLogValue(message);
}
