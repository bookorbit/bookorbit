import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { BookBucketFile, BookBucketFilesPage, BookBucketMetadata, BookBucketSummary } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraries, libraryFolders } from '../../db/schema';
import { BookBucketRepository, type ListOptions } from './book-bucket.repository';
import { BookBucketIngestService } from './book-bucket-ingest.service';
import type { BookBucketFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookBucketService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: BookBucketRepository,
    private readonly ingestService: BookBucketIngestService,
  ) {}

  async listFiles(query: ListOptions): Promise<BookBucketFilesPage> {
    const { items, total } = await this.repo.findAll(query);
    return {
      items: items.map(toDto),
      total,
      page: query.page,
      size: query.limit,
    };
  }

  async getFile(id: number): Promise<BookBucketFile> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Book Bucket file not found');
    return toDto(row);
  }

  async updateFile(
    id: number,
    data: { selectedMetadata?: Partial<BookBucketMetadata>; targetLibraryId?: number | null; targetFolderId?: number | null },
  ): Promise<BookBucketFile> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Book Bucket file not found');

    if (data.targetLibraryId !== undefined || data.targetFolderId !== undefined) {
      await this.assertValidTarget(data.targetLibraryId, data.targetFolderId);
    }

    const updateData = data.selectedMetadata !== undefined ? { ...data, metadataEditedAt: new Date() } : data;
    const updated = await this.repo.update(id, updateData);
    if (!updated) throw new NotFoundException('Book Bucket file not found');
    return toDto(updated);
  }

  async discardFile(id: number): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Book Bucket file not found');

    await this.cleanupFiles(row);
    await this.repo.deleteById(id);
  }

  async bulkDiscard(fileIds: number[], selectAll?: boolean, excludedIds?: number[], status?: string, search?: string): Promise<void> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : fileIds;
    if (!ids.length) return;

    const rows = await this.repo.findByIds(ids);
    for (const row of rows) {
      await this.cleanupFiles(row);
    }
    await this.repo.deleteByIds(ids);
  }

  async bulkEdit(
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    fields: Partial<BookBucketMetadata & Record<string, unknown>>,
    enabledFields: string[],
    mergeArrays: boolean,
    status?: string,
    search?: string,
  ): Promise<{ total: number; updated: number; failed: number }> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : (fileIds ?? []);
    const rows = await this.repo.findByIds(ids);
    let updated = 0;
    let failed = 0;

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

        await this.repo.update(row.id, { selectedMetadata: current as BookBucketMetadata });
        updated++;
      } catch {
        failed++;
      }
    }

    return { total: rows.length, updated, failed };
  }

  async bulkApplyFetched(
    fileIds: number[],
    selectAll?: boolean,
    excludedIds?: number[],
    status?: string,
    search?: string,
  ): Promise<{ total: number; applied: number; skipped: number; skippedEdited: number }> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : fileIds;
    if (!ids.length) return { total: 0, applied: 0, skipped: 0, skippedEdited: 0 };

    const rows = await this.repo.findByIds(ids);
    let applied = 0;
    let skipped = 0;
    let skippedEdited = 0;

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

    return { total: rows.length, applied, skipped, skippedEdited };
  }

  async bulkRetryFetch(
    fileIds: number[] | undefined,
    selectAll?: boolean,
    excludedIds?: number[],
    status?: string,
    search?: string,
  ): Promise<{ total: number; queued: number }> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : (fileIds ?? []);
    if (!ids.length) return { total: 0, queued: 0 };

    const rows = await this.repo.findByIds(ids);
    const errorRows = rows.filter((r) => r.status === 'error');
    for (const row of errorRows) {
      void this.ingestService.retryFetch(row.id);
    }

    return { total: rows.length, queued: errorRows.length };
  }

  async bulkSetTarget(
    fileIds: number[],
    selectAll?: boolean,
    excludedIds?: number[],
    targetLibraryId?: number | null,
    targetFolderId?: number | null,
    status?: string,
    search?: string,
  ): Promise<{ total: number; updated: number; failed: number }> {
    await this.assertValidTarget(targetLibraryId, targetFolderId);

    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : fileIds;
    if (!ids.length) return { total: 0, updated: 0, failed: 0 };

    const rows = await this.repo.findByIds(ids);
    let updated = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        await this.repo.update(row.id, { targetLibraryId: targetLibraryId ?? null, targetFolderId: targetFolderId ?? null });
        updated++;
      } catch {
        failed++;
      }
    }

    return { total: rows.length, updated, failed };
  }

  async selectionSummary(
    fileIds: number[],
    selectAll?: boolean,
    excludedIds?: number[],
    status?: string,
    search?: string,
  ): Promise<{ total: number; withDestination: number; withoutDestination: number }> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search) : fileIds;
    if (!ids.length) return { total: 0, withDestination: 0, withoutDestination: 0 };

    const rows = await this.repo.findByIds(ids);
    const candidates = rows.filter((row) => row.targetLibraryId !== null && row.targetFolderId !== null);
    const folderIds = [...new Set(candidates.map((row) => row.targetFolderId!).filter((id): id is number => id != null))];
    const folderRows = folderIds.length
      ? await this.db
          .select({ id: libraryFolders.id, libraryId: libraryFolders.libraryId })
          .from(libraryFolders)
          .where(inArray(libraryFolders.id, folderIds))
      : [];
    const folderById = new Map(folderRows.map((row) => [row.id, row.libraryId]));
    const withDestination = candidates.filter((row) => folderById.get(row.targetFolderId!) === row.targetLibraryId).length;
    return { total: rows.length, withDestination, withoutDestination: rows.length - withDestination };
  }

  async getSummary(): Promise<BookBucketSummary> {
    return this.repo.countsByStatus();
  }

  async getStatistics() {
    return this.repo.getStatistics();
  }

  private async cleanupFiles(row: BookBucketFileRow): Promise<void> {
    await safeUnlink(row.absolutePath);
    if (row.coverPath) {
      await safeUnlink(row.coverPath);
      const thumbPath = row.coverPath.replace(/\.\w+$/, '_thumb.jpg');
      await safeUnlink(thumbPath);
    }
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
}

function toDto(row: BookBucketFileRow): BookBucketFile {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize ? Number(row.fileSize) : null,
    format: row.format,
    status: row.status as BookBucketFile['status'],
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
