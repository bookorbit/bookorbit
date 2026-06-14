import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type {
  AnnotationDeviceSyncInfo,
  AnnotationHubBookFacet,
  AnnotationHubItem,
  AnnotationHubResponse,
  AnnotationHubStats,
  AnnotationPositionFormat,
  AnnotationPositionInfo,
  AnnotationSyncDetail,
} from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AnnotationConversionService } from './annotation-conversion.service';
import { AnnotationExportService, type AnnotationExportFormat, type AnnotationExportResult } from './annotation-export.service';
import { AnnotationSyncRepository } from './annotation-sync.repository';
import { AnnotationRepository, type HubAnnotationRow, type HubFilters, type HubSort } from './annotation.repository';
import type { AnnotationBulkDto, AnnotationExportQueryDto, AnnotationHubQueryDto } from './dto/annotation-hub.dto';

const BULK_EVENT = 'annotation.bulk';
const RETRY_EVENT = 'annotation.position_retry';
const DEFAULT_BOOK_FACET_LIMIT = 20;

function toBookFacet(row: { bookId: number; bookTitle: string | null; author: string | null; count: number }): AnnotationHubBookFacet {
  return { bookId: row.bookId, bookTitle: row.bookTitle, author: row.author, count: Number(row.count) };
}

@Injectable()
export class AnnotationHubService {
  private readonly logger = new Logger(AnnotationHubService.name);

  constructor(
    private readonly annotationRepo: AnnotationRepository,
    private readonly exportService: AnnotationExportService,
    private readonly syncRepo: AnnotationSyncRepository,
    private readonly conversionService: AnnotationConversionService,
  ) {}

  async list(userId: number, query: AnnotationHubQueryDto): Promise<AnnotationHubResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const filters = this.buildFilters(query);
    const [{ items, total }, statsRow] = await Promise.all([
      this.annotationRepo.findHubPaginated(userId, filters, this.buildSort(query), page, pageSize),
      this.annotationRepo.getHubStats(userId, filters),
    ]);
    const stats: AnnotationHubStats = {
      books: Number(statsRow?.books ?? 0),
      withNotes: Number(statsRow?.withNotes ?? 0),
      originBreakdown: (
        [
          { origin: 'web', count: Number(statsRow?.web ?? 0) },
          { origin: 'koreader', count: Number(statsRow?.koreader ?? 0) },
          { origin: 'kobo', count: Number(statsRow?.kobo ?? 0) },
        ] as AnnotationHubStats['originBreakdown']
      ).filter((entry) => entry.count > 0),
    };
    return { items: items.map((row) => this.toHubItem(row)), total, page, pageSize, stats };
  }

  async listBooks(
    userId: number,
    params: { status: 'active' | 'trashed'; q?: string; limit?: number; selectedId?: number },
  ): Promise<AnnotationHubBookFacet[]> {
    const limit = params.limit ?? DEFAULT_BOOK_FACET_LIMIT;
    const rows = await this.annotationRepo.findHubBookFacets(userId, { status: params.status, q: params.q, limit });
    const facets = rows.map(toBookFacet);
    if (params.selectedId && !facets.some((facet) => facet.bookId === params.selectedId)) {
      const selected = await this.annotationRepo.findHubBookFacet(userId, params.status, params.selectedId);
      if (selected) facets.unshift(toBookFacet(selected));
    }
    return facets;
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
    return this.toHubItem(
      row ?? { ...restored, cfi: null, cfiStatus: null, cfiExtras: null, bookTitle: null, author: null, jumpFileId: null, pageno: null },
    );
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

  async syncDetail(userId: number, annotationId: number): Promise<AnnotationSyncDetail> {
    const annotation = await this.syncRepo.findAnnotationById(annotationId, userId);
    if (!annotation) throw new NotFoundException(`Annotation ${annotationId} not found`);

    const [positionRows, stateRows] = await Promise.all([
      this.syncRepo.findPositionsByAnnotationIds([annotationId], ['cfi', 'xpointer', 'pdf', 'kobo_span']),
      this.syncRepo.findStatesByAnnotation(annotationId, userId),
    ]);

    const koboDeviceIds = stateRows.filter((state) => state.source === 'kobo' && /^\d+$/.test(state.deviceId)).map((state) => Number(state.deviceId));
    const koboNames = await this.syncRepo.findKoboDeviceNames(koboDeviceIds);

    const positions: AnnotationPositionInfo[] = positionRows.map((row) => ({
      format: row.format as AnnotationPositionFormat,
      status: row.status as AnnotationPositionInfo['status'],
      reason: typeof (row.extras as { reason?: unknown } | null)?.reason === 'string' ? ((row.extras as { reason: string }).reason ?? null) : null,
      converterVersion: row.converterVersion,
      updatedAt: row.updatedAt.toISOString(),
    }));

    const devices: AnnotationDeviceSyncInfo[] = stateRows.map((state) => ({
      source: state.source as AnnotationDeviceSyncInfo['source'],
      deviceId: state.deviceId,
      deviceName: state.source === 'kobo' ? (koboNames.get(state.deviceId) ?? null) : null,
      lastAppliedVersion: state.lastAppliedVersion,
      upToDate: annotation.deletedAt ? state.deleteAckedAt != null : state.lastAppliedVersion >= annotation.version,
      deleteAckedAt: state.deleteAckedAt ? state.deleteAckedAt.toISOString() : null,
      lastSyncedAt: state.lastSyncedAt.toISOString(),
    }));

    return { annotationId, origin: annotation.origin as AnnotationSyncDetail['origin'], version: annotation.version, positions, devices };
  }

  /**
   * Resets a position to pending so converters recompute it. cfi recomputes
   * immediately; device formats recompute on that device type's next sync.
   */
  async retryPosition(userId: number, annotationId: number, format: AnnotationPositionFormat): Promise<AnnotationSyncDetail> {
    const annotation = await this.syncRepo.findAnnotationById(annotationId, userId);
    if (!annotation) throw new NotFoundException(`Annotation ${annotationId} not found`);

    await this.syncRepo.updatePosition(annotationId, format, { status: 'pending', converterVersion: null });
    let converted = 0;
    if (format === 'cfi') {
      converted = await this.conversionService.ensureCfiPositionsForBook(userId, annotation.bookId);
    }
    this.logger.log(
      `[${RETRY_EVENT}] [end] userId=${userId} annotationId=${annotationId} format=${format} converted=${converted} - position retry applied`,
    );
    return this.syncDetail(userId, annotationId);
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
      author: row.author,
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
      hasNote: query.hasNote || undefined,
      status: query.status ?? 'active',
    };
  }

  private buildSort(query: AnnotationHubQueryDto): HubSort {
    return { by: query.sortBy ?? 'createdAt', dir: query.sortDir ?? 'desc' };
  }
}
