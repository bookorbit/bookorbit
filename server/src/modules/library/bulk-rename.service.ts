import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { basename, extname, join } from 'path';

import type { BulkRenamePreviewItem, BulkRenamePreviewPage, BulkRenameProgressEvent, BulkRenameStatus } from '@bookorbit/types';
import { NotificationType, resolveUploadPath } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { NotificationService } from '../notification/notification.service';
import { FileRenameService } from '../file-write/file-rename.service';
import { FileRenameRepository } from '../file-write/file-rename.repository';
import { FileWatcherService } from '../scanner/file-watcher.service';
import { LibraryRepository } from './library.repository';
import type { BulkRenameBookData } from '../file-write/bulk-rename.repository';
import { BulkRenameRepository } from '../file-write/bulk-rename.repository';
import { buildTokens } from '../file-write/file-rename.utils';

const CACHE_TTL_MS = 60_000;

interface CachedPreview {
  items: BulkRenamePreviewItem[];
  totalByStatus: Record<BulkRenameStatus, number>;
  createdAt: number;
}

interface BulkRenameStreamOptions {
  onProgress: (event: BulkRenameProgressEvent) => void;
  isCancelled: () => boolean;
}

interface BulkRenameSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
}

@Injectable()
export class BulkRenameService {
  private readonly logger = new Logger(BulkRenameService.name);
  private readonly previewCache = new Map<number, CachedPreview>();
  private readonly runningLibraries = new Set<number>();

  constructor(
    private readonly bulkRenameRepo: BulkRenameRepository,
    private readonly fileRenameRepo: FileRenameRepository,
    private readonly fileRenameService: FileRenameService,
    private readonly appSettings: AppSettingsService,
    private readonly notificationService: NotificationService,
    private readonly fileWatcherService: FileWatcherService,
    private readonly libraryRepo: LibraryRepository,
  ) {}

  async getPreview(libraryId: number, page: number, pageSize: number, statusFilter?: BulkRenameStatus): Promise<BulkRenamePreviewPage> {
    const cached = this.previewCache.get(libraryId);
    const now = Date.now();

    let preview: CachedPreview;
    if (cached && now - cached.createdAt < CACHE_TTL_MS) {
      preview = cached;
    } else {
      preview = await this.computeFullPreview(libraryId);
      this.previewCache.set(libraryId, preview);
    }

    const filtered = statusFilter ? preview.items.filter((item) => item.status === statusFilter) : preview.items;

    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total: filtered.length,
      totalByStatus: preview.totalByStatus,
    };
  }

  async execute(libraryId: number, userId: number, options: BulkRenameStreamOptions): Promise<BulkRenameSummary> {
    const event = 'library.bulk_rename';
    const startedAt = Date.now();

    if (this.runningLibraries.has(libraryId)) {
      throw new BadRequestException('A bulk rename is already running for this library.');
    }

    const settings = await this.bulkRenameRepo.findLibrarySettings(libraryId);
    if (!settings) throw new NotFoundException('Library not found');
    if (!settings.fileRenameEnabled) {
      throw new BadRequestException('File rename is not enabled for this library.');
    }

    this.runningLibraries.add(libraryId);
    this.previewCache.delete(libraryId);

    const bookIds = await this.bulkRenameRepo.findLibraryBookIds(libraryId);
    this.logger.log(`[${event}] [start] libraryId=${libraryId} userId=${userId} bookCount=${bookIds.length} - bulk rename started`);

    let watcherWasStopped = false;
    if (settings.watch) {
      await this.fileWatcherService.stopWatcher(libraryId);
      watcherWasStopped = true;
    }

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    try {
      for (const bookId of bookIds) {
        if (options.isCancelled()) break;

        try {
          const result = await this.fileRenameService.performRename(bookId, userId);

          if (result.status === 'success') succeeded++;
          else if (result.status === 'failed') failed++;
          else skipped++;

          options.onProgress({
            bookId,
            status: result.status,
            reason: result.reason,
          });
        } catch (err) {
          failed++;
          options.onProgress({
            bookId,
            status: 'failed',
            reason: getErrorMessage(err),
          });
        }
      }

      const cancelled = options.isCancelled();
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} userId=${userId} durationMs=${durationMs} succeeded=${succeeded} failed=${failed} skipped=${skipped} cancelled=${cancelled} - bulk rename completed`,
      );

      await this.notifyCompletion(userId, libraryId, succeeded, failed);

      return { processed: succeeded + failed + skipped, succeeded, failed, skipped, cancelled };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(getErrorMessage(err));
      this.logger.error(
        `[${event}] [fail] libraryId=${libraryId} userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - bulk rename failed`,
      );

      await this.notifyFailure(userId, libraryId, getErrorMessage(err));
      throw err;
    } finally {
      this.runningLibraries.delete(libraryId);

      if (watcherWasStopped) {
        const folders = await this.libraryRepo.findFoldersByLibrary(libraryId);
        await this.fileWatcherService.startWatcher(
          libraryId,
          folders.map((f) => f.path),
        );
      }
    }
  }

  isRunning(libraryId: number): boolean {
    return this.runningLibraries.has(libraryId);
  }

  invalidateCache(libraryId: number): void {
    this.previewCache.delete(libraryId);
  }

  private async computeFullPreview(libraryId: number): Promise<CachedPreview> {
    const settings = await this.bulkRenameRepo.findLibrarySettings(libraryId);
    if (!settings) throw new NotFoundException('Library not found');

    const books = await this.bulkRenameRepo.findAllBooksForLibrary(libraryId);

    const pattern =
      settings.fileNamingPattern ??
      (settings.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());

    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();

    const previewItems: BulkRenamePreviewItem[] = [];
    const newPathToBookIds = new Map<string, number[]>();

    for (const book of books) {
      const item = this.computePreviewItem(book, pattern, sanitizeForCrossPlatform);
      previewItems.push(item);

      if (item.newPath) {
        const existing = newPathToBookIds.get(item.newPath);
        if (existing) {
          existing.push(book.bookId);
        } else {
          newPathToBookIds.set(item.newPath, [book.bookId]);
        }
      }
    }

    const collisionPaths = new Set<string>();
    for (const [path, ids] of newPathToBookIds) {
      if (ids.length > 1) collisionPaths.add(path);
    }

    const nonCollisionNewPaths = previewItems
      .filter((item) => item.newPath && !collisionPaths.has(item.newPath) && item.status === 'will_rename')
      .map((item) => item.newPath!);

    const existingPathOwners = await this.fileRenameRepo.findExistingPaths(nonCollisionNewPaths);

    for (const item of previewItems) {
      if (!item.newPath) continue;

      if (collisionPaths.has(item.newPath)) {
        item.status = 'collision';
        item.reason = 'Multiple books would resolve to the same path';
        continue;
      }

      if (item.status === 'will_rename') {
        const owner = existingPathOwners.get(item.newPath);
        if (owner !== undefined && owner !== item.bookId) {
          item.status = 'collision';
          item.reason = 'Path already taken by another book';
        }
      }
    }

    const totalByStatus: Record<BulkRenameStatus, number> = {
      will_rename: 0,
      unchanged: 0,
      collision: 0,
      no_pattern: 0,
      error: 0,
    };
    for (const item of previewItems) {
      totalByStatus[item.status]++;
    }

    return { items: previewItems, totalByStatus, createdAt: Date.now() };
  }

  private computePreviewItem(book: BulkRenameBookData, pattern: string | null, sanitizeForCrossPlatform: boolean): BulkRenamePreviewItem {
    const baseItem: BulkRenamePreviewItem = {
      bookId: book.bookId,
      title: book.title ?? 'Untitled',
      currentPath: book.absolutePath,
      newPath: null,
      status: 'unchanged',
    };

    if (!pattern) {
      return { ...baseItem, status: 'no_pattern', reason: 'No naming pattern configured' };
    }

    try {
      const format = (book.format ?? extname(book.absolutePath).slice(1)).toLowerCase();
      const originalStem = basename(book.absolutePath, extname(book.absolutePath));
      const tokens = buildTokens(book.metadata, book.authors, originalStem, format);
      const resolvedRelPath = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });

      if (!resolvedRelPath) {
        return { ...baseItem, status: 'no_pattern', reason: 'Pattern resolved to empty' };
      }

      const newAbsolutePath = join(book.libraryFolderPath, resolvedRelPath);

      if (newAbsolutePath === book.absolutePath) {
        return { ...baseItem, newPath: newAbsolutePath, status: 'unchanged' };
      }

      return { ...baseItem, newPath: newAbsolutePath, status: 'will_rename' };
    } catch (err) {
      return { ...baseItem, status: 'error', reason: getErrorMessage(err) };
    }
  }

  private async notifyCompletion(userId: number, libraryId: number, succeeded: number, failed: number): Promise<void> {
    const type = failed > 0 ? NotificationType.BulkRenameFailed : NotificationType.BulkRenameCompleted;
    const title = failed > 0 ? 'Bulk rename completed with errors' : 'Bulk rename completed';
    const message = `${succeeded} renamed, ${failed} failed`;

    await this.notificationService
      .notify({
        type,
        title,
        message,
        scope: { kind: 'user', userId },
        meta: { libraryId, succeeded, failed },
      })
      .catch(() => {});
  }

  private async notifyFailure(userId: number, libraryId: number, error: string): Promise<void> {
    await this.notificationService
      .notify({
        type: NotificationType.BulkRenameFailed,
        title: 'Bulk rename failed',
        message: error.slice(0, 200),
        scope: { kind: 'user', userId },
        meta: { libraryId },
      })
      .catch(() => {});
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
