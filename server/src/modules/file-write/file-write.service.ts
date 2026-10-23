import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'fs/promises';

import type { BookFileWriteStatus, CoverMedium, WriteResult, WriteResultFileCounts } from '@bookorbit/types';
import { NotificationType } from '@bookorbit/types';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { NotificationService } from '../notification/notification.service';
import { computeFileHash } from '../scanner/lib/hash';
import {
  resolveBookFileWriteStatus,
  writeTargetModeFor,
  type FileWriteCapabilityFile,
  type FileWriteCapabilityLibraryConfig,
} from './file-write-capability';
import { createBookWriteFieldMask } from './file-write.constants';
import { FileLockService, bookOperationLockKey } from './file-lock.service';
import { FileWriteRepository } from './file-write.repository';
import { FormatWriterRegistry } from './format-writer.registry';
import { inspectCoverImage } from './formats/shared/cover-image';
import type { BookWritePayload } from './interfaces/book-write-payload.interface';
import { describeWriteFailure } from './write-failure-reason';
import {
  coverMediumForFormat,
  isWriterSupported,
  needsBookFileList,
  normalizeWriteFormat,
  resolveAudioTrackContexts,
  resolveWriteTargetSkip,
  selectWriteTargets,
  WRITE_TARGET_SKIP_REASON,
  type AudioTrackContext,
  type WriteTargetMode,
  type WriteTargetSkipReason,
  type WriterSupport,
} from './write-target-selector';

const FILE_WRITE_EVENT = 'file_write.write';
const FILE_WRITE_SCHEDULE_EVENT = 'file_write.schedule';
const FILE_WRITE_COVER_EVENT = 'file_write.cover_load';
const FILE_WRITE_SKIP_LOG_EVENT = 'file_write.skip_log';
const UNKNOWN_FORMAT = 'unknown';
const DEFAULT_WRITE_DEBOUNCE_MS = 3_000;
const DEFAULT_MAX_CONCURRENT_WRITES = 2;
const FILE_STATE_REFRESH_ATTEMPTS = 3;
const FILE_STATE_REFRESH_RETRY_MS = 50;

type FileWriteTarget = {
  id: number;
  absolutePath: string;
  format: string | null;
  sizeBytes: number | null;
  fileHash?: string | null;
  libraryId: number;
  role?: string | null;
  sortOrder?: number | null;
  mediaOverlayAvailable?: boolean | null;
};

type PrimaryFileWriteTarget = FileWriteTarget & { fileWriteAllFiles?: boolean | null };

/** A file the run considered, with the result it was skipped with, or null when it is to be written. */
type PlannedTarget = { file: FileWriteTarget; skip: WriteResult | null };

@Injectable()
export class FileWriteService implements OnModuleDestroy {
  private readonly logger = new Logger(FileWriteService.name);
  private readonly debounceMs: number;
  private readonly maxConcurrentWrites: number;
  private readonly debounceMap = new Map<number, NodeJS.Timeout>();
  private readonly scheduledWriteRuns = new Set<Promise<unknown>>();
  private readonly writeQueue: Array<() => void> = [];
  private activeWrites = 0;
  private readonly supports: WriterSupport = (format) => this.registry.supports(format);

  constructor(
    private readonly fileWriteRepo: FileWriteRepository,
    private readonly registry: FormatWriterRegistry,
    private readonly lockService: FileLockService,
    private readonly config: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly selfWriteRegistry: SelfWriteRegistry,
    private readonly coverStore: BookCoverStore,
  ) {
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
    return this.lockService.withLock(bookOperationLockKey(bookId), () =>
      this.writeToFileLocked(bookId, triggeredBy, userId, dryRun, force, suppressNotification),
    );
  }

  private async writeToFileLocked(
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
      const primaryFile: PrimaryFileWriteTarget | null = await this.fileWriteRepo.findPrimaryFileForBook(bookId);
      const primaryFormat = normalizeWriteFormat(primaryFile?.format) || UNKNOWN_FORMAT;
      const scope = await this.resolveWriteScope(bookId, primaryFile);
      if (!scope) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no primary file' };
        this.logWriteEnd(bookId, UNKNOWN_FORMAT, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const files = needsBookFileList(primaryFile, scope.mode) ? await this.fileWriteRepo.findFilesForBook(bookId) : [primaryFile!];
      const { targets, excluded } = selectWriteTargets<FileWriteTarget>({ files, primaryFile, mode: scope.mode, supports: this.supports });
      const exclusions: PlannedTarget[] = excluded.map((file) => ({ file, skip: skipResult(WRITE_TARGET_SKIP_REASON.notContentFile) }));

      if (targets.length === 0) {
        await this.insertSkipLogsIfSync(bookId, exclusions, triggeredBy, userId);
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no primary file' };
        this.logWriteEnd(bookId, primaryFormat, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      if (!targets.some((target) => isWriterSupported(normalizeWriteFormat(target.format), this.supports))) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: WRITE_TARGET_SKIP_REASON.formatNotSupported };
        await this.insertSkipLogsIfSync(bookId, [...targets.map((file) => ({ file, skip: result })), ...exclusions], triggeredBy, userId);
        this.logWriteEnd(bookId, primaryFormat, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const libConfig = await this.fileWriteRepo.findLibraryFileWriteConfig(scope.libraryId);
      if (!libConfig) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'library not found' };
        this.logWriteEnd(bookId, primaryFormat, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      if (!libConfig.fileWriteEnabled && !dryRun && !force) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'disabled' };
        this.logWriteEnd(bookId, primaryFormat, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const sizedTargets = await this.withSizesOnDisk(targets);
      const plan: PlannedTarget[] = [
        ...sizedTargets.map((file) => ({ file, skip: skipResultOrNull(resolveWriteTargetSkip(file, libConfig, this.supports)) })),
        ...exclusions,
      ];
      const skipped = plan.filter((entry) => entry.skip !== null);
      const writable = plan.filter((entry) => entry.skip === null).map((entry) => entry.file);

      if (writable.length === 0) {
        await this.insertSkipLogsIfSync(bookId, skipped, triggeredBy, userId);
        const result = aggregateWriteResults(
          skipped.map((entry) => entry.skip!),
          Date.now() - startedAt,
        );
        this.logWriteEnd(bookId, primaryFormat, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const rawPayload = await this.fileWriteRepo.loadPayload(bookId);
      if (!rawPayload) {
        const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no metadata' };
        this.logWriteEnd(bookId, primaryFormat, triggeredBy, userId, dryRun, startedAt, result);
        return result;
      }

      const payloadForFile = await this.buildPayloadResolver(bookId, { ...rawPayload }, writable, libConfig.fileWriteWriteCover && !dryRun);
      const audioTrackContexts = resolveAudioTrackContexts(sizedTargets, primaryFile);

      await this.insertSkipLogsIfSync(bookId, skipped, triggeredBy, userId);
      const targetResults: WriteResult[] = skipped.map((entry) => entry.skip!);
      const suppressPaths = dryRun ? [] : sizedTargets.map((target) => target.absolutePath);
      this.selfWriteRegistry.begin(suppressPaths);
      try {
        for (const target of writable) {
          const result = await this.writeTarget(
            bookId,
            target,
            payloadForFile(target),
            {
              triggeredBy,
              userId,
              dryRun,
              suppressNotification,
              startedAt,
            },
            audioTrackContexts.get(target.id),
          );
          targetResults.push(result);
        }
      } finally {
        this.selfWriteRegistry.end(suppressPaths);
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
      this.logWriteEnd(bookId, primaryFormat, triggeredBy, userId, dryRun, startedAt, result);
      return result;
    } finally {
      this.releaseWriteSlot();
    }
  }

  findWriteLog(bookId: number, limit = 20) {
    return this.fileWriteRepo.findWriteLog(bookId, limit);
  }

  resolveBookFileWriteStatus(
    libraryConfig: FileWriteCapabilityLibraryConfig,
    files: readonly FileWriteCapabilityFile[],
    primaryFileId: number | null,
  ): BookFileWriteStatus {
    return resolveBookFileWriteStatus(libraryConfig, files, primaryFileId, this.supports);
  }

  /**
   * The library a write runs against and which selection mode it uses. A book without a primary
   * file has nothing to write in `primary` mode; only the all-files mode can still reach its files.
   */
  private async resolveWriteScope(
    bookId: number,
    primaryFile: PrimaryFileWriteTarget | null,
  ): Promise<{ libraryId: number; mode: WriteTargetMode } | null> {
    if (primaryFile) return { libraryId: primaryFile.libraryId, mode: writeTargetModeFor(primaryFile) };

    const scope = await this.fileWriteRepo.findFileWriteScopeForBook(bookId);
    if (!scope || writeTargetModeFor(scope) !== 'all_files') return null;
    return { libraryId: scope.libraryId, mode: 'all_files' };
  }

  /**
   * The size limit applies to what is on disk now. The stored size is unknown for some rows and lags
   * any change made outside BookOrbit, so it is only the fallback for a file that cannot be read.
   */
  private async withSizesOnDisk(targets: readonly FileWriteTarget[]): Promise<FileWriteTarget[]> {
    const sized: FileWriteTarget[] = [];
    for (const target of targets) {
      const sizeBytes = await stat(target.absolutePath, { bigint: true }).then(
        (stats) => Number(stats.size),
        () => target.sizeBytes,
      );
      sized.push(sizeBytes === target.sizeBytes ? target : { ...target, sizeBytes });
    }
    return sized;
  }

  /**
   * Each file gets the artwork of its own medium. Every medium is resolved once per run, and the
   * payload for it is built once, so a long track list shares one snapshot instead of re-reading it.
   */
  private async buildPayloadResolver(
    bookId: number,
    payload: BookWritePayload,
    writable: readonly FileWriteTarget[],
    writeCover: boolean,
  ): Promise<(file: FileWriteTarget) => BookWritePayload> {
    if (!writeCover) return () => payload;

    const payloadByMedium = new Map<CoverMedium, BookWritePayload>();
    for (const medium of new Set(writable.map((file) => coverMediumForFormat(file.format)))) {
      payloadByMedium.set(medium, { ...payload, coverBytes: await this.loadCoverBytes(bookId, medium) });
    }
    return (file) => payloadByMedium.get(coverMediumForFormat(file.format)) ?? { ...payload, coverBytes: null };
  }

  private async writeTarget(
    bookId: number,
    file: FileWriteTarget,
    payload: BookWritePayload,
    options: {
      triggeredBy: 'auto' | 'sync';
      userId: number | undefined;
      dryRun: boolean;
      suppressNotification: boolean;
      startedAt: number;
    },
    audioTrackContext?: AudioTrackContext,
  ): Promise<WriteResult> {
    const { triggeredBy, userId, dryRun, suppressNotification, startedAt } = options;
    const format = normalizeWriteFormat(file.format);
    const writer = this.registry.get(format)!;

    if (!dryRun && file.fileHash) {
      await this.fileWriteRepo.recordHashHistory(file.id, file.fileHash, 'file_write');
    }

    let result: WriteResult;
    try {
      result = await this.lockService.withLock(file.absolutePath, () =>
        writer.write(file.absolutePath, payload, { fieldMask: createBookWriteFieldMask(), dryRun, ...audioTrackContext }),
      );
    } catch (error) {
      const reason = describeWriteFailure(error, file.absolutePath);
      result = { status: 'failed', fieldsWritten: [], durationMs: 0, reason };
      this.logWriteFail(bookId, format, triggeredBy, userId, dryRun, startedAt, error, reason);
      await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });
      this.notifyTargetWriteFailure(bookId, reason, triggeredBy, userId, suppressNotification);
      return result;
    }

    if (result.status === 'failed' && result.reason) {
      result = { ...result, reason: describeWriteFailure(result.reason, file.absolutePath) };
    }

    if (result.status === 'success') {
      const stateRefreshed = await this.updateTargetFileState(bookId, file);
      if (!stateRefreshed) {
        const reason = 'post-write file state refresh failed';
        result = {
          status: 'failed',
          fieldsWritten: result.fieldsWritten,
          durationMs: Date.now() - startedAt,
          reason,
        };
        this.notifyTargetWriteFailure(bookId, reason, triggeredBy, userId, suppressNotification);
      }
    }
    await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result, triggeredBy });

    return result;
  }

  private notifyTargetWriteFailure(
    bookId: number,
    reason: string,
    triggeredBy: 'auto' | 'sync',
    userId: number | undefined,
    suppressNotification: boolean,
  ): void {
    if (!userId || triggeredBy !== 'sync' || suppressNotification) return;
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

  private async insertSkipLogsIfSync(
    bookId: number,
    entries: readonly PlannedTarget[],
    triggeredBy: 'auto' | 'sync',
    userId: number | undefined,
  ): Promise<void> {
    if (triggeredBy !== 'sync' || entries.length === 0) return;

    const startedAt = Date.now();
    let failed = 0;
    let lastError: unknown;
    // One insert at a time: a concurrent insert per skipped file would grow with the file count.
    // A failed insert is counted rather than abandoning the rest, since the skip itself stands.
    for (const { file, skip } of entries) {
      const format = normalizeWriteFormat(file.format) || UNKNOWN_FORMAT;
      try {
        await this.fileWriteRepo.insertLog({ bookId, bookFileId: file.id, userId: userId ?? null, format, result: skip!, triggeredBy });
      } catch (error) {
        failed++;
        lastError = error;
      }
    }

    if (failed > 0) {
      const errorClass = lastError instanceof Error ? lastError.name : 'Error';
      const errorMessage = sanitizeErrorMessage(lastError instanceof Error ? lastError.message : String(lastError));
      this.logger.warn(
        `[${FILE_WRITE_SKIP_LOG_EVENT}] [fail] bookId=${bookId} attempted=${entries.length} inserted=${entries.length - failed} failed=${failed} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - skip log inserts failed`,
      );
    }
  }

  private async updateTargetFileState(bookId: number, file: FileWriteTarget): Promise<boolean> {
    const newHash = await computeFileHash(file.absolutePath).catch((err: unknown) => {
      this.logger.warn(
        `[file_write.hash_update] [fail] bookId=${bookId} bookFileId=${file.id} errorClass=${err instanceof Error ? err.constructor.name : 'Unknown'} error="${sanitizeErrorMessage(err instanceof Error ? err.message : String(err))}" - post-write hash recompute failed`,
      );
      return null;
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= FILE_STATE_REFRESH_ATTEMPTS; attempt++) {
      try {
        const stats = await stat(file.absolutePath, { bigint: true });
        await this.fileWriteRepo.updateFileStateAfterMetadataWrite(bookId, file.id, file.fileHash ?? null, {
          ...(newHash ? { fileHash: newHash } : {}),
          mtime: stats.mtime,
          sizeBytes: Number(stats.size),
          ino: stats.ino,
        });
        return true;
      } catch (err) {
        lastError = err;
        if (attempt < FILE_STATE_REFRESH_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, FILE_STATE_REFRESH_RETRY_MS));
        }
      }
    }

    this.logger.warn(
      `[file_write.stat_update] [fail] bookId=${bookId} bookFileId=${file.id} attemptCount=${FILE_STATE_REFRESH_ATTEMPTS} errorClass=${lastError instanceof Error ? lastError.constructor.name : 'Unknown'} error="${sanitizeErrorMessage(lastError instanceof Error ? lastError.message : String(lastError))}" - post-write stat refresh failed`,
    );
    return false;
  }

  findNonMissingPrimaryFilesByLibrary(libraryId: number) {
    return this.fileWriteRepo.findNonMissingPrimaryFilesByLibrary(libraryId);
  }

  findLibraryWriteSettingsForBook(bookId: number) {
    return this.fileWriteRepo.findLibraryWriteSettingsForBook(bookId);
  }

  /**
   * Only the target medium's own slot is ever embedded, never the other medium as a fallback. A
   * square audiobook cover baked into an EPUB would come back as the ebook cover on the next scan.
   * A missing, empty, unreadable, or undecodable slot yields null, which leaves the file's own
   * artwork in place and still writes its metadata. Decoding once here keeps one bad cover from
   * failing every file of the book.
   */
  private async loadCoverBytes(bookId: number, medium: CoverMedium): Promise<Buffer | null> {
    const startedAt = Date.now();
    try {
      const path = await this.coverStore.resolve(bookId, { medium, variant: 'cover', strict: true });
      if (!path) return null;
      const bytes = await readFile(path);
      if (bytes.length === 0) return null;
      await inspectCoverImage(bytes);
      return bytes;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${FILE_WRITE_COVER_EVENT}] [fail] bookId=${bookId} medium=${medium} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover unusable, writing metadata only`,
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
    const counts = result.fileCounts;
    const countsPart = counts
      ? ` files=${counts.processed} succeededFiles=${counts.succeeded} failedFiles=${counts.failed} skippedFiles=${counts.skipped}`
      : '';
    const message = `[${FILE_WRITE_EVENT}] [end] bookId=${bookId} format=${format || UNKNOWN_FORMAT} triggeredBy=${triggeredBy} userId=${formatUserId(userId)} dryRun=${dryRun} durationMs=${Date.now() - startedAt} status=${result.status} fieldsWritten=${result.fieldsWritten.length}${countsPart}${reasonPart} - file write completed`;
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
    reason: string,
  ): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const errorMessage = sanitizeErrorMessage(reason);
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

function skipResult(reason: WriteTargetSkipReason): WriteResult {
  return { status: 'skipped', fieldsWritten: [], durationMs: 0, reason };
}

function skipResultOrNull(reason: WriteTargetSkipReason | null): WriteResult | null {
  return reason === null ? null : skipResult(reason);
}

/**
 * A single target's result is returned intact. Several are combined: any failure fails the book,
 * otherwise any success succeeds it, and the per-file counts beside `status` say how it got there.
 * Fields are kept even when every target skipped, because a dry run reports each target as skipped
 * with the fields it would write.
 */
function aggregateWriteResults(results: WriteResult[], durationMs: number): WriteResult {
  if (results.length === 1) {
    return results[0]!;
  }

  const fieldsWritten = [...new Set(results.flatMap((result) => result.fieldsWritten))];
  const fileCounts = countFileOutcomes(results);
  if (fileCounts.failed > 0) {
    return {
      status: 'failed',
      fieldsWritten,
      durationMs,
      reason: `${fileCounts.failed} of ${results.length} file writes failed`,
      fileCounts,
    };
  }

  if (fileCounts.succeeded > 0) {
    return { status: 'success', fieldsWritten, durationMs, fileCounts };
  }

  const reasons = [...new Set(results.map((result) => result.reason).filter((reason): reason is string => Boolean(reason)))];
  return {
    status: 'skipped',
    fieldsWritten,
    durationMs,
    reason: reasons.length > 0 ? reasons.join('; ') : 'all targets skipped',
    fileCounts,
  };
}

function countFileOutcomes(results: readonly WriteResult[]): WriteResultFileCounts {
  const counts: WriteResultFileCounts = { processed: results.length, succeeded: 0, failed: 0, skipped: 0 };
  for (const result of results) {
    if (result.status === 'success') counts.succeeded++;
    else if (result.status === 'failed') counts.failed++;
    else counts.skipped++;
  }
  return counts;
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
