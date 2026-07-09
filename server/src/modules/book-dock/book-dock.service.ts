import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { BookDockFile, BookDockFilesPage, BookDockMetadata, BookDockSummary } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraries, libraryFolders } from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookDockRepository, type ListOptions } from './book-dock.repository';
import { BookDockIngestService } from './book-dock-ingest.service';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockGateway } from './book-dock.gateway';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockWatcherService } from './book-dock-watcher.service';
import type { BookDockFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
const BULK_SELECTION_BATCH_SIZE = 500;

@Injectable()
export class BookDockService {
  private readonly logger = new Logger(BookDockService.name);
  private resumeWorkPromise: Promise<void> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: BookDockRepository,
    private readonly ingestService: BookDockIngestService,
    private readonly finalizeService: BookDockFinalizeService,
    private readonly watcherService: BookDockWatcherService,
    private readonly processingState: BookDockProcessingStateService,
    private readonly gateway: BookDockGateway,
  ) {}

  async listFiles(query: ListOptions): Promise<BookDockFilesPage> {
    const { items, total } = await this.repo.findAll(query);
    return {
      items: items.map(toDto),
      total,
      page: query.page,
      size: query.limit,
    };
  }

  async getFile(id: number): Promise<BookDockFile> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Book Dock file not found');
    return toDto(row);
  }

  async updateFile(
    id: number,
    data: { selectedMetadata?: Partial<BookDockMetadata>; targetLibraryId?: number | null; targetFolderId?: number | null },
  ): Promise<BookDockFile> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Book Dock file not found');

    if (data.targetLibraryId !== undefined || data.targetFolderId !== undefined) {
      await this.assertValidTarget(data.targetLibraryId, data.targetFolderId);
    }

    const updateData = data.selectedMetadata !== undefined ? { ...data, metadataEditedAt: new Date() } : data;
    const updated = await this.repo.update(id, updateData);
    if (!updated) throw new NotFoundException('Book Dock file not found');
    return toDto(updated);
  }

  async discardFile(id: number): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Book Dock file not found');

    await this.cleanupFiles(row);
    await this.repo.deleteById(id);
  }

  async bulkDiscard(
    fileIds: number[],
    selectAll?: boolean,
    excludedIds?: number[],
    status?: string,
    search?: string,
    userId?: number,
    isSuperuser?: boolean,
  ): Promise<void> {
    await this.processSelectionRows(
      {
        fileIds,
        selectAll,
        excludedIds,
        status,
        search,
        userId,
        isSuperuser,
      },
      async (rows) => {
        for (const row of rows) {
          await this.cleanupFiles(row);
        }
        await this.repo.deleteByIds(rows.map((row) => row.id));
      },
    );
  }

  async bulkEdit(
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    fields: Partial<BookDockMetadata & Record<string, unknown>>,
    enabledFields: string[],
    mergeArrays: boolean,
    status?: string,
    search?: string,
    userId?: number,
    isSuperuser?: boolean,
  ): Promise<{ total: number; updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;
    const total = await this.processSelectionRows(
      {
        fileIds: fileIds ?? [],
        selectAll,
        excludedIds,
        status,
        search,
        userId,
        isSuperuser,
      },
      async (rows) => {
        for (const row of rows) {
          try {
            const current: Record<string, unknown> = { ...(row.selectedMetadata ?? row.embeddedMetadata ?? {}) };

            for (const field of enabledFields) {
              const value = (fields as Record<string, unknown>)[field];
              if (value === undefined) continue;

              if (mergeArrays && Array.isArray(value) && Array.isArray(current[field])) {
                const merged = [...new Set([...(current[field] as string[]), ...(value as string[])])];
                current[field] = merged;
              } else {
                current[field] = value;
              }
            }

            await this.repo.update(row.id, { selectedMetadata: current as BookDockMetadata });
            updated++;
          } catch {
            failed++;
          }
        }
      },
    );

    return { total, updated, failed };
  }

  async bulkApplyFetched(
    fileIds: number[],
    selectAll?: boolean,
    excludedIds?: number[],
    status?: string,
    search?: string,
    userId?: number,
    isSuperuser?: boolean,
  ): Promise<{ total: number; applied: number; skipped: number; skippedEdited: number }> {
    let applied = 0;
    let skipped = 0;
    let skippedEdited = 0;
    const total = await this.processSelectionRows(
      {
        fileIds,
        selectAll,
        excludedIds,
        status,
        search,
        userId,
        isSuperuser,
      },
      async (rows) => {
        for (const row of rows) {
          if (row.metadataEditedAt) {
            skippedEdited++;
            continue;
          }
          if (!row.fetchedMetadata) {
            skipped++;
            continue;
          }
          await this.repo.update(row.id, { selectedMetadata: row.fetchedMetadata, metadataEditedAt: null });
          applied++;
        }
      },
    );

    return { total, applied, skipped, skippedEdited };
  }

  async bulkRetryFetch(
    fileIds: number[] | undefined,
    selectAll?: boolean,
    excludedIds?: number[],
    status?: string,
    search?: string,
    userId?: number,
    isSuperuser?: boolean,
  ): Promise<{ total: number; queued: number }> {
    let queued = 0;
    const total = await this.processSelectionRows(
      {
        fileIds: fileIds ?? [],
        selectAll,
        excludedIds,
        status,
        search,
        userId,
        isSuperuser,
      },
      (rows) => {
        const errorRows = rows.filter((row) => row.status === 'error');
        queued += errorRows.length;
        for (const row of errorRows) {
          void this.ingestService.retryFetch(row.id);
        }
      },
    );

    return { total, queued };
  }

  async bulkSetTarget(
    fileIds: number[],
    selectAll?: boolean,
    excludedIds?: number[],
    targetLibraryId?: number | null,
    targetFolderId?: number | null,
    status?: string,
    search?: string,
    userId?: number,
    isSuperuser?: boolean,
  ): Promise<{ total: number; updated: number; failed: number }> {
    await this.assertValidTarget(targetLibraryId, targetFolderId);
    let updated = 0;
    const total = await this.processSelectionRows(
      {
        fileIds,
        selectAll,
        excludedIds,
        status,
        search,
        userId,
        isSuperuser,
      },
      async (rows) => {
        updated += await this.repo.setTargetsByIds(
          rows.map((row) => row.id),
          targetLibraryId ?? null,
          targetFolderId ?? null,
        );
      },
    );
    const failed = total - updated;
    return { total, updated, failed };
  }

  async selectionSummary(
    fileIds: number[],
    selectAll?: boolean,
    excludedIds?: number[],
    status?: string,
    search?: string,
    userId?: number,
    isSuperuser?: boolean,
  ): Promise<{ total: number; withDestination: number; withoutDestination: number }> {
    const destinationPairCounts = new Map<string, number>();
    const folderIdSet = new Set<number>();
    const total = await this.processSelectionRows(
      {
        fileIds,
        selectAll,
        excludedIds,
        status,
        search,
        userId,
        isSuperuser,
      },
      (rows) => {
        for (const row of rows) {
          if (row.targetLibraryId === null || row.targetFolderId === null) continue;
          folderIdSet.add(row.targetFolderId);
          const key = `${row.targetFolderId}:${row.targetLibraryId}`;
          destinationPairCounts.set(key, (destinationPairCounts.get(key) ?? 0) + 1);
        }
      },
    );
    if (total === 0) return { total: 0, withDestination: 0, withoutDestination: 0 };

    const folderIds = [...folderIdSet];
    const folderRows = folderIds.length
      ? await this.db
          .select({ id: libraryFolders.id, libraryId: libraryFolders.libraryId })
          .from(libraryFolders)
          .where(inArray(libraryFolders.id, folderIds))
      : [];
    const folderById = new Map(folderRows.map((row) => [row.id, row.libraryId]));
    let withDestination = 0;
    for (const [key, count] of destinationPairCounts) {
      const [folderIdRaw, libraryIdRaw] = key.split(':');
      const folderId = Number(folderIdRaw);
      const libraryId = Number(libraryIdRaw);
      if (folderById.get(folderId) === libraryId) {
        withDestination += count;
      }
    }

    return { total, withDestination, withoutDestination: total - withDestination };
  }

  async getSummary(userId?: number, isSuperuser?: boolean): Promise<BookDockSummary> {
    const [summary, paused] = await Promise.all([this.repo.countsByStatus(userId, isSuperuser), this.processingState.isPaused()]);
    return { ...summary, paused };
  }

  async getStatistics(userId?: number, isSuperuser?: boolean) {
    return this.repo.getStatistics(userId, isSuperuser);
  }

  async pauseProcessing(): Promise<BookDockSummary> {
    const startedAt = Date.now();
    this.logger.log(`[book_dock.processing_pause] [start] - Book Dock processing pause requested`);
    try {
      await this.processingState.pause();
      this.ingestService.pauseProcessing();
      this.finalizeService.pauseProcessing();
      const summary = await this.emitSummary();
      this.logger.log(`[book_dock.processing_pause] [end] durationMs=${Date.now() - startedAt} - Book Dock processing paused`);
      return summary;
    } catch (error) {
      this.logProcessingControlFailure('book_dock.processing_pause', startedAt, error, 'Book Dock processing pause failed');
      throw error;
    }
  }

  async resumeProcessing(): Promise<BookDockSummary> {
    const startedAt = Date.now();
    this.logger.log(`[book_dock.processing_resume] [start] - Book Dock processing resume requested`);
    try {
      await this.processingState.resume();
      await Promise.all([this.ingestService.resumeProcessing(), this.finalizeService.resumeProcessing()]);
      this.startResumeBackgroundWork();
      const summary = await this.emitSummary();
      this.logger.log(`[book_dock.processing_resume] [end] durationMs=${Date.now() - startedAt} - Book Dock processing resumed`);
      return summary;
    } catch (error) {
      this.logProcessingControlFailure('book_dock.processing_resume', startedAt, error, 'Book Dock processing resume failed');
      throw error;
    }
  }

  private async cleanupFiles(row: BookDockFileRow): Promise<void> {
    await safeUnlink(row.absolutePath);
    if (row.coverPath) {
      await safeUnlink(row.coverPath);
      const thumbPath = row.coverPath.replace(/\.\w+$/, '_thumb.jpg');
      await safeUnlink(thumbPath);
    }
  }

  private startResumeBackgroundWork(): void {
    if (this.resumeWorkPromise) return;
    this.resumeWorkPromise = this.resumeBackgroundWork().finally(() => {
      this.resumeWorkPromise = null;
    });
  }

  private async resumeBackgroundWork(): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`[book_dock.resume_recovery] [start] - Book Dock resume recovery started`);
    try {
      const metadataQueued = await this.ingestService.requeueProcessableFiles();
      const autoFinalizeQueued = await this.finalizeService.requeueAutoFinalizeCandidates();
      await this.watcherService.rescan();
      this.logger.log(
        `[book_dock.resume_recovery] [end] durationMs=${Date.now() - startedAt} metadataQueued=${metadataQueued} autoFinalizeQueued=${autoFinalizeQueued} - Book Dock resume recovery completed`,
      );
    } catch (error) {
      this.logProcessingControlFailure('book_dock.resume_recovery', startedAt, error, 'Book Dock resume recovery failed');
    }
  }

  private async emitSummary(): Promise<BookDockSummary> {
    const summary = await this.getSummary();
    this.gateway.emitSummary(summary);
    return summary;
  }

  private logProcessingControlFailure(event: string, startedAt: number, error: unknown, message: string): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(`[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - ${message}`);
  }

  private async assertValidTarget(targetLibraryId?: number | null, targetFolderId?: number | null): Promise<void> {
    const hasLibrary = targetLibraryId !== undefined;
    const hasFolder = targetFolderId !== undefined;
    if (!hasLibrary && !hasFolder) return;

    const libraryId = targetLibraryId ?? null;
    const folderId = targetFolderId ?? null;

    if ((libraryId === null) !== (folderId === null)) {
      throw new BadRequestException('targetLibraryId and targetFolderId must both be set or both be null');
    }

    if (libraryId === null && folderId === null) return;

    const resolvedLibraryId = libraryId as number;
    const resolvedFolderId = folderId as number;

    const [library] = await this.db.select({ id: libraries.id }).from(libraries).where(eq(libraries.id, resolvedLibraryId)).limit(1);
    if (!library) throw new BadRequestException('Destination library not found');

    const [folder] = await this.db
      .select({ id: libraryFolders.id, libraryId: libraryFolders.libraryId })
      .from(libraryFolders)
      .where(eq(libraryFolders.id, resolvedFolderId))
      .limit(1);
    if (!folder) throw new BadRequestException('Destination folder not found');
    if (folder.libraryId !== resolvedLibraryId) {
      throw new BadRequestException('Destination folder does not belong to destination library');
    }
  }

  private async processSelectionRows(
    options: {
      fileIds: number[];
      selectAll?: boolean;
      excludedIds?: number[];
      status?: string;
      search?: string;
      userId?: number;
      isSuperuser?: boolean;
    },
    processBatch: (rows: BookDockFileRow[]) => Promise<void> | void,
  ): Promise<number> {
    let total = 0;
    const userId = options.userId ?? 0;
    const isSuperuser = options.isSuperuser ?? true;

    if (options.selectAll) {
      let afterId: number | undefined;
      while (true) {
        const rows = await this.repo.findSelectionBatch({
          limit: BULK_SELECTION_BATCH_SIZE,
          afterId,
          excludedIds: options.excludedIds,
          status: options.status,
          search: options.search,
          userId,
          isSuperuser,
        });
        if (rows.length === 0) break;
        await processBatch(rows);
        total += rows.length;
        afterId = rows[rows.length - 1]?.id;
      }
      return total;
    }

    const ids = dedupeIds(options.fileIds);
    for (let index = 0; index < ids.length; index += BULK_SELECTION_BATCH_SIZE) {
      const batchIds = ids.slice(index, index + BULK_SELECTION_BATCH_SIZE);
      const rows = await this.repo.findByIds(batchIds);
      if (rows.length === 0) continue;
      await processBatch(rows);
      total += rows.length;
    }

    return total;
  }
}

function toDto(row: BookDockFileRow): BookDockFile {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize ? Number(row.fileSize) : null,
    format: row.format,
    status: row.status as BookDockFile['status'],
    embeddedMetadata: row.embeddedMetadata ?? null,
    selectedMetadata: row.selectedMetadata ?? null,
    fetchedMetadata: row.fetchedMetadata ?? null,
    targetLibraryId: row.targetLibraryId,
    targetFolderId: row.targetFolderId,
    confidence: row.confidence ?? null,
    fetchedMetadataSources: row.fetchedMetadataSources ?? null,
    errorMessage: row.errorMessage,
    metadataEditedAt: row.metadataEditedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // file may already be deleted
  }
}

function dedupeIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id): id is number => Number.isInteger(id) && id > 0))];
}
