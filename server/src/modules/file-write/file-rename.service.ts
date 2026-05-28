import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, mkdir, readdir, rename as fsRename, rmdir } from 'fs/promises';
import { basename, dirname, extname, join, relative } from 'path';

import type { FileRenameResult } from '@bookorbit/types';
import { NotificationType, resolveUploadPath } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { NotificationService } from '../notification/notification.service';
import type { BookFilePathUpdate, BookRenameData } from './file-rename.repository';
import { FileRenameRepository } from './file-rename.repository';
import { FileLockService } from './file-lock.service';
import { buildTokens } from './file-rename.utils';

const FILE_RENAME_EVENT = 'file.rename';
const FILE_RENAME_ROLLBACK_EVENT = 'file.rename_rollback';
const DEFAULT_RENAME_DEBOUNCE_MS = 3_000;

export const RENAME_RELEVANT_FIELDS = new Set(['title', 'authors', 'seriesName', 'seriesIndex', 'publishedYear'] as const);

@Injectable()
export class FileRenameService implements OnModuleDestroy {
  private readonly logger = new Logger(FileRenameService.name);
  private readonly debounceMs: number;
  private readonly debounceMap = new Map<number, NodeJS.Timeout>();
  private readonly scheduledRenameRuns = new Set<Promise<unknown>>();

  constructor(
    private readonly renameRepo: FileRenameRepository,
    private readonly lockService: FileLockService,
    private readonly appSettings: AppSettingsService,
    private readonly notificationService: NotificationService,
    private readonly config: ConfigService,
  ) {
    this.debounceMs = resolvePositiveInteger(this.config.get('fileWrite.debounceMs'), DEFAULT_RENAME_DEBOUNCE_MS);
  }

  scheduleRename(bookId: number, userId: number): void {
    const existing = this.debounceMap.get(bookId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceMap.delete(bookId);
      const run = this.performRename(bookId, userId)
        .catch((err: Error) =>
          this.logger.warn(
            `[${FILE_RENAME_EVENT}] [fail] bookId=${bookId} userId=${userId} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - scheduled rename failed`,
          ),
        )
        .finally(() => {
          this.scheduledRenameRuns.delete(run);
        });
      this.scheduledRenameRuns.add(run);
    }, this.debounceMs);

    this.debounceMap.set(bookId, timer);
  }

  onModuleDestroy(): void {
    for (const timer of this.debounceMap.values()) clearTimeout(timer);
    this.debounceMap.clear();
  }

  async drainScheduledRenamesForTests(): Promise<void> {
    while (this.scheduledRenameRuns.size > 0) {
      await Promise.allSettled([...this.scheduledRenameRuns]);
    }
  }

  async performRename(bookId: number, userId: number): Promise<FileRenameResult> {
    const startedAt = Date.now();
    this.logger.log(`[${FILE_RENAME_EVENT}] [start] bookId=${bookId} userId=${userId} - file rename started`);

    const data = await this.renameRepo.findBookRenameData(bookId);
    if (!data) {
      return this.logAndReturn(bookId, startedAt, { status: 'skipped', reason: 'book not found' });
    }

    if (!data.fileRenameEnabled) {
      return this.logAndReturn(bookId, startedAt, { status: 'skipped', reason: 'disabled' });
    }

    const pattern =
      data.fileNamingPattern ??
      (data.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());

    if (!pattern) {
      return this.logAndReturn(bookId, startedAt, { status: 'skipped', reason: 'no pattern' });
    }

    const format = (data.file.format ?? extname(data.file.absolutePath).slice(1)).toLowerCase();
    const originalStem = basename(data.file.absolutePath, extname(data.file.absolutePath));
    const tokens = buildTokens(data.metadata, data.authors, originalStem, format);
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const resolvedRelPath = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });

    if (!resolvedRelPath) {
      return this.logAndReturn(bookId, startedAt, { status: 'skipped', reason: 'pattern resolved to empty' });
    }

    const currentAbsolutePath = data.file.absolutePath;
    const newAbsolutePath = join(data.libraryFolderPath, resolvedRelPath);
    const currentFolderPath = data.bookFolderPath;
    const newFolderPath = dirname(newAbsolutePath);
    const isBookPerFolder = data.organizationMode === 'book_per_folder';

    if (newAbsolutePath === currentAbsolutePath) {
      return this.logAndReturn(bookId, startedAt, { status: 'skipped', reason: 'path unchanged' });
    }

    const pathTaken = await this.renameRepo.checkPathTakenByOtherBook(newAbsolutePath, bookId);
    if (pathTaken) {
      this.logger.warn(
        `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} status=skipped reason="collision" newPath="${sanitizeLogValue(newAbsolutePath)}" - rename skipped: path already taken`,
      );
      await this.notifyFailure(userId, bookId, 'File rename skipped: target path already taken by another book.');
      return { status: 'skipped', reason: 'collision', oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
    }

    const bookHasOwnFolder = isBookPerFolder && currentFolderPath !== currentAbsolutePath;
    const nestedFolderMove = bookHasOwnFolder && newFolderPath !== currentFolderPath && this.foldersAreNested(currentFolderPath, newFolderPath);
    const renamingFolder = bookHasOwnFolder && newFolderPath !== currentFolderPath && !nestedFolderMove;
    const filesystemTargetPath = renamingFolder ? newFolderPath : newAbsolutePath;
    if (await this.pathExists(filesystemTargetPath)) {
      const reason = renamingFolder ? 'target folder already exists on disk' : 'target path already exists on disk';
      this.logger.warn(
        `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} status=skipped reason="${sanitizeLogValue(reason)}" newPath="${sanitizeLogValue(newAbsolutePath)}" - rename skipped: target already exists on disk`,
      );
      await this.notifyFailure(userId, bookId, `File rename skipped: ${reason}.`);
      return { status: 'skipped', reason, oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
    }

    try {
      if (bookHasOwnFolder && newFolderPath !== currentFolderPath) {
        await this.renameBookWithFolder(bookId, data, currentFolderPath, newFolderPath, newAbsolutePath);
      } else if (isBookPerFolder && newFolderPath !== currentFolderPath) {
        await this.renameFlatBookToFolder(bookId, data, newFolderPath, newAbsolutePath);
      } else {
        const nextBookFolderPath = isBookPerFolder ? newFolderPath : newAbsolutePath;
        await this.renameBookFileOnly(bookId, data, currentAbsolutePath, newAbsolutePath, nextBookFolderPath);
      }
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${FILE_RENAME_EVENT}] [fail] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - file rename failed`,
      );
      await this.notifyFailure(userId, bookId, err instanceof Error ? err.message : String(err));
      return { status: 'failed', reason: errorMessage, oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
    }

    this.logger.log(
      `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} status=success oldPath="${sanitizeLogValue(currentAbsolutePath)}" newPath="${sanitizeLogValue(newAbsolutePath)}" - file rename completed`,
    );

    await this.notifySuccess(userId, bookId, currentAbsolutePath, newAbsolutePath);
    return { status: 'success', oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
  }

  private async renameBookFileOnly(
    bookId: number,
    data: BookRenameData,
    oldPath: string,
    newPath: string,
    nextBookFolderPath: string,
  ): Promise<void> {
    const oldDir = dirname(oldPath);
    const newDir = dirname(newPath);
    const oldRelPath = data.file.relPath;
    const newRelPath = relative(data.libraryFolderPath, newPath);

    await this.renameRepo.applyFileRename(bookId, data.file.id, newPath, newRelPath, nextBookFolderPath);

    try {
      await mkdir(newDir, { recursive: true });
      await this.lockService.withLock(oldPath, () => fsRename(oldPath, newPath));
    } catch (error) {
      await this.rollbackFileRename(bookId, data.file.id, oldPath, oldRelPath, data.bookFolderPath, error);
      throw error;
    }

    if (oldDir !== newDir) {
      await this.tryRemoveEmptyDir(oldDir);
    }
  }

  private async renameFlatBookToFolder(bookId: number, data: BookRenameData, newFolderPath: string, newPrimaryAbsolutePath: string): Promise<void> {
    const allFiles = await this.renameRepo.findAllBookFiles(bookId);
    const targetFor = (file: { id: number; absolutePath: string }): string =>
      file.id === data.file.id ? newPrimaryAbsolutePath : join(newFolderPath, basename(file.absolutePath));

    const newUpdates: BookFilePathUpdate[] = allFiles.map((file) => {
      const absolutePath = targetFor(file);
      return { id: file.id, absolutePath, relPath: relative(data.libraryFolderPath, absolutePath) };
    });
    const oldUpdates: BookFilePathUpdate[] = allFiles.map((file) => ({
      id: file.id,
      absolutePath: file.absolutePath,
      relPath: file.relPath,
    }));

    await this.renameRepo.applyFolderRename(bookId, newUpdates, newFolderPath);

    const moved: Array<{ from: string; to: string }> = [];
    try {
      await mkdir(newFolderPath, { recursive: true });
      for (const file of allFiles) {
        const newAbsolutePath = targetFor(file);
        await this.lockService.withLock(file.absolutePath, () => fsRename(file.absolutePath, newAbsolutePath));
        moved.push({ from: file.absolutePath, to: newAbsolutePath });
      }
    } catch (error) {
      for (const { from, to } of [...moved].reverse()) {
        try {
          await fsRename(to, from);
        } catch (rollbackError) {
          this.logRollbackFailure(bookId, error, rollbackError);
        }
      }
      await this.rollbackFolderRename(bookId, oldUpdates, data.bookFolderPath, error);
      throw error;
    }
  }

  private async renameBookWithFolder(
    bookId: number,
    data: BookRenameData,
    oldFolderPath: string,
    newFolderPath: string,
    newPrimaryAbsolutePath: string,
  ): Promise<void> {
    const allFiles = await this.renameRepo.findAllBookFiles(bookId);
    const newUpdates = allFiles.map((file) => {
      const relToOldFolder = relative(oldFolderPath, file.absolutePath);
      const absolutePath = file.id === data.file.id ? newPrimaryAbsolutePath : join(newFolderPath, relToOldFolder);
      return {
        id: file.id,
        absolutePath,
        relPath: relative(data.libraryFolderPath, absolutePath),
      } satisfies BookFilePathUpdate;
    });
    const oldUpdates = allFiles.map((file) => ({ id: file.id, absolutePath: file.absolutePath, relPath: file.relPath }) satisfies BookFilePathUpdate);

    await this.renameRepo.applyFolderRename(bookId, newUpdates, newFolderPath);

    if (this.foldersAreNested(oldFolderPath, newFolderPath)) {
      await this.moveBookFilesIndividually(bookId, allFiles, data, oldFolderPath, newFolderPath, newPrimaryAbsolutePath, oldUpdates);
    } else {
      const movedPrimaryAbsolutePath = join(newFolderPath, relative(oldFolderPath, data.file.absolutePath));
      let folderRenamed = false;
      try {
        await mkdir(dirname(newFolderPath), { recursive: true });
        await this.lockService.withLock(oldFolderPath, () => fsRename(oldFolderPath, newFolderPath));
        folderRenamed = true;
        if (movedPrimaryAbsolutePath !== newPrimaryAbsolutePath) {
          await this.lockService.withLock(movedPrimaryAbsolutePath, () => fsRename(movedPrimaryAbsolutePath, newPrimaryAbsolutePath));
        }
      } catch (error) {
        await this.rollbackFolderRename(bookId, oldUpdates, oldFolderPath, error);
        if (folderRenamed) {
          await this.rollbackFolderMove(bookId, newFolderPath, oldFolderPath, error);
        }
        throw error;
      }
    }

    await this.tryRemoveEmptyDir(oldFolderPath);
    await this.tryRemoveEmptyDir(dirname(oldFolderPath));
  }

  private async moveBookFilesIndividually(
    bookId: number,
    allFiles: Awaited<ReturnType<FileRenameRepository['findAllBookFiles']>>,
    data: BookRenameData,
    oldFolderPath: string,
    newFolderPath: string,
    newPrimaryAbsolutePath: string,
    oldUpdates: BookFilePathUpdate[],
  ): Promise<void> {
    const movedFiles: Array<{ from: string; to: string }> = [];

    try {
      await mkdir(newFolderPath, { recursive: true });

      for (const file of allFiles) {
        const relToOldFolder = relative(oldFolderPath, file.absolutePath);
        const newFilePath = file.id === data.file.id ? newPrimaryAbsolutePath : join(newFolderPath, relToOldFolder);
        const newFileDir = dirname(newFilePath);

        if (newFileDir !== newFolderPath) {
          await mkdir(newFileDir, { recursive: true });
        }

        await this.lockService.withLock(file.absolutePath, () => fsRename(file.absolutePath, newFilePath));
        movedFiles.push({ from: file.absolutePath, to: newFilePath });
      }
    } catch (error) {
      for (const { from, to } of [...movedFiles].reverse()) {
        try {
          await mkdir(dirname(from), { recursive: true });
          await fsRename(to, from);
        } catch (rollbackError) {
          this.logRollbackFailure(bookId, error, rollbackError);
        }
      }
      await this.rollbackFolderRename(bookId, oldUpdates, oldFolderPath, error);
      throw error;
    }
  }

  private foldersAreNested(pathA: string, pathB: string): boolean {
    const normA = (pathA.endsWith('/') ? pathA : pathA + '/').toLowerCase();
    const normB = (pathB.endsWith('/') ? pathB : pathB + '/').toLowerCase();
    return normB.startsWith(normA) || normA.startsWith(normB);
  }

  private async rollbackFileRename(
    bookId: number,
    fileId: number,
    oldPath: string,
    oldRelPath: string | null,
    oldBookFolderPath: string,
    originalError: unknown,
  ): Promise<void> {
    try {
      await this.renameRepo.applyFileRename(bookId, fileId, oldPath, oldRelPath, oldBookFolderPath);
    } catch (rollbackError) {
      this.logRollbackFailure(bookId, originalError, rollbackError);
    }
  }

  private async rollbackFolderRename(bookId: number, oldUpdates: BookFilePathUpdate[], oldFolderPath: string, originalError: unknown): Promise<void> {
    try {
      await this.renameRepo.applyFolderRename(bookId, oldUpdates, oldFolderPath);
    } catch (rollbackError) {
      this.logRollbackFailure(bookId, originalError, rollbackError);
    }
  }

  private async rollbackFolderMove(bookId: number, newFolderPath: string, oldFolderPath: string, originalError: unknown): Promise<void> {
    try {
      await fsRename(newFolderPath, oldFolderPath);
    } catch (rollbackError) {
      this.logRollbackFailure(bookId, originalError, rollbackError);
    }
  }

  private logRollbackFailure(bookId: number, originalError: unknown, rollbackError: unknown): void {
    const originalErrorClass = originalError instanceof Error ? originalError.name : 'Error';
    const originalErrorMessage = sanitizeLogValue(originalError instanceof Error ? originalError.message : String(originalError));
    const rollbackErrorClass = rollbackError instanceof Error ? rollbackError.name : 'Error';
    const rollbackErrorMessage = sanitizeLogValue(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    this.logger.warn(
      `[${FILE_RENAME_ROLLBACK_EVENT}] [fail] bookId=${bookId} originalErrorClass=${originalErrorClass} originalError="${originalErrorMessage}" rollbackErrorClass=${rollbackErrorClass} rollbackError="${rollbackErrorMessage}" - file rename rollback failed`,
    );
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async tryRemoveEmptyDir(dirPath: string): Promise<void> {
    try {
      const entries = await readdir(dirPath);
      if (entries.length === 0) {
        await rmdir(dirPath);
      }
    } catch {
      // Best effort.
    }
  }

  private logAndReturn(bookId: number, startedAt: number, result: Omit<FileRenameResult, 'durationMs'>): FileRenameResult {
    const durationMs = Date.now() - startedAt;
    const full: FileRenameResult = { ...result, durationMs };
    const reasonPart = full.reason ? ` reason="${sanitizeLogValue(full.reason)}"` : '';
    this.logger.debug(
      `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} durationMs=${durationMs} status=${full.status}${reasonPart} - file rename completed`,
    );
    return full;
  }

  private async notifySuccess(userId: number, bookId: number, oldPath: string, newPath: string): Promise<void> {
    await this.notificationService
      .notify({
        type: NotificationType.FileRenameCompleted,
        title: 'File renamed',
        message: `Renamed to: ${basename(newPath)}`,
        scope: { kind: 'user', userId },
        meta: { bookId, oldPath, newPath },
      })
      .catch(() => {});
  }

  private async notifyFailure(userId: number, bookId: number, reason: string): Promise<void> {
    await this.notificationService
      .notify({
        type: NotificationType.FileRenameFailed,
        title: 'File rename failed',
        message: reason.slice(0, 200),
        scope: { kind: 'user', userId },
        meta: { bookId },
      })
      .catch(() => {});
  }
}

function resolvePositiveInteger(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.floor(numeric);
}
