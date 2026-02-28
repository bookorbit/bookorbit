import { Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';

import type { StagingFile, StagingFilesPage, StagingMetadata, StagingSummary } from '@projectx/types';
import { StagingRepository, type ListOptions } from './staging.repository';
import { StagingIngestService } from './staging-ingest.service';
import type { StagingFileRow } from '../../db/schema';

@Injectable()
export class StagingService {
  constructor(
    private readonly repo: StagingRepository,
    private readonly ingestService: StagingIngestService,
  ) {}

  async listFiles(query: ListOptions): Promise<StagingFilesPage> {
    const { items, total } = await this.repo.findAll(query);
    return {
      items: items.map(toDto),
      total,
      page: query.page,
      size: query.limit,
    };
  }

  async getFile(id: number): Promise<StagingFile> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Staging file not found');
    return toDto(row);
  }

  async updateFile(
    id: number,
    data: { selectedMetadata?: Partial<StagingMetadata>; targetLibraryId?: number | null; targetFolderId?: number | null },
  ): Promise<StagingFile> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Staging file not found');

    const updateData = data.selectedMetadata !== undefined ? { ...data, metadataEditedAt: new Date() } : data;
    const updated = await this.repo.update(id, updateData);
    if (!updated) throw new NotFoundException('Staging file not found');
    return toDto(updated);
  }

  async discardFile(id: number): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Staging file not found');

    await this.cleanupFiles(row);
    await this.repo.deleteById(id);
  }

  async bulkDiscard(fileIds: number[], selectAll?: boolean, excludedIds?: number[]): Promise<void> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds) : fileIds;
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
    fields: Partial<StagingMetadata & Record<string, unknown>>,
    enabledFields: string[],
    mergeArrays: boolean,
  ): Promise<{ total: number; updated: number; failed: number }> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds) : (fileIds ?? []);
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

        await this.repo.update(row.id, { selectedMetadata: current as StagingMetadata });
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
  ): Promise<{ total: number; applied: number; skipped: number; skippedEdited: number }> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds) : fileIds;
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

  async bulkRetryFetch(fileIds: number[] | undefined, selectAll?: boolean, excludedIds?: number[]): Promise<{ total: number; queued: number }> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds) : (fileIds ?? []);
    if (!ids.length) return { total: 0, queued: 0 };

    const rows = await this.repo.findByIds(ids);
    const errorRows = rows.filter((r) => r.status === 'error');
    for (const row of errorRows) {
      void this.ingestService.retryFetch(row.id);
    }

    return { total: rows.length, queued: errorRows.length };
  }

  async getSummary(): Promise<StagingSummary> {
    return this.repo.countsByStatus();
  }

  async getStatistics() {
    return this.repo.getStatistics();
  }

  private async cleanupFiles(row: StagingFileRow): Promise<void> {
    await safeUnlink(row.absolutePath);
    if (row.coverPath) {
      await safeUnlink(row.coverPath);
      const thumbPath = row.coverPath.replace(/\.\w+$/, '_thumb.jpg');
      await safeUnlink(thumbPath);
    }
  }
}

function toDto(row: StagingFileRow): StagingFile {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize ? Number(row.fileSize) : null,
    format: row.format,
    status: row.status as StagingFile['status'],
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
