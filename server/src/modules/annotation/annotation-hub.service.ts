import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type {
  AnnotationDeviceSyncInfo,
  AnnotationHubBookFacet,
  AnnotationHubItem,
  AnnotationHubOverview,
  AnnotationHubResponse,
  AnnotationHubStats,
  AnnotationPositionFormat,
  AnnotationPositionInfo,
  AnnotationSyncDetail,
} from '@bookorbit/types';
import { ANNOTATION_PURGE_PENDING_DEVICE_SYNC } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { LibraryService } from '../library/library.service';
import { foldActivityWeeks, longestQuietWeeks } from './annotation-stats.utils';
import { AnnotationConversionService } from './annotation-conversion.service';
import { AnnotationExportService, type AnnotationExportFormat, type AnnotationExportResult } from './annotation-export.service';
import { AnnotationSyncRepository } from './annotation-sync.repository';
import { AnnotationRepository, type HubAccess, type HubAnnotationRow, type HubFilters, type HubSort } from './annotation.repository';
import { DevicePositionRebuilderRegistry } from './device-position-rebuilder';
import type { AnnotationBulkDto, AnnotationExportQueryDto, AnnotationHubQueryDto } from './dto/annotation-hub.dto';

const BULK_EVENT = 'annotation.bulk';
const RETRY_EVENT = 'annotation.position_retry';
const DEFAULT_BOOK_FACET_LIMIT = 20;
/** The sparkline covers a year, and the shelf is a ranked preview, not the whole library. */
const ACTIVITY_WINDOW_DAYS = 371;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHELF_LIMIT = 12;

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
    private readonly rebuilderRegistry: DevicePositionRebuilderRegistry,
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
  ) {}

  // Highlights on books the user can no longer open (library access revoked, content rules) stay
  // stored but leave the hub, as they leave the Notebook; they come back with the access.
  private async access(user: RequestUser): Promise<HubAccess> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return { libraryIds, contentFilters: user.isSuperuser ? undefined : user.contentFilters };
  }

  private async findAccessible(user: RequestUser, annotationId: number) {
    const annotation = await this.syncRepo.findAnnotationById(annotationId, user.id);
    if (!annotation) throw new NotFoundException(`Annotation ${annotationId} not found`);
    await this.bookService.verifyBookAccess(annotation.bookId, user);
    return annotation;
  }

  async list(user: RequestUser, query: AnnotationHubQueryDto): Promise<AnnotationHubResponse> {
    const userId = user.id;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const filters = { ...this.buildFilters(query), access: await this.access(user) };
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

  /** Total annotations the hub lists by default; trashed rows are excluded. */
  async countActive(user: RequestUser): Promise<number> {
    return this.annotationRepo.countHub(user.id, { status: 'active', access: await this.access(user) });
  }

  /**
   * The library-wide facets behind the hub's side rail. Deliberately a separate call from
   * `list`: the stream is an infinite scroll, and recomputing six aggregates over every
   * annotation a user owns on each page of it is the one cost this page cannot carry.
   */
  async overview(user: RequestUser, query: AnnotationHubQueryDto): Promise<AnnotationHubOverview> {
    const userId = user.id;
    const access = await this.access(user);
    const filters = { ...this.buildFilters(query), access };
    const now = new Date();
    const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS);
    const [total, statsRow, colorRows, needsReview, trashed, shelfRows, weekRows, deviceRows] = await Promise.all([
      this.annotationRepo.countHub(userId, filters),
      this.annotationRepo.getHubStats(userId, filters),
      this.annotationRepo.getHubColorBreakdown(userId, filters),
      this.annotationRepo.countHubNeedsReview(userId, filters),
      this.annotationRepo.countHubTrashed(userId, access),
      this.annotationRepo.findHubBookFacets(userId, { status: filters.status, limit: SHELF_LIMIT, order: 'count', access }),
      this.annotationRepo.getHubActivityWeeks(userId, filters, since),
      this.annotationRepo.getHubDeviceSummary(userId, access),
    ]);

    const weeks = foldActivityWeeks(weekRows);
    const koboIds = deviceRows.filter((row) => row.source === 'kobo' && /^\d+$/.test(row.deviceId)).map((row) => Number(row.deviceId));
    const koboNames = await this.syncRepo.findKoboDeviceNames(koboIds);

    return {
      total,
      books: Number(statsRow?.books ?? 0),
      withNotes: Number(statsRow?.withNotes ?? 0),
      needsReview,
      trashed,
      originBreakdown: (
        [
          { origin: 'web', count: Number(statsRow?.web ?? 0) },
          { origin: 'koreader', count: Number(statsRow?.koreader ?? 0) },
          { origin: 'kobo', count: Number(statsRow?.kobo ?? 0) },
        ] as AnnotationHubOverview['originBreakdown']
      )
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count),
      colorBreakdown: colorRows.map((row) => ({ color: row.color, count: Number(row.count) })),
      shelf: shelfRows.map(toBookFacet),
      weeks,
      busiestWeek: weeks.reduce<AnnotationHubOverview['busiestWeek']>((best, week) => (best && best.count >= week.count ? best : week), null),
      longestQuietWeeks: longestQuietWeeks(weeks, now),
      devices: deviceRows.map((row) => ({
        source: row.source,
        deviceId: row.deviceId,
        deviceName: row.source === 'kobo' ? (koboNames.get(row.deviceId) ?? null) : null,
        annotations: Number(row.annotations),
        behind: Number(row.behind),
        lastSyncedAt: (row.lastSyncedAt ?? new Date()).toISOString(),
      })),
    };
  }

  async listBooks(
    user: RequestUser,
    params: { status: 'active' | 'trashed'; q?: string; limit?: number; selectedId?: number },
  ): Promise<AnnotationHubBookFacet[]> {
    const userId = user.id;
    const access = await this.access(user);
    const limit = params.limit ?? DEFAULT_BOOK_FACET_LIMIT;
    const rows = await this.annotationRepo.findHubBookFacets(userId, { status: params.status, q: params.q, limit, access });
    const facets = rows.map(toBookFacet);
    if (params.selectedId && !facets.some((facet) => facet.bookId === params.selectedId)) {
      const selected = await this.annotationRepo.findHubBookFacet(userId, params.status, params.selectedId, access);
      if (selected) facets.unshift(toBookFacet(selected));
    }
    return facets;
  }

  async bulk(user: RequestUser, dto: AnnotationBulkDto): Promise<{ affected: number }> {
    const userId = user.id;
    const startedAtMs = Date.now();
    const access = await this.access(user);
    let affected: number;
    if (dto.action === 'trash') {
      affected = await this.annotationRepo.bulkTrash(userId, dto.ids, access);
    } else if (dto.action === 'restore') {
      affected = await this.annotationRepo.bulkRestore(userId, dto.ids, access);
    } else if (dto.action === 'star' || dto.action === 'unstar') {
      affected = await this.annotationRepo.bulkSetStarred(userId, dto.ids, dto.action === 'star', access);
    } else {
      affected = await this.annotationRepo.bulkRestyle(userId, dto.ids, { color: dto.color, style: dto.style }, access);
    }
    this.logger.log(
      `[${BULK_EVENT}] [end] userId=${userId} action=${dto.action} requested=${dto.ids.length} affected=${affected} durationMs=${Date.now() - startedAtMs} - bulk annotation action applied`,
    );
    return { affected };
  }

  async restore(user: RequestUser, annotationId: number): Promise<AnnotationHubItem> {
    const userId = user.id;
    await this.findAccessible(user, annotationId);
    const restored = await this.annotationRepo.restore(annotationId, userId);
    if (!restored) throw new NotFoundException(`Annotation ${annotationId} not found in trash`);
    const row = await this.annotationRepo.findHubById(userId, annotationId);
    return this.toHubItem(
      row ?? {
        ...restored,
        cfi: null,
        cfiStatus: null,
        cfiExtras: null,
        bookTitle: null,
        author: null,
        jumpFileId: null,
        jumpFileFormat: null,
        pageno: null,
        xpointer: null,
      },
    );
  }

  /** Hard delete; blocked until every synced device acknowledged the deletion. */
  async purge(user: RequestUser, annotationId: number): Promise<void> {
    await this.findAccessible(user, annotationId);
    const result = await this.annotationRepo.purge(annotationId, user.id);
    if (result === 'not_found') throw new NotFoundException(`Annotation ${annotationId} not found in trash`);
    if (result === 'pending_device_sync') {
      throw new ConflictException({
        errorCode: ANNOTATION_PURGE_PENDING_DEVICE_SYNC,
        message: 'This annotation is still queued for deletion on a synced device. Sync the device first or keep it in trash.',
      });
    }
  }

  async export(user: RequestUser, query: AnnotationExportQueryDto, scopeLabel: string): Promise<AnnotationExportResult> {
    const userId = user.id;
    const format: AnnotationExportFormat = query.format ?? 'md';
    const rows = await this.annotationRepo.findHubAll(userId, { ...this.buildFilters(query), access: await this.access(user) });
    this.logger.log(
      `[annotation.export] [end] userId=${userId} format=${format} rows=${rows.length} scope="${sanitizeLogValue(scopeLabel)}" - annotations exported`,
    );
    return this.exportService.export(rows, format, scopeLabel);
  }

  async syncDetail(user: RequestUser, annotationId: number): Promise<AnnotationSyncDetail> {
    const userId = user.id;
    const annotation = await this.findAccessible(user, annotationId);

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
   * Resets a position to pending so converters recompute it. A canonical format is
   * rebuilt from the device position first, since the cfi backfill can only derive
   * cfi from an xpointer and has nothing to work from when that failed too. Formats
   * with no usable source recompute on that device type's next sync.
   */
  async retryPosition(user: RequestUser, annotationId: number, format: AnnotationPositionFormat): Promise<AnnotationSyncDetail> {
    const userId = user.id;
    const annotation = await this.findAccessible(user, annotationId);

    await this.syncRepo.updatePosition(annotationId, format, { status: 'pending', converterVersion: null });

    let rebuilt = false;
    let converted = 0;
    if (format === 'cfi' || format === 'xpointer') {
      const target = { id: annotationId, bookId: annotation.bookId, text: annotation.text };
      rebuilt = (await this.rebuilderRegistry.get()?.rebuildCanonicalPositions(userId, target))?.rebuilt ?? false;
      if (!rebuilt && format === 'cfi') converted = await this.conversionService.ensureCfiPositionsForBook(userId, annotation.bookId);
    }

    this.logger.log(
      `[${RETRY_EVENT}] [end] userId=${userId} annotationId=${annotationId} format=${format} rebuilt=${rebuilt} converted=${converted} - position retry applied`,
    );
    return this.syncDetail(user, annotationId);
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
      highlightedAt: (row.sourceCreatedAt ?? row.createdAt).toISOString(),
      createdAt: row.createdAt.toISOString(),
      bookTitle: row.bookTitle,
      author: row.author,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      jumpFileId: row.jumpFileId,
      jumpFileFormat: row.jumpFileFormat,
      pageno: row.pageno,
      starredAt: row.starredAt ? row.starredAt.toISOString() : null,
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
      needsReview: query.needsReview || undefined,
      status: query.status ?? 'active',
    };
  }

  private buildSort(query: AnnotationHubQueryDto): HubSort {
    return { by: query.sortBy ?? 'createdAt', dir: query.sortDir ?? 'desc' };
  }
}
