import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AnnotationHubItem, AnnotationHubResponse } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AnnotationExportService, type AnnotationExportFormat, type AnnotationExportResult } from './annotation-export.service';
import { AnnotationRepository, type HubAnnotationRow, type HubFilters, type HubSort } from './annotation.repository';
import type { AnnotationBulkDto, AnnotationExportQueryDto, AnnotationHubQueryDto } from './dto/annotation-hub.dto';

const BULK_EVENT = 'annotation.bulk';

@Injectable()
export class AnnotationHubService {
  private readonly logger = new Logger(AnnotationHubService.name);

  constructor(
    private readonly annotationRepo: AnnotationRepository,
    private readonly exportService: AnnotationExportService,
  ) {}

  async list(userId: number, query: AnnotationHubQueryDto): Promise<AnnotationHubResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const { items, total } = await this.annotationRepo.findHubPaginated(userId, this.buildFilters(query), this.buildSort(query), page, pageSize);
    return { items: items.map((row) => this.toHubItem(row)), total, page, pageSize };
  }

  async bulk(userId: number, dto: AnnotationBulkDto): Promise<{ affected: number }> {
    const startedAtMs = Date.now();
    let affected: number;
    if (dto.action === 'trash') {
      affected = await this.annotationRepo.bulkSetDeleted(userId, dto.ids, true);
    } else if (dto.action === 'restore') {
      affected = await this.annotationRepo.bulkSetDeleted(userId, dto.ids, false);
    } else {
      affected = await this.annotationRepo.bulkRestyle(userId, dto.ids, { color: dto.color, style: dto.style });
    }
    this.logger.log(
      `[${BULK_EVENT}] [end] userId=${userId} action=${dto.action} requested=${dto.ids.length} affected=${affected} durationMs=${Date.now() - startedAtMs} - bulk annotation action applied`,
    );
    return { affected };
  }

  async restore(userId: number, annotationId: number): Promise<AnnotationHubItem> {
    const restored = await this.annotationRepo.restore(annotationId, userId);
    if (!restored) throw new NotFoundException(`Annotation ${annotationId} not found in trash`);
    const row = await this.annotationRepo.findHubById(userId, annotationId);
    return this.toHubItem(row ?? { ...restored, cfi: null, cfiStatus: null, cfiExtras: null, bookTitle: null, jumpFileId: null, pageno: null });
  }

  /** Hard delete; blocked until every synced device acknowledged the deletion. */
  async purge(userId: number, annotationId: number): Promise<void> {
    const result = await this.annotationRepo.purge(annotationId, userId);
    if (result === 'not_found') throw new NotFoundException(`Annotation ${annotationId} not found in trash`);
    if (result === 'pending_device_sync') {
      throw new ConflictException('This annotation is still queued for deletion on a synced device. Sync the device first or keep it in trash.');
    }
  }

  async export(userId: number, query: AnnotationExportQueryDto, scopeLabel: string): Promise<AnnotationExportResult> {
    const format: AnnotationExportFormat = query.format ?? 'md';
    const rows = await this.annotationRepo.findHubAll(userId, this.buildFilters(query));
    this.logger.log(
      `[annotation.export] [end] userId=${userId} format=${format} rows=${rows.length} scope="${sanitizeLogValue(scopeLabel)}" - annotations exported`,
    );
    return this.exportService.export(rows, format, scopeLabel);
  }

  private toHubItem(row: HubAnnotationRow): AnnotationHubItem {
    const chapterIndex = (row.cfiExtras as { chapterIndex?: number } | null)?.chapterIndex;
    return {
      id: row.id,
      bookId: row.bookId,
      cfi: row.cfi,
      text: row.text,
      color: row.color,
      style: row.style,
      note: row.note,
      chapterTitle: row.chapterTitle,
      origin: row.origin,
      positionStatus: (row.cfi != null || row.cfiStatus != null ? (row.cfiStatus ?? 'exact') : null) as AnnotationHubItem['positionStatus'],
      chapterIndex: typeof chapterIndex === 'number' ? chapterIndex : null,
      createdAt: row.createdAt.toISOString(),
      bookTitle: row.bookTitle,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      jumpFileId: row.jumpFileId,
      pageno: row.pageno,
    };
  }

  private buildFilters(query: AnnotationHubQueryDto): HubFilters {
    const split = (value: string | undefined): string[] | undefined => {
      if (!value) return undefined;
      const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    };
    return {
      bookId: query.bookId,
      colors: split(query.colors),
      styles: split(query.styles),
      origins: split(query.origins),
      chapter: query.chapter || undefined,
      search: query.search || undefined,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      status: query.status ?? 'active',
    };
  }

  private buildSort(query: AnnotationHubQueryDto): HubSort {
    return { by: query.sortBy ?? 'createdAt', dir: query.sortDir ?? 'desc' };
  }
}
