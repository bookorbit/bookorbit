import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, mkdir, readdir, rename as fsRename, rmdir } from 'fs/promises';
import { basename, dirname, extname, join, relative } from 'path';

import type { FileRenameResult } from '@bookorbit/types';
import { isAudioFormat, NotificationType, resolveUploadPath } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { NotificationService } from '../notification/notification.service';
import type { BookFilePathUpdate, BookRenameData } from './file-rename.repository';
import { FileRenameRepository } from './file-rename.repository';
import { FileLockService, bookOperationLockKey } from './file-lock.service';
import { buildTokens } from './file-rename.utils';

const FILE_RENAME_EVENT = 'file.rename';
const FILE_RENAME_ROLLBACK_EVENT = 'file.rename_rollback';
const DEFAULT_RENAME_DEBOUNCE_MS = 3_000;

export const RENAME_RELEVANT_FIELDS = new Set(['title', 'authors', 'seriesName', 'seriesIndex', 'publishedYear'] as const);

type RenameBookFile = Awaited<ReturnType<FileRenameRepository['findAllBookFiles']>>[number];

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

  cancelPendingRename(bookId: number): void {
    const existing = this.debounceMap.get(bookId);
    if (existing) {
      clearTimeout(existing);
      this.debounceMap.delete(bookId);
    }
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

  async performRename(bookId: number, userId: number, force = false, suppressNotification = false): Promise<FileRenameResult> {
    return this.lockService.withLock(bookOperationLockKey(bookId), () => this.performRenameLocked(bookId, userId, force, suppressNotification));
  }

  private async performRenameLocked(bookId: number, userId: number, force = false, suppressNotification = false): Promise<FileRenameResult> {
    const startedAt = Date.now();
    this.logger.log(`[${FILE_RENAME_EVENT}] [start] bookId=${bookId} userId=${userId} force=${force} - file rename started`);

    const data = await this.renameRepo.findBookRenameData(bookId);
    if (!data) {
      return this.logAndReturn(bookId, startedAt, { status: 'skipped', reason: 'book not found' });
    }

    if (!data.fileRenameEnabled && !force) {
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
    const baseNewAbsolutePath = join(data.libraryFolderPath, resolvedRelPath);
    const currentFolderPath = data.bookFolderPath;
    const baseNewFolderPath = dirname(baseNewAbsolutePath);
    const isBookPerFolder = data.organizationMode === 'book_per_folder';

    const allFiles = await this.renameRepo.findAllBookFiles(bookId);
    const fileTargets = new Map<number, string>();
    const bookHasOwnFolder = isBookPerFolder && currentFolderPath !== currentAbsolutePath;

    for (const file of allFiles) {
      if (file.id === data.file.id) {
        fileTargets.set(file.id, baseNewAbsolutePath);
      } else if (file.role === 'content') {
        const fileExt = extname(file.absolutePath);
        const fileFormat = (file.format ?? fileExt.slice(1)).toLowerCase();
        const fileOriginalStem = basename(file.absolutePath, fileExt);
        const fileTokens = buildTokens(data.metadata, data.authors, fileOriginalStem, fileFormat);
        const fileResolvedRelPath = resolveUploadPath(pattern, fileTokens, fileFormat, { sanitizeForCrossPlatform });

        let targetAbs: string;
        if (fileResolvedRelPath) {
          const resolvedAbs = join(data.libraryFolderPath, fileResolvedRelPath);
          if (isBookPerFolder) {
            const relToOldFolder = bookHasOwnFolder ? relative(currentFolderPath, file.absolutePath) : basename(file.absolutePath);
            const oldSubDir = dirname(relToOldFolder);
            targetAbs = join(baseNewFolderPath, oldSubDir, basename(resolvedAbs));
          } else {
            targetAbs = resolvedAbs;
          }
        } else {
          const relToOldFolder = bookHasOwnFolder ? relative(currentFolderPath, file.absolutePath) : basename(file.absolutePath);
          targetAbs = join(isBookPerFolder ? baseNewFolderPath : dirname(baseNewAbsolutePath), relToOldFolder);
        }

        fileTargets.set(file.id, targetAbs);
      } else {
        const relToOldFolder = bookHasOwnFolder ? relative(currentFolderPath, file.absolutePath) : basename(file.absolutePath);
        const targetAbs = join(isBookPerFolder ? baseNewFolderPath : dirname(baseNewAbsolutePath), relToOldFolder);

        fileTargets.set(file.id, targetAbs);
      }
    }

    this.applyMultiTrackAudioPartSuffixes(fileTargets, allFiles, data.file.id);

    if (this.hasInternalCollision(fileTargets)) {
      fileTargets.clear();
      fileTargets.set(data.file.id, baseNewAbsolutePath);
      for (const file of allFiles) {
        if (file.id !== data.file.id) {
          const relToOldFolder = bookHasOwnFolder ? relative(currentFolderPath, file.absolutePath) : basename(file.absolutePath);
          const targetDir = isBookPerFolder ? baseNewFolderPath : dirname(baseNewAbsolutePath);
          fileTargets.set(file.id, join(targetDir, relToOldFolder));
        }
      }
    }

    const newAbsolutePath = fileTargets.get(data.file.id) ?? baseNewAbsolutePath;
    const newFolderPath = dirname(newAbsolutePath);

    let pathUnchanged = newAbsolutePath === currentAbsolutePath;
    if (pathUnchanged) {
      for (const file of allFiles) {
        if (fileTargets.get(file.id) && fileTargets.get(file.id) !== file.absolutePath) {
          pathUnchanged = false;
          break;
        }
      }
    } else {
      pathUnchanged = false;
    }

    if (pathUnchanged) {
      return this.logAndReturn(bookId, startedAt, { status: 'skipped', reason: 'path unchanged' });
    }

    const nestedFolderMove = bookHasOwnFolder && newFolderPath !== currentFolderPath && this.foldersAreNested(currentFolderPath, newFolderPath);
    const renamingFolder = bookHasOwnFolder && newFolderPath !== currentFolderPath && !nestedFolderMove;
    let moveIntoExistingFolder = false;
    let mergeTargetBookId: number | null = null;

    if (renamingFolder) {
      if (await this.pathExists(newFolderPath)) {
        moveIntoExistingFolder = true;
        const targetBook = await this.renameRepo.findBookByExactFolderPath(data.libraryId, newFolderPath);
        if (targetBook && targetBook.id !== bookId) mergeTargetBookId = targetBook.id;

        const existingTargetPath = await this.findExistingTargetFilePath(allFiles, fileTargets);
        if (existingTargetPath) {
          const reason = 'target path already exists on disk';
          this.logger.warn(
            `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} status=skipped reason="${sanitizeLogValue(reason)}" newPath="${sanitizeLogValue(existingTargetPath)}" - rename skipped: target already exists on disk`,
          );
          await this.notifyFailure(userId, bookId, `File rename skipped: ${reason}.`, suppressNotification);
          return { status: 'skipped', reason, oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
        }
      }
    } else {
      const existingTargetPath = await this.findExistingTargetFilePath(allFiles, fileTargets);
      if (existingTargetPath) {
        const reason = 'target path already exists on disk';
        this.logger.warn(
          `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} status=skipped reason="${sanitizeLogValue(reason)}" newPath="${sanitizeLogValue(newAbsolutePath)}" - rename skipped: target already exists on disk`,
        );
        await this.notifyFailure(userId, bookId, `File rename skipped: ${reason}.`, suppressNotification);
        return { status: 'skipped', reason, oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
      }
    }

    for (const file of allFiles) {
      const targetPath = fileTargets.get(file.id)!;
      if (targetPath !== file.absolutePath) {
        const pathTaken = await this.renameRepo.checkPathTakenByOtherBook(targetPath, bookId);
        if (pathTaken) {
          this.logger.warn(
            `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} status=skipped reason="collision" newPath="${sanitizeLogValue(targetPath)}" - rename skipped: path already taken`,
          );
          await this.notifyFailure(userId, bookId, 'File rename skipped: target path already taken by another book.', suppressNotification);
          return {
            status: 'skipped',
            reason: 'collision',
            oldPath: currentAbsolutePath,
            newPath: newAbsolutePath,
            durationMs: Date.now() - startedAt,
          };
        }
      }
    }

    try {
      if (bookHasOwnFolder && newFolderPath !== currentFolderPath) {
        if (mergeTargetBookId !== null) {
          await this.mergeBookIntoExistingFolder(bookId, data, currentFolderPath, newFolderPath, fileTargets, mergeTargetBookId);
        } else if (moveIntoExistingFolder) {
          await this.renameBookIntoExistingFolder(bookId, data, currentFolderPath, newFolderPath, fileTargets);
        } else {
          await this.renameBookWithFolder(bookId, data, currentFolderPath, newFolderPath, fileTargets);
        }
      } else {
        const nextBookFolderPath = isBookPerFolder ? newFolderPath : newAbsolutePath;
        await this.renameBookFilesOnly(bookId, data, fileTargets, nextBookFolderPath);
      }
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${FILE_RENAME_EVENT}] [fail] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - file rename failed`,
      );
      await this.notifyFailure(userId, bookId, err instanceof Error ? err.message : String(err), suppressNotification);
      return { status: 'failed', reason: errorMessage, oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
    }

    this.logger.log(
      `[${FILE_RENAME_EVENT}] [end] bookId=${bookId} userId=${userId} durationMs=${Date.now() - startedAt} status=success oldPath="${sanitizeLogValue(currentAbsolutePath)}" newPath="${sanitizeLogValue(newAbsolutePath)}" - file rename completed`,
    );

    await this.notifySuccess(userId, bookId, currentAbsolutePath, newAbsolutePath, suppressNotification);
    return { status: 'success', oldPath: currentAbsolutePath, newPath: newAbsolutePath, durationMs: Date.now() - startedAt };
  }

  private async renameBookFilesOnly(
    bookId: number,
    data: BookRenameData,
    fileTargets: Map<number, string>,
    nextBookFolderPath: string,
  ): Promise<void> {
    const allFiles = await this.renameRepo.findAllBookFiles(bookId);
    const updates: BookFilePathUpdate[] = allFiles.map((file) => {
      const newPath = fileTargets.get(file.id)!;
      return {
        id: file.id,
        absolutePath: newPath,
        relPath: relative(data.libraryFolderPath, newPath),
      };
    });

    await this.renameRepo.applyFolderRename(bookId, updates, nextBookFolderPath);

    const moved: Array<{ from: string; to: string }> = [];
    try {
      for (const file of allFiles) {
        const newPath = fileTargets.get(file.id)!;
        if (newPath !== file.absolutePath) {
          await mkdir(dirname(newPath), { recursive: true });
          await this.lockService.withLock(file.absolutePath, () => fsRename(file.absolutePath, newPath));
          moved.push({ from: file.absolutePath, to: newPath });
        }
      }
    } catch (error) {
      for (const { from, to } of [...moved].reverse()) {
        try {
          await fsRename(to, from);
        } catch (rollbackError) {
          this.logRollbackFailure(bookId, error, rollbackError);
        }
      }
      const oldUpdates = allFiles.map((file) => ({
        id: file.id,
        absolutePath: file.absolutePath,
        relPath: file.relPath,
      }));
      await this.rollbackFolderRename(bookId, oldUpdates, data.bookFolderPath, error);
      throw error;
    }

    for (const file of allFiles) {
      const oldDir = dirname(file.absolutePath);
      const newDir = dirname(fileTargets.get(file.id)!);
      if (oldDir !== newDir) {
        await this.tryRemoveEmptyDir(oldDir);
      }
    }
  }

  private async renameBookWithFolder(
    bookId: number,
    data: BookRenameData,
    oldFolderPath: string,
    newFolderPath: string,
    fileTargets: Map<number, string>,
  ): Promise<void> {
    const allFiles = await this.renameRepo.findAllBookFiles(bookId);
    const newUpdates = allFiles.map((file) => ({
      id: file.id,
      absolutePath: fileTargets.get(file.id)!,
      relPath: relative(data.libraryFolderPath, fileTargets.get(file.id)!),
    }));
    const oldUpdates = allFiles.map((file) => ({ id: file.id, absolutePath: file.absolutePath, relPath: file.relPath }) satisfies BookFilePathUpdate);

    await this.renameRepo.applyFolderRename(bookId, newUpdates, newFolderPath);

    if (this.foldersAreNested(oldFolderPath, newFolderPath)) {
      await this.moveBookFilesIndividually(bookId, allFiles, oldFolderPath, newFolderPath, fileTargets, oldUpdates);
    } else {
      let folderRenamed = false;
      try {
        await mkdir(dirname(newFolderPath), { recursive: true });
        await this.lockService.withLock(oldFolderPath, () => fsRename(oldFolderPath, newFolderPath));
        folderRenamed = true;

        const movedFilesInside: Array<{ from: string; to: string }> = [];
        try {
          for (const file of allFiles) {
            const currentPathAfterFolderRename = join(newFolderPath, relative(oldFolderPath, file.absolutePath));
            const intendedPath = fileTargets.get(file.id)!;
            if (currentPathAfterFolderRename !== intendedPath) {
              await mkdir(dirname(intendedPath), { recursive: true });
              await this.lockService.withLock(currentPathAfterFolderRename, () => fsRename(currentPathAfterFolderRename, intendedPath));
              movedFilesInside.push({ from: currentPathAfterFolderRename, to: intendedPath });
            }
          }
        } catch (innerError) {
          for (const { from, to } of [...movedFilesInside].reverse()) {
            try {
              await fsRename(to, from);
            } catch {
              /* ignore */
            }
          }
          throw innerError;
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

  private async renameBookIntoExistingFolder(
    bookId: number,
    data: BookRenameData,
    oldFolderPath: string,
    newFolderPath: string,
    fileTargets: Map<number, string>,
  ): Promise<void> {
    const allFiles = await this.renameRepo.findAllBookFiles(bookId);
    const newUpdates = allFiles.map((file) => ({
      id: file.id,
      absolutePath: fileTargets.get(file.id)!,
      relPath: relative(data.libraryFolderPath, fileTargets.get(file.id)!),
    }));
    const oldUpdates = allFiles.map((file) => ({ id: file.id, absolutePath: file.absolutePath, relPath: file.relPath }) satisfies BookFilePathUpdate);

    await this.renameRepo.applyFolderRename(bookId, newUpdates, newFolderPath);
    await this.moveBookFilesIndividually(bookId, allFiles, oldFolderPath, newFolderPath, fileTargets, oldUpdates);

    await this.tryRemoveEmptyDir(oldFolderPath);
    await this.tryRemoveEmptyDir(dirname(oldFolderPath));
  }

  private async mergeBookIntoExistingFolder(
    bookId: number,
    data: BookRenameData,
    oldFolderPath: string,
    newFolderPath: string,
    fileTargets: Map<number, string>,
    targetBookId: number,
  ): Promise<void> {
    const allFiles = await this.renameRepo.findAllBookFiles(bookId);
    const updates = allFiles.map((file) => ({
      id: file.id,
      absolutePath: fileTargets.get(file.id)!,
      relPath: relative(data.libraryFolderPath, fileTargets.get(file.id)!),
    }));

    const movedFiles: Array<{ from: string; to: string }> = [];
    try {
      await mkdir(newFolderPath, { recursive: true });

      for (const file of allFiles) {
        const newFilePath = fileTargets.get(file.id)!;
        const newFileDir = dirname(newFilePath);
        if (newFileDir !== newFolderPath) {
          await mkdir(newFileDir, { recursive: true });
        }

        if (file.absolutePath !== newFilePath) {
          await this.lockService.withLock(file.absolutePath, () => fsRename(file.absolutePath, newFilePath));
          movedFiles.push({ from: file.absolutePath, to: newFilePath });
        }
      }

      await this.renameRepo.applyExistingFolderMerge({
        sourceBookId: bookId,
        targetBookId,
        updates,
        fallbackPrimaryFileId: data.file.id,
      });
    } catch (error) {
      for (const { from, to } of [...movedFiles].reverse()) {
        try {
          await mkdir(dirname(from), { recursive: true });
          await fsRename(to, from);
        } catch (rollbackError) {
          this.logRollbackFailure(bookId, error, rollbackError);
        }
      }
      throw error;
    }

    await this.tryRemoveEmptyDir(oldFolderPath);
    await this.tryRemoveEmptyDir(dirname(oldFolderPath));
  }

  private async moveBookFilesIndividually(
    bookId: number,
    allFiles: Awaited<ReturnType<FileRenameRepository['findAllBookFiles']>>,
    oldFolderPath: string,
    newFolderPath: string,
    fileTargets: Map<number, string>,
    oldUpdates: BookFilePathUpdate[],
  ): Promise<void> {
    const movedFiles: Array<{ from: string; to: string }> = [];

    try {
      await mkdir(newFolderPath, { recursive: true });

      for (const file of allFiles) {
        const newFilePath = fileTargets.get(file.id)!;
        const newFileDir = dirname(newFilePath);

        if (newFileDir !== newFolderPath) {
          await mkdir(newFileDir, { recursive: true });
        }

        if (file.absolutePath !== newFilePath) {
          await this.lockService.withLock(file.absolutePath, () => fsRename(file.absolutePath, newFilePath));
          movedFiles.push({ from: file.absolutePath, to: newFilePath });
        }
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

  private applyMultiTrackAudioPartSuffixes(fileTargets: Map<number, string>, allFiles: RenameBookFile[], primaryFileId: number): void {
    const audioFiles = allFiles.filter((file) => this.isAudioContentFile(file, primaryFileId));
    if (audioFiles.length < 2) return;

    const audioFilesByTarget = new Map<string, RenameBookFile[]>();
    for (const file of audioFiles) {
      const targetPath = fileTargets.get(file.id);
      if (!targetPath) continue;

      const key = targetPath.toLowerCase();
      const existing = audioFilesByTarget.get(key);
      if (existing) {
        existing.push(file);
      } else {
        audioFilesByTarget.set(key, [file]);
      }
    }

    const collidingGroups = [...audioFilesByTarget.values()].filter((group) => group.length > 1);
    if (collidingGroups.length === 0) return;

    const trackNumbersByFileId = new Map<number, number>();
    [...audioFiles].sort(compareAudioTrackFiles).forEach((file, index) => {
      trackNumbersByFileId.set(file.id, index + 1);
    });

    for (const group of collidingGroups) {
      for (const file of group) {
        const targetPath = fileTargets.get(file.id);
        const trackNumber = trackNumbersByFileId.get(file.id);
        if (!targetPath || !trackNumber) continue;

        fileTargets.set(file.id, appendPartSuffix(targetPath, trackNumber));
      }
    }
  }

  private isAudioContentFile(file: RenameBookFile, primaryFileId: number): boolean {
    const format = (file.format ?? extname(file.absolutePath).slice(1)).toLowerCase();
    return Boolean(format && isAudioFormat(format) && (file.role === 'content' || file.id === primaryFileId));
  }

  private hasInternalCollision(fileTargets: Map<number, string>): boolean {
    const seen = new Set<string>();
    for (const targetPath of fileTargets.values()) {
      const key = targetPath.toLowerCase();
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }

  private foldersAreNested(pathA: string, pathB: string): boolean {
    const normA = (pathA.endsWith('/') ? pathA : pathA + '/').toLowerCase();
    const normB = (pathB.endsWith('/') ? pathB : pathB + '/').toLowerCase();
    return normB.startsWith(normA) || normA.startsWith(normB);
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

  private async findExistingTargetFilePath(allFiles: RenameBookFile[], fileTargets: Map<number, string>): Promise<string | null> {
    for (const file of allFiles) {
      const targetPath = fileTargets.get(file.id)!;
      if (targetPath !== file.absolutePath && (await this.pathExists(targetPath))) {
        return targetPath;
      }
    }
    return null;
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

  private async notifySuccess(userId: number, bookId: number, oldPath: string, newPath: string, suppress = false): Promise<void> {
    if (suppress) return;
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

  private async notifyFailure(userId: number, bookId: number, reason: string, suppress = false): Promise<void> {
    if (suppress) return;
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

function compareAudioTrackFiles(a: RenameBookFile, b: RenameBookFile): number {
  const aSortOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bSortOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return aSortOrder - bSortOrder || a.id - b.id;
}

function appendPartSuffix(targetPath: string, trackNumber: number): string {
  const extension = extname(targetPath);
  const stem = basename(targetPath, extension);
  return join(dirname(targetPath), `${stem}-Part${String(trackNumber).padStart(2, '0')}${extension}`);
}
