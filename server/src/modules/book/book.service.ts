import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, readdir, rm, stat, rename } from 'fs/promises';
import { inArray, type SQL } from 'drizzle-orm';

import { bookCoverDirPath, bookThumbnailPath, findPreferredBookCoverFileName } from '../../common/book-cover-storage';
import { MAX_BOOK_QUERY_OFFSET_ROWS, isBookQueryOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { formatSeriesIndex } from '../../common/utils/series-index-format.utils';
import { SeriesMembershipService } from '../../common/services/series-membership.service';
import { isDateKey, resolveTimeZone, toDateKeyInTimeZone, toTimeZoneStartOfDay } from '../../common/utils/timezone.utils';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractAudioMetadata } from '../metadata/extractors/audio.extractor';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseFb2File } from '../metadata/lib/fb2-parser';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile, type PdfParseWarning } from '../metadata/lib/pdf-parser';
import { basename, dirname, extname, join } from 'path';

import {
  BOOK_METADATA_LOCK_FIELDS,
  DEFAULT_DOWNLOAD_PATTERN,
  MetadataProviderKey,
  Permission,
  isAudioFormat,
  jumpBucketKindForSort,
  resolveUploadPath,
} from '@bookorbit/types';
import type {
  AudiobookChapter,
  BookCommunityRating,
  BookKoboState,
  BookMetadataRefreshPreviewFields,
  BookMetadataRefreshPreviewResponse,
  BookMetadataLockField,
  BookQuery,
  BookWriteAndRenameResult,
  BooksPage,
  FileRenameResult,
  JumpBucketsResponse,
  MetadataFetchDiagnostics,
  MetadataField,
  ReadStatus,
  UserBookStatus,
  WriteResult,
} from '@bookorbit/types';
import type { ContentFilterRules } from '@bookorbit/types';
import { assembleBookCards, assembleCollapsedBookCards } from './utils/assemble-book-cards';
import type { RequestUser } from '../../common/types/request-user';
import { UpdateBookFileDto } from './dto/update-book-file.dto';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { MetadataService } from '../metadata/metadata.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { LibraryService } from '../library/library.service';
import { books } from '../../db/schema';
import { MetadataFetchPipeline, ResolvedMetadataFields } from '../metadata-fetch/metadata-fetch-pipeline';
import type { MetadataSearchParams } from '../metadata-fetch/providers/metadata-search-params';
import { FileRenameService, RENAME_RELEVANT_FIELDS } from '../file-write/file-rename.service';
import { FileWriteService } from '../file-write/file-write.service';
import { NarratorService } from '../narrator/narrator.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED } from '../achievement/achievement-events.service';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { BookQueryBuilder } from './book-query-builder.service';
import { collapsedJumpBucketExpr, flatJumpBucketExpr } from './jump-bucket-expr';
import { BookRepository } from './book.repository';
import { ComicMetadataRepository } from '../metadata/comic-metadata.repository';
import { CustomMetadataService } from '../custom-metadata/custom-metadata.service';
import { BookDetailDto } from './dto/book-detail.dto';
import type { BulkMetadataField } from './dto/bulk-set-metadata.dto';
import type { BulkEditFieldsDto } from './dto/bulk-edit-metadata.dto';
import type { BulkSelectionDto } from '../../common/dto/bulk-selection.dto';
import type { MetadataExportDto, MetadataExportFormat, MetadataExportViewType } from './dto/metadata-export.dto';
import type { MetadataExportColumnMode } from './dto/metadata-export-options.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { UpsertAudioProgressDto } from './dto/upsert-audio-progress.dto';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';
import type { UpdateBookMetadataAndLocksDto } from './dto/update-book-metadata-and-locks.dto';
import { buildBookDetailSupplementalFields } from './utils/build-book-detail-supplemental-fields';
import type { SetStatusDto } from '../user-book-status/dto/set-status.dto';

const METADATA_UPDATE_FAILPOINTS = [
  'afterScalarUpdate',
  'afterSeriesMembershipsReplace',
  'afterComicMetadataUpsert',
  'afterAuthorsReplace',
  'afterNarratorsReplace',
  'afterGenresReplace',
  'afterTagsReplace',
  'beforeTransactionCommit',
] as const;

const METADATA_PROVIDER_KEY_SET = new Set<string>(Object.values(MetadataProviderKey));

export type MetadataUpdateFailpoint = (typeof METADATA_UPDATE_FAILPOINTS)[number];
export type ExportScope = 'primary' | 'all' | 'audio';

export type BulkEditFieldResult = { updated: number; skippedLocked: number };
export type BulkEditMetadataResult = {
  updatedBooks: number;
  fields: Record<string, BulkEditFieldResult>;
};
const BULK_METADATA_LOCK_FIELD_BY_FIELD: Record<BulkMetadataField, BookMetadataLockField> = {
  seriesName: 'seriesName',
  publisher: 'publisher',
  language: 'language',
  publishedYear: 'publishedYear',
  authors: 'authors',
  genres: 'genres',
  tags: 'tags',
  narrators: 'narrators',
};

const EXPORT_LIMITS = {
  MAX_BOOKS: 250,
  MAX_FILES: 2000,
  MAX_PROJECTED_BYTES: 8 * 1024 * 1024 * 1024,
  MAX_CONCURRENT_PER_USER: 2,
} as const;

type ExportCandidateFile = {
  bookId: number;
  absolutePath: string;
  format: string | null;
  sizeBytes: number | null;
  sortOrder?: number;
};

export type ExportPlan = {
  files: { absolutePath: string; zipPath: string; sizeBytes: number }[];
  projectedBytes: number;
  bookCount: number;
  scope: ExportScope;
};

const METADATA_EXPORT_SCHEMA_VERSION = 1 as const;

const METADATA_EXPORT_LIMITS = {
  MAX_ROWS: 100_000,
  MAX_ESTIMATED_BYTES: 120 * 1024 * 1024,
} as const;

type MetadataExportSizeCategory = 'small' | 'medium' | 'large';

type MetadataExportResolvedOptions = {
  includePersonalData: boolean;
  includeFilePaths: boolean;
  includeContextMeta: boolean;
  columnsMode: MetadataExportColumnMode;
  visibleColumns: string[];
  viewType: MetadataExportViewType;
};

type MetadataExportSelectionScope = 'selected' | 'all-matching';

type MetadataExportPreflight = {
  schemaVersion: number;
  rowCount: number;
  estimatedBytes: number;
  sizeCategory: MetadataExportSizeCategory;
  fileName: string;
  scope: MetadataExportSelectionScope;
  format: MetadataExportFormat;
};

type MetadataExportContextMeta = {
  exportedAt: string;
  exportedByUserId: number;
  viewType: MetadataExportViewType;
  scope: MetadataExportSelectionScope;
  format: MetadataExportFormat;
  rowCount: number;
  options: MetadataExportResolvedOptions;
  query?: {
    libraryId?: number;
    q?: string;
    sort?: { field: string; dir: string }[];
    filterApplied: boolean;
  };
};

type MetadataExportBuildResult = {
  preflight: MetadataExportPreflight;
  content: string;
  contentType: string;
  fileName: string;
};

type MetadataSaveResult = {
  book: BookDetailDto;
  write: WriteResult | null;
  libraryAutoWriteEnabled: boolean;
};

type LibraryWriteSettings = {
  fileWriteEnabled: boolean;
  fileRenameEnabled: boolean;
};

type LibraryWriteSettingsLookupResult = {
  settings: LibraryWriteSettings | null;
  writeFailure: WriteResult | null;
};

type PostMetadataSaveMode = 'sync' | 'schedule';

@Injectable()
export class BookService {
  private readonly logger = new Logger(BookService.name);
  private readonly appDataPath: string;
  private embeddingRun: Promise<void> | null = null;
  private metadataUpdateFailpoint: MetadataUpdateFailpoint | null = null;
  private readonly activeExportCounts = new Map<number, number>();

  constructor(
    private readonly bookRepo: BookRepository,
    private readonly libraryService: LibraryService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly metadataService: MetadataService,
    private readonly scoreService: MetadataScoreService,
    private readonly pipeline: MetadataFetchPipeline,
    private readonly config: ConfigService,
    private readonly appSettings: AppSettingsService,
    private readonly userBookStatusService: UserBookStatusService,
    private readonly narratorService: NarratorService,
    private readonly comicMetadataService: ComicMetadataRepository,
    private readonly customMetadataService: CustomMetadataService,
    private readonly bookMetadataLockService: BookMetadataLockService,
    @Optional() private readonly embedder: BookEmbedderService,
    @Optional() private readonly fileWriteService: FileWriteService,
    @Optional() private readonly fileRenameService: FileRenameService,
    @Optional() private readonly achievementEvents: AchievementEventsService,
    @Optional() private readonly seriesMemberships?: SeriesMembershipService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  private isSuperuser(user: RequestUser): boolean {
    return user.isSuperuser;
  }

  private hasPermission(user: RequestUser, permissionName: Permission): boolean {
    return user.isSuperuser || user.permissions.includes(permissionName);
  }

  private async checkBookPassesContentFilters(bookId: number, contentFilters: ContentFilterRules): Promise<boolean> {
    return this.bookRepo.checkBookPassesContentFilters(bookId, contentFilters);
  }

  private isMissingFilesystemEntry(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }

  private async verifyLibraryAccessForBookIds(bookIds: number[], user: RequestUser): Promise<{ id: number; libraryId: number }[]> {
    const uniqueBookIds = [...new Set(bookIds)];
    const rows = await this.bookRepo.findLibraryIdsByBookIds(uniqueBookIds);
    if (rows.length !== uniqueBookIds.length) {
      throw new NotFoundException('One or more books were not found');
    }
    const uniqueLibraryIds = [...new Set(rows.map((row) => row.libraryId))];
    const isSuperuser = this.isSuperuser(user);
    await Promise.all(uniqueLibraryIds.map((libraryId) => this.libraryService.verifyUserAccess(user.id, libraryId, isSuperuser)));
    return rows;
  }

  private collectExistingProviderIds(meta: {
    googleBooksId?: string | null;
    goodreadsId?: string | null;
    amazonId?: string | null;
    hardcoverId?: string | null;
    hardcoverEditionId?: string | null;
    openLibraryId?: string | null;
    itunesId?: string | null;
    audibleId?: string | null;
    koboId?: string | null;
    comicvineId?: string | null;
    ranobedbId?: string | null;
    lubimyczytacId?: string | null;
    aladinId?: string | null;
  }): Partial<Record<MetadataProviderKey, string>> {
    const providerIds: Partial<Record<MetadataProviderKey, string>> = {};
    if (meta.googleBooksId) providerIds[MetadataProviderKey.GOOGLE] = meta.googleBooksId;
    if (meta.goodreadsId) providerIds[MetadataProviderKey.GOODREADS] = meta.goodreadsId;
    if (meta.amazonId) providerIds[MetadataProviderKey.AMAZON] = meta.amazonId;
    if (meta.hardcoverId) providerIds[MetadataProviderKey.HARDCOVER] = meta.hardcoverId;
    if (meta.openLibraryId) providerIds[MetadataProviderKey.OPEN_LIBRARY] = meta.openLibraryId;
    if (meta.itunesId) providerIds[MetadataProviderKey.ITUNES] = meta.itunesId;
    if (meta.audibleId) providerIds[MetadataProviderKey.AUDIBLE] = meta.audibleId;
    if (meta.koboId) providerIds[MetadataProviderKey.KOBO] = meta.koboId;
    if (meta.comicvineId) providerIds[MetadataProviderKey.COMICVINE] = meta.comicvineId;
    if (meta.ranobedbId) providerIds[MetadataProviderKey.RANOBEDB] = meta.ranobedbId;
    if (meta.lubimyczytacId) providerIds[MetadataProviderKey.LUBIMYCZYTAC] = meta.lubimyczytacId;
    if (meta.aladinId) providerIds[MetadataProviderKey.ALADIN] = meta.aladinId;
    return providerIds;
  }

  private applyResolvedProviderIds(
    dto: Pick<
      UpdateBookMetadataDto,
      | 'googleBooksId'
      | 'goodreadsId'
      | 'amazonId'
      | 'hardcoverId'
      | 'hardcoverEditionId'
      | 'openLibraryId'
      | 'itunesId'
      | 'audibleId'
      | 'koboId'
      | 'comicvineId'
      | 'ranobedbId'
      | 'lubimyczytacId'
      | 'aladinId'
    >,
    providerIds: Partial<Record<MetadataProviderKey, string>>,
  ): void {
    if (providerIds[MetadataProviderKey.GOOGLE]) dto.googleBooksId = providerIds[MetadataProviderKey.GOOGLE];
    if (providerIds[MetadataProviderKey.GOODREADS]) dto.goodreadsId = providerIds[MetadataProviderKey.GOODREADS];
    if (providerIds[MetadataProviderKey.AMAZON]) dto.amazonId = providerIds[MetadataProviderKey.AMAZON];
    if (providerIds[MetadataProviderKey.HARDCOVER]) dto.hardcoverId = providerIds[MetadataProviderKey.HARDCOVER];
    if (providerIds[MetadataProviderKey.OPEN_LIBRARY]) dto.openLibraryId = providerIds[MetadataProviderKey.OPEN_LIBRARY];
    if (providerIds[MetadataProviderKey.ITUNES]) dto.itunesId = providerIds[MetadataProviderKey.ITUNES];
    if (providerIds[MetadataProviderKey.AUDIBLE]) dto.audibleId = providerIds[MetadataProviderKey.AUDIBLE];
    if (providerIds[MetadataProviderKey.KOBO]) dto.koboId = providerIds[MetadataProviderKey.KOBO];
    if (providerIds[MetadataProviderKey.COMICVINE]) dto.comicvineId = providerIds[MetadataProviderKey.COMICVINE];
    if (providerIds[MetadataProviderKey.RANOBEDB]) dto.ranobedbId = providerIds[MetadataProviderKey.RANOBEDB];
    if (providerIds[MetadataProviderKey.LUBIMYCZYTAC]) dto.lubimyczytacId = providerIds[MetadataProviderKey.LUBIMYCZYTAC];
    if (providerIds[MetadataProviderKey.ALADIN]) dto.aladinId = providerIds[MetadataProviderKey.ALADIN];
  }

  private buildMetadataRefreshPreview(
    resolved: ResolvedMetadataFields,
    providerIds: Partial<Record<MetadataProviderKey, string>>,
  ): BookMetadataRefreshPreviewFields {
    const r = resolved as Record<string, unknown>;
    const preview: BookMetadataRefreshPreviewFields = {};

    if (r.title !== undefined) preview.title = r.title as string | null;
    if (r.subtitle !== undefined) preview.subtitle = r.subtitle as string | null;
    if (r.description !== undefined) preview.description = r.description as string | null;
    if (r.authors !== undefined) preview.authors = r.authors as string[];
    if (r.genres !== undefined) preview.genres = r.genres as string[];
    if (r.publisher !== undefined) preview.publisher = r.publisher as string | null;
    if (r.publishedYear !== undefined) preview.publishedYear = r.publishedYear as number | null;
    if (r.language !== undefined) preview.language = r.language as string | null;
    if (r.pageCount !== undefined) preview.pageCount = r.pageCount as number | null;
    if (r.communityRatings !== undefined) preview.communityRatings = r.communityRatings as BookCommunityRating[];
    if (r.seriesName !== undefined) preview.seriesName = r.seriesName as string | null;
    if (r.seriesIndex !== undefined) preview.seriesIndex = r.seriesIndex as number | null;
    if (r.seriesMemberships !== undefined) preview.seriesMemberships = r.seriesMemberships as BookMetadataRefreshPreviewFields['seriesMemberships'];
    if (r.coverUrl !== undefined) preview.coverUrl = r.coverUrl as string;
    if (r.hardcoverEditionId !== undefined) preview.hardcoverEditionId = r.hardcoverEditionId as string | null;
    if (r.comicMetadata !== undefined) preview.comicMetadata = r.comicMetadata as BookMetadataRefreshPreviewFields['comicMetadata'];

    if (r.narrators !== undefined || r.duration !== undefined || r.abridged !== undefined || r.chapters !== undefined) {
      preview.audioMetadata = {};
      if (r.narrators !== undefined) preview.audioMetadata.narrators = r.narrators as string[];
      if (r.duration !== undefined) preview.audioMetadata.durationSeconds = r.duration as number | null;
      if (r.abridged !== undefined) preview.audioMetadata.abridged = r.abridged as boolean | null;
      if (r.chapters !== undefined) preview.audioMetadata.chapters = r.chapters as AudiobookChapter[];
    }

    this.applyResolvedProviderIds(preview, providerIds);
    return preview;
  }

  private buildMetadataRefreshPreviewDiagnostics(
    metadata: BookMetadataRefreshPreviewFields,
    diagnostics?: MetadataFetchDiagnostics,
  ): MetadataFetchDiagnostics {
    const resolvedFieldCount = Object.keys(metadata).length;
    const base = diagnostics ?? this.emptyMetadataFetchDiagnostics();
    return {
      ...base,
      resolvedFieldCount,
      reason: resolvedFieldCount > 0 ? null : base.reason,
    };
  }

  private emptyMetadataFetchDiagnostics(): MetadataFetchDiagnostics {
    return {
      reason: 'no_active_providers',
      activeProviders: [],
      fieldRuleProviders: [],
      disabledFieldRuleProviders: [],
      enabledUnreferencedProviders: [],
      throttledProviders: [],
      candidateProviders: [],
      candidateCount: 0,
      resolvedFieldCount: 0,
    };
  }

  private normalizeCommunityRatingInputs(
    ratings: UpdateBookMetadataDto['communityRatings'],
  ): Array<{ provider: MetadataProviderKey; rating: number; ratingCount: number | null }> | undefined {
    if (ratings === undefined) return undefined;
    if (!ratings?.length) return [];

    const byProvider = new Map<MetadataProviderKey, { provider: MetadataProviderKey; rating: number; ratingCount: number | null }>();
    for (const item of ratings) {
      if (!METADATA_PROVIDER_KEY_SET.has(item.provider)) continue;
      if (!Number.isFinite(item.rating) || item.rating < 0 || item.rating > 5) continue;

      const ratingCount =
        typeof item.ratingCount === 'number' && Number.isInteger(item.ratingCount) && item.ratingCount >= 0 ? item.ratingCount : null;
      byProvider.set(item.provider, { provider: item.provider, rating: item.rating, ratingCount });
    }

    return [...byProvider.values()];
  }

  private mapCommunityRatingRows(
    rows: readonly { provider: string; rating: number; ratingCount: number | null; updatedAt: Date | null }[],
  ): BookCommunityRating[] {
    return rows
      .filter((row): row is { provider: MetadataProviderKey; rating: number; ratingCount: number | null; updatedAt: Date | null } =>
        METADATA_PROVIDER_KEY_SET.has(row.provider),
      )
      .map((row) => ({
        provider: row.provider,
        rating: row.rating,
        ratingCount: row.ratingCount,
        updatedAt: row.updatedAt?.toISOString() ?? null,
      }));
  }

  async verifyBookAccess(bookId: number, user: RequestUser): Promise<void> {
    const libraryId = await this.bookRepo.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user));

    if (!this.isSuperuser(user) && user.contentFilters) {
      const passes = await this.checkBookPassesContentFilters(bookId, user.contentFilters);
      if (!passes) throw new NotFoundException(`Book ${bookId} not found`);
    }
  }

  async verifyFileAccess(fileId: number, user: RequestUser): Promise<NonNullable<Awaited<ReturnType<BookRepository['findFileById']>>>> {
    const file = await this.bookRepo.findFileById(fileId);
    if (!file) throw new NotFoundException(`No file with id ${fileId}`);
    await this.libraryService.verifyUserAccess(user.id, file.libraryId, this.isSuperuser(user));

    if (!this.isSuperuser(user) && user.contentFilters) {
      const passes = await this.checkBookPassesContentFilters(file.bookId, user.contentFilters);
      if (!passes) throw new NotFoundException(`No file with id ${fileId}`);
    }

    return file;
  }

  async resolveSelectionToIds(dto: BulkSelectionDto, user: RequestUser): Promise<number[]> {
    if (dto.bookIds && dto.query) {
      throw new BadRequestException('bookIds and query are mutually exclusive');
    }
    if (dto.bookIds) {
      await this.verifyLibraryAccessForBookIds(dto.bookIds, user);
      return dto.bookIds;
    }
    if (dto.query) {
      const libs = await this.libraryService.findAll(user);
      let accessibleLibraryIds = libs.map((l) => l.id);
      const timeZone = this.resolveUserTimeZone(user);
      if (dto.query.libraryId !== undefined) {
        if (!accessibleLibraryIds.includes(dto.query.libraryId)) {
          throw new ForbiddenException(`Library ${dto.query.libraryId} is not accessible`);
        }
        accessibleLibraryIds = [dto.query.libraryId];
      }
      const where = this.queryBuilder.buildWhere(dto.query.filter, {
        accessibleLibraryIds,
        implicitLibraryId: dto.query.libraryId,
        userId: user.id,
        q: dto.query.q,
        timeZone,
        contentFilters: this.isSuperuser(user) ? undefined : user.contentFilters,
      });
      return this.bookRepo.findIdsByWhere(where);
    }
    throw new BadRequestException('Either bookIds or query must be provided');
  }

  acquireExportSlot(userId: number): () => void {
    const current = this.activeExportCounts.get(userId) ?? 0;
    if (current >= EXPORT_LIMITS.MAX_CONCURRENT_PER_USER) {
      throw new HttpException(
        `Too many concurrent exports. Limit is ${EXPORT_LIMITS.MAX_CONCURRENT_PER_USER} active exports per user.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeExportCounts.set(userId, current + 1);
    let released = false;

    return () => {
      if (released) return;
      released = true;
      const next = (this.activeExportCounts.get(userId) ?? 1) - 1;
      if (next <= 0) {
        this.activeExportCounts.delete(userId);
      } else {
        this.activeExportCounts.set(userId, next);
      }
    };
  }

  private resolveMetadataExportOptions(dto: MetadataExportDto): MetadataExportResolvedOptions {
    return {
      includePersonalData: dto.options?.includePersonalData ?? false,
      includeFilePaths: dto.options?.includeFilePaths ?? false,
      includeContextMeta: dto.options?.includeContextMeta ?? true,
      columnsMode: dto.options?.columnsMode ?? 'canonical',
      visibleColumns: dto.options?.visibleColumns ?? [],
      viewType: dto.viewType ?? 'library',
    };
  }

  private resolveMetadataExportScope(dto: BulkSelectionDto): MetadataExportSelectionScope {
    return dto.query ? 'all-matching' : 'selected';
  }

  private resolveMetadataExportFileName(viewType: MetadataExportViewType, scope: MetadataExportSelectionScope, format: MetadataExportFormat): string {
    const date = new Date().toISOString().slice(0, 10);
    return `bookorbit-${viewType}-${scope}-${date}.${format}`;
  }

  private estimateMetadataExportBytes(rowCount: number, format: MetadataExportFormat, options: MetadataExportResolvedOptions): number {
    const basePerRow = format === 'json' ? 1150 : 520;
    const personalExtra = options.includePersonalData ? 160 : 0;
    const pathExtra = options.includeFilePaths ? 260 : 0;
    const contextExtra = options.includeContextMeta ? 2200 : 0;
    return Math.max(0, rowCount * (basePerRow + personalExtra + pathExtra) + contextExtra);
  }

  private resolveMetadataExportSizeCategory(estimatedBytes: number): MetadataExportSizeCategory {
    if (estimatedBytes < 5 * 1024 * 1024) return 'small';
    if (estimatedBytes < 25 * 1024 * 1024) return 'medium';
    return 'large';
  }

  private normalizeExportSort(sort: unknown): BookQuery['sort'] {
    if (!Array.isArray(sort)) return [];
    return sort
      .map((entry) => {
        const field =
          typeof (entry as { field?: unknown })?.field === 'string'
            ? ((entry as { field: string }).field as BookQuery['sort'][number]['field'])
            : null;
        const dir =
          typeof (entry as { dir?: unknown })?.dir === 'string' ? ((entry as { dir: string }).dir as BookQuery['sort'][number]['dir']) : null;
        if (!field || !dir) return null;
        if (dir !== 'asc' && dir !== 'desc') return null;
        return { field, dir };
      })
      .filter((entry): entry is BookQuery['sort'][number] => entry !== null);
  }

  private async resolveMetadataExportRows(
    dto: MetadataExportDto,
    user: RequestUser,
  ): Promise<{
    rows: BooksPage['items'];
    rowCount: number;
    scope: MetadataExportSelectionScope;
    queryMeta?: MetadataExportContextMeta['query'];
  }> {
    if (dto.query) {
      const libraries = await this.libraryService.findAll(user);
      let accessibleLibraryIds = libraries.map((library) => library.id);
      const timeZone = this.resolveUserTimeZone(user);
      if (dto.query.libraryId !== undefined) {
        if (!accessibleLibraryIds.includes(dto.query.libraryId)) {
          throw new ForbiddenException(`Library ${dto.query.libraryId} is not accessible`);
        }
        accessibleLibraryIds = [dto.query.libraryId];
      }
      const where = this.queryBuilder.buildWhere(dto.query.filter, {
        accessibleLibraryIds,
        implicitLibraryId: dto.query.libraryId,
        userId: user.id,
        q: dto.query.q,
        timeZone,
      });
      const rowCount = await this.bookRepo.countWhere(where);
      if (rowCount === 0) throw new BadRequestException('No books matched export selection');
      if (rowCount > METADATA_EXPORT_LIMITS.MAX_ROWS) {
        throw new BadRequestException(`Too many rows selected for metadata export. Limit is ${METADATA_EXPORT_LIMITS.MAX_ROWS}.`);
      }
      const sort = this.normalizeExportSort(dto.query.sort);
      const page = await this.executeBooksQuery(user.id, where, {
        filter: dto.query.filter,
        sort,
        pagination: { page: 0, size: rowCount },
        q: dto.query.q,
      });
      return {
        rows: page.items,
        rowCount,
        scope: 'all-matching',
        queryMeta: {
          libraryId: dto.query.libraryId,
          q: dto.query.q,
          sort: sort.map((spec) => ({ field: spec.field, dir: spec.dir })),
          filterApplied: !!dto.query.filter,
        },
      };
    }

    const uniqueIds = [...new Set(dto.bookIds ?? [])];
    if (uniqueIds.length === 0) throw new BadRequestException('No books selected for metadata export');
    if (uniqueIds.length > METADATA_EXPORT_LIMITS.MAX_ROWS) {
      throw new BadRequestException(`Too many rows selected for metadata export. Limit is ${METADATA_EXPORT_LIMITS.MAX_ROWS}.`);
    }
    const rows = await this.verifyLibraryAccessForBookIds(uniqueIds, user);
    const foundIds = new Set(rows.map((row) => row.id));
    const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(`Some selected books were not found: ${missingIds.join(', ')}`);
    }

    const sort = this.normalizeExportSort(dto.sort);
    const page = await this.executeBooksQuery(user.id, inArray(books.id, uniqueIds), {
      filter: undefined,
      sort,
      pagination: { page: 0, size: uniqueIds.length },
    });
    return {
      rows: page.items,
      rowCount: page.items.length,
      scope: 'selected',
    };
  }

  private async resolveMetadataExportSelectionCount(
    dto: MetadataExportDto,
    user: RequestUser,
  ): Promise<{
    rowCount: number;
    scope: MetadataExportSelectionScope;
  }> {
    if (dto.query) {
      const libraries = await this.libraryService.findAll(user);
      let accessibleLibraryIds = libraries.map((library) => library.id);
      const timeZone = this.resolveUserTimeZone(user);
      if (dto.query.libraryId !== undefined) {
        if (!accessibleLibraryIds.includes(dto.query.libraryId)) {
          throw new ForbiddenException(`Library ${dto.query.libraryId} is not accessible`);
        }
        accessibleLibraryIds = [dto.query.libraryId];
      }
      const where = this.queryBuilder.buildWhere(dto.query.filter, {
        accessibleLibraryIds,
        implicitLibraryId: dto.query.libraryId,
        userId: user.id,
        q: dto.query.q,
        timeZone,
      });
      const rowCount = await this.bookRepo.countWhere(where);
      if (rowCount === 0) throw new BadRequestException('No books matched export selection');
      return { rowCount, scope: 'all-matching' };
    }

    const uniqueIds = [...new Set(dto.bookIds ?? [])];
    if (uniqueIds.length === 0) throw new BadRequestException('No books selected for metadata export');
    await this.verifyLibraryAccessForBookIds(uniqueIds, user);
    const rows = await this.bookRepo.findLibraryIdsByBookIds(uniqueIds);
    const foundIds = new Set(rows.map((row) => row.id));
    const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(`Some selected books were not found: ${missingIds.join(', ')}`);
    }
    return { rowCount: uniqueIds.length, scope: 'selected' };
  }

  private resolveVisibleExportKeys(visibleColumns: string[], options: MetadataExportResolvedOptions): string[] {
    const keyMap: Record<string, string[]> = {
      title: ['title'],
      subtitle: ['subtitle'],
      authors: ['authors'],
      seriesName: ['seriesName'],
      seriesIndex: ['seriesIndex'],
      publishedYear: ['publishedYear'],
      language: ['language'],
      genres: ['genres'],
      tags: ['tags'],
      narrators: ['narrators'],
      publisher: ['publisher'],
      pageCount: ['pageCount'],
      isbn13: ['isbn13'],
      metadataScore: ['metadataScore'],
      addedAt: ['addedAt'],
      updatedAt: ['updatedAt'],
      format: ['primaryFormat', 'formats'],
      fileSize: ['totalFileSizeBytes'],
      rating: ['rating'],
      readingProgress: ['readProgress'],
      finishedAt: ['readFinishedAt'],
      readStatus: ['readStatus'],
    };
    const required = ['bookId', 'libraryId', 'libraryName'];
    const resolved = new Set<string>(required);
    for (const columnId of visibleColumns) {
      for (const key of keyMap[columnId] ?? []) {
        resolved.add(key);
      }
    }
    if (options.includeFilePaths) {
      resolved.add('folderPath');
      resolved.add('filePaths');
    }
    return [...resolved];
  }

  private resolveCanonicalExportKeys(options: MetadataExportResolvedOptions, customKeys: string[] = []): string[] {
    const keys = [
      'bookId',
      'libraryId',
      'libraryName',
      'status',
      'title',
      'subtitle',
      'authors',
      'seriesName',
      'seriesIndex',
      'publishedYear',
      'language',
      'publisher',
      'pageCount',
      'isbn13',
      'hardcoverId',
      'hardcoverEditionId',
      'genres',
      'tags',
      'narrators',
      'metadataScore',
      'hasCover',
      'hasMetadataLocks',
      'lockedFields',
      'addedAt',
      'updatedAt',
      'fileCount',
      'primaryFormat',
      'formats',
      'totalFileSizeBytes',
      'rating',
      'readProgress',
      'readStatus',
      'readStartedAt',
      'readFinishedAt',
      'readUpdatedAt',
      ...customKeys,
    ];
    if (!options.includePersonalData) {
      // Keep schema stable by retaining personal-data fields but emitting null values.
    }
    if (options.includeFilePaths) {
      keys.push('folderPath', 'filePaths');
    }
    return keys;
  }

  private csvCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  private projectExportRow(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const projected: Record<string, unknown> = {};
    for (const key of keys) projected[key] = record[key];
    return projected;
  }

  private serializeCsvRows(rows: Record<string, unknown>[], keys: string[], meta: MetadataExportContextMeta, includeContextMeta: boolean): string {
    const lines: string[] = ['\uFEFF'];
    if (includeContextMeta) {
      lines.push(`# schemaVersion=${METADATA_EXPORT_SCHEMA_VERSION}`);
      lines.push(`# exportedAt=${meta.exportedAt}`);
      lines.push(`# viewType=${meta.viewType}`);
      lines.push(`# scope=${meta.scope}`);
      lines.push(`# rowCount=${meta.rowCount}`);
    }
    lines.push(keys.join(','));
    for (const row of rows) {
      const values = keys.map((key) => {
        const value = row[key];
        if (Array.isArray(value)) return this.csvCell(value.join('; '));
        if (value !== null && typeof value === 'object') return this.csvCell(JSON.stringify(value));
        return this.csvCell(value as string | number | boolean | null | undefined);
      });
      lines.push(values.join(','));
    }
    return lines.join('\n');
  }

  async getMetadataExportPreflight(dto: MetadataExportDto, user: RequestUser): Promise<MetadataExportPreflight> {
    const options = this.resolveMetadataExportOptions(dto);
    const { rowCount, scope } = await this.resolveMetadataExportSelectionCount(dto, user);
    if (rowCount > METADATA_EXPORT_LIMITS.MAX_ROWS) {
      throw new BadRequestException(`Too many rows selected for metadata export. Limit is ${METADATA_EXPORT_LIMITS.MAX_ROWS}.`);
    }
    const estimatedBytes = this.estimateMetadataExportBytes(rowCount, dto.format, options);
    if (estimatedBytes > METADATA_EXPORT_LIMITS.MAX_ESTIMATED_BYTES) {
      throw new BadRequestException(
        `Metadata export is too large. Estimated size exceeds ${METADATA_EXPORT_LIMITS.MAX_ESTIMATED_BYTES} bytes. Refine your filters.`,
      );
    }
    return {
      schemaVersion: METADATA_EXPORT_SCHEMA_VERSION,
      rowCount,
      estimatedBytes,
      sizeCategory: this.resolveMetadataExportSizeCategory(estimatedBytes),
      fileName: this.resolveMetadataExportFileName(options.viewType, scope, dto.format),
      scope,
      format: dto.format,
    };
  }

  async buildMetadataExport(dto: MetadataExportDto, user: RequestUser): Promise<MetadataExportBuildResult> {
    const options = this.resolveMetadataExportOptions(dto);
    const { rows, rowCount, scope, queryMeta } = await this.resolveMetadataExportRows(dto, user);
    const estimatedBytes = this.estimateMetadataExportBytes(rowCount, dto.format, options);
    if (estimatedBytes > METADATA_EXPORT_LIMITS.MAX_ESTIMATED_BYTES) {
      throw new BadRequestException(
        `Metadata export is too large. Estimated size exceeds ${METADATA_EXPORT_LIMITS.MAX_ESTIMATED_BYTES} bytes. Refine your filters.`,
      );
    }
    const preflight: MetadataExportPreflight = {
      schemaVersion: METADATA_EXPORT_SCHEMA_VERSION,
      rowCount,
      estimatedBytes,
      sizeCategory: this.resolveMetadataExportSizeCategory(estimatedBytes),
      fileName: this.resolveMetadataExportFileName(options.viewType, scope, dto.format),
      scope,
      format: dto.format,
    };
    const bookIds = rows.map((row) => row.id);
    const [libraryRows, libraries, filePathRows, customValuesByBookId] = await Promise.all([
      this.bookRepo.findLibraryIdsByBookIds(bookIds),
      this.libraryService.findAll(user),
      options.includeFilePaths ? this.bookRepo.findAllFilesByBookIds(bookIds) : Promise.resolve([]),
      this.customMetadataService.getExportValues(bookIds),
    ]);

    const libraryIdByBookId = new Map(libraryRows.map((row) => [row.id, row.libraryId]));
    const libraryNameById = new Map(libraries.map((library) => [library.id, library.name]));
    const filePathsByBookId = new Map<number, string[]>();
    for (const file of filePathRows) {
      const byBook = filePathsByBookId.get(file.bookId) ?? [];
      byBook.push(file.absolutePath);
      filePathsByBookId.set(file.bookId, byBook);
    }

    const records = rows.map((row) => {
      const libraryId = libraryIdByBookId.get(row.id) ?? null;
      const primaryFile = row.files.find((file) => file.role === 'primary') ?? row.files[0] ?? null;
      const formats = [...new Set(row.files.map((file) => file.format).filter((format): format is string => !!format))];
      const totalFileSizeBytes = row.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
      const readStatus = options.includePersonalData ? (row.readStatus?.status ?? null) : null;
      const readStartedAt = options.includePersonalData ? (row.readStatus?.startedAt ?? null) : null;
      const readFinishedAt = options.includePersonalData ? (row.readStatus?.finishedAt ?? null) : null;
      const readUpdatedAt = options.includePersonalData ? (row.readStatus?.updatedAt ?? null) : null;
      const rating = options.includePersonalData ? (row.rating ?? null) : null;
      const readProgress = options.includePersonalData ? (row.readingProgress ?? null) : null;
      const filePaths = options.includeFilePaths ? (filePathsByBookId.get(row.id) ?? []) : [];
      const folderPath = options.includeFilePaths && filePaths.length > 0 ? dirname(filePaths[0]!) : null;
      const customValues = customValuesByBookId.get(row.id) ?? {};

      return {
        bookId: row.id,
        libraryId,
        libraryName: libraryId !== null ? (libraryNameById.get(libraryId) ?? null) : null,
        status: row.status,
        title: row.title,
        subtitle: row.subtitle,
        authors: row.authors,
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        publishedYear: row.publishedYear,
        language: row.language,
        publisher: row.publisher,
        pageCount: row.pageCount,
        isbn13: row.isbn13,
        hardcoverId: row.hardcoverId ?? null,
        hardcoverEditionId: row.hardcoverEditionId ?? null,
        genres: row.genres,
        tags: row.tags,
        narrators: row.narrators,
        metadataScore: row.metadataScore,
        hasCover: row.hasCover,
        hasMetadataLocks: row.hasMetadataLocks,
        lockedFields: row.lockedFields,
        addedAt: row.addedAt,
        updatedAt: row.updatedAt,
        fileCount: row.files.length,
        primaryFormat: primaryFile?.format ?? null,
        formats,
        totalFileSizeBytes,
        rating,
        readProgress,
        readStatus,
        readStartedAt,
        readFinishedAt,
        readUpdatedAt,
        folderPath,
        filePaths,
        files: row.files.map((file) => ({
          id: file.id,
          format: file.format,
          role: file.role,
          sizeBytes: file.sizeBytes,
        })),
        ...customValues,
      } as Record<string, unknown>;
    });

    const customExportKeys = [...new Set(records.flatMap((record) => Object.keys(record).filter((key) => key.startsWith('custom.'))))].sort();
    const exportKeys =
      options.columnsMode === 'visible'
        ? this.resolveVisibleExportKeys(options.visibleColumns, options)
        : this.resolveCanonicalExportKeys(options, customExportKeys);
    const projected = records.map((record) => this.projectExportRow(record, exportKeys));
    const contextMeta: MetadataExportContextMeta = {
      exportedAt: new Date().toISOString(),
      exportedByUserId: user.id,
      viewType: options.viewType,
      scope,
      format: dto.format,
      rowCount,
      options,
      query: queryMeta,
    };

    if (dto.format === 'json') {
      const payload: { schemaVersion: number; items: Record<string, unknown>[]; meta?: MetadataExportContextMeta } = {
        schemaVersion: METADATA_EXPORT_SCHEMA_VERSION,
        items: projected,
      };
      if (options.includeContextMeta) {
        payload.meta = contextMeta;
      }
      const content = JSON.stringify(payload, null, 2);
      return {
        preflight,
        content,
        contentType: 'application/json; charset=utf-8',
        fileName: preflight.fileName,
      };
    }

    const content = this.serializeCsvRows(projected, exportKeys, contextMeta, options.includeContextMeta);
    return {
      preflight,
      content,
      contentType: 'text/csv; charset=utf-8',
      fileName: preflight.fileName,
    };
  }

  private assertPaginationWindow(page: number, size: number): void {
    if (!isBookQueryOffsetWithinLimit(page * size)) {
      throw new BadRequestException(`pagination window is too deep; page * size must be <= ${MAX_BOOK_QUERY_OFFSET_ROWS}`);
    }
  }

  async queryForLibrary(user: RequestUser, libraryId: number, query: BookQuery): Promise<BooksPage> {
    this.assertPaginationWindow(query.pagination.page, query.pagination.size);
    await this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user));
    const timeZone = this.resolveUserTimeZone(user);
    const where = this.queryBuilder.buildWhere(query.filter, {
      accessibleLibraryIds: [libraryId],
      implicitLibraryId: libraryId,
      userId: user.id,
      q: query.q,
      timeZone,
      contentFilters: this.isSuperuser(user) ? undefined : user.contentFilters,
    });
    return this.executeBooksQuery(user.id, where, query);
  }

  async globalQuery(user: RequestUser, query: BookQuery): Promise<BooksPage> {
    this.assertPaginationWindow(query.pagination.page, query.pagination.size);
    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = libs.map((l) => l.id);
    const timeZone = this.resolveUserTimeZone(user);
    const where = this.queryBuilder.buildWhere(query.filter, {
      accessibleLibraryIds,
      userId: user.id,
      q: query.q,
      timeZone,
      contentFilters: this.isSuperuser(user) ? undefined : user.contentFilters,
    });
    return this.executeBooksQuery(user.id, where, query);
  }

  async executeBooksQuery(userId: number, where: SQL | undefined, query: BookQuery): Promise<BooksPage> {
    const start = Date.now();
    const { page, size } = query.pagination;
    const shouldCollapse = query.collapseSeries === true && !BookQueryBuilder.hasSeriesFilter(query.filter);

    if (shouldCollapse) {
      const { rows, authorRows, fileRows, genreRows, tagRows, progressRows, statusRows, narratorRows, seriesMembershipRows, total } =
        await this.bookRepo.findCardsCollapsed({
          where,
          sort: query.sort,
          limit: size,
          offset: page * size,
          userId,
        });
      const result = {
        items: assembleCollapsedBookCards(
          rows,
          authorRows,
          fileRows,
          genreRows,
          progressRows,
          statusRows,
          narratorRows,
          tagRows,
          seriesMembershipRows,
        ),
        total,
        page,
        size,
      };
      const durationMs = Date.now() - start;
      if (durationMs >= 500) {
        this.logger.warn(
          `[book.list_query] [end] userId=${userId} page=${page} size=${size} filterCount=${query.filter?.rules?.length ?? 0} sortFields=${query.sort?.length ?? 0} collapseSeries=true resultCount=${result.items.length} durationMs=${durationMs} - slow query`,
        );
      }
      return result;
    }

    const orderBy = this.queryBuilder.buildOrderBy(query.sort, userId);
    const { rows, authorRows, fileRows, genreRows, tagRows, progressRows, statusRows, narratorRows, seriesMembershipRows, total } =
      await this.bookRepo.findCards({
        where,
        orderBy,
        limit: size,
        offset: page * size,
        userId,
      });
    const result = {
      items: assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows, seriesMembershipRows),
      total,
      page,
      size,
    };
    const durationMs = Date.now() - start;
    if (durationMs >= 500) {
      this.logger.warn(
        `[book.list_query] [end] userId=${userId} page=${page} size=${size} filterCount=${query.filter?.rules?.length ?? 0} sortFields=${query.sort?.length ?? 0} collapseSeries=false resultCount=${result.items.length} durationMs=${durationMs} - slow query`,
      );
    }
    return result;
  }

  async queryJumpBucketsForLibrary(user: RequestUser, libraryId: number, query: BookQuery): Promise<JumpBucketsResponse> {
    await this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user));
    const timeZone = this.resolveUserTimeZone(user);
    const where = this.queryBuilder.buildWhere(query.filter, {
      accessibleLibraryIds: [libraryId],
      implicitLibraryId: libraryId,
      userId: user.id,
      q: query.q,
      timeZone,
      contentFilters: this.isSuperuser(user) ? undefined : user.contentFilters,
    });
    return this.executeJumpBucketsQuery(user.id, where, query);
  }

  async executeJumpBucketsQuery(userId: number, where: SQL | undefined, query: BookQuery): Promise<JumpBucketsResponse> {
    const event = 'book.jump_buckets';
    const kind = jumpBucketKindForSort(query.sort);
    const primaryField = (query.sort[0] ?? { field: 'title', dir: 'asc' }).field;
    const shouldCollapse = query.collapseSeries === true && !BookQueryBuilder.hasSeriesFilter(query.filter);
    const bucketExpr = shouldCollapse ? collapsedJumpBucketExpr(primaryField) : flatJumpBucketExpr(primaryField);
    if (!kind || !bucketExpr) throw new BadRequestException('jump buckets are not available for this sort');

    const start = Date.now();
    try {
      const response = shouldCollapse
        ? await this.bookRepo.findJumpBucketsCollapsed({ where, bucketExpr, sort: query.sort, userId })
        : await this.bookRepo.findJumpBuckets({ where, bucketExpr, orderBy: this.queryBuilder.buildOrderBy(query.sort, userId) });
      this.logger.log(
        `[${event}] [end] userId=${userId} kind=${kind} collapse=${shouldCollapse} durationMs=${Date.now() - start} bucketCount=${response.buckets.length} total=${response.total} - jump buckets computed`,
      );
      return response;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${userId} kind=${kind} collapse=${shouldCollapse} durationMs=${Date.now() - start} errorClass=${errorClass} error="${errorMessage}" - jump buckets failed`,
      );
      throw err;
    }
  }

  async getCoverPath(id: number, user: RequestUser): Promise<string | null> {
    const event = 'book.get_cover_path';
    await this.verifyBookAccess(id, user);
    const dir = bookCoverDirPath(this.appDataPath, id);
    try {
      const files = await readdir(dir);
      const cover = findPreferredBookCoverFileName(files);
      return cover ? join(dir, cover) : null;
    } catch (err) {
      if (this.isMissingFilesystemEntry(err)) return null;
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      const pathValue = sanitizeLogValue(dir);
      this.logger.warn(
        `[${event}] [fail] bookId=${id} userId=${user.id} path="${pathValue}" errorClass=${errorClass} error="${errorMessage}" - get cover path failed`,
      );
      throw err;
    }
  }

  async getThumbnailPath(id: number, user: RequestUser): Promise<string | null> {
    const event = 'book.get_thumbnail_path';
    await this.verifyBookAccess(id, user);
    const path = bookThumbnailPath(this.appDataPath, id);
    try {
      await access(path);
      return path;
    } catch (err) {
      if (this.isMissingFilesystemEntry(err)) return null;
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      const pathValue = sanitizeLogValue(path);
      this.logger.warn(
        `[${event}] [fail] bookId=${id} userId=${user.id} path="${pathValue}" errorClass=${errorClass} error="${errorMessage}" - get thumbnail path failed`,
      );
      throw err;
    }
  }

  private sanitizeFilenameSegment(raw: string, fallback = 'download'): string {
    const fallbackSafe =
      fallback
        .replace(/[/\\:*?"<>|\0]/g, '_')
        .trim()
        .slice(0, 255) || 'download';
    const cleaned = raw
      .replace(/[/\\:*?"<>|\0]/g, '_')
      .trim()
      .slice(0, 255);
    if (!cleaned || cleaned === '.' || cleaned === '..') return fallbackSafe;
    return cleaned;
  }

  private sanitizeZipPath(rawPath: string, fallbackFilename: string): string {
    const segments = rawPath
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .map((segment) => this.sanitizeFilenameSegment(segment));
    if (segments.length === 0) return this.sanitizeFilenameSegment(fallbackFilename);
    return segments.join('/');
  }

  private withSuffix(path: string, suffix: number): string {
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = name.lastIndexOf('.');
    if (dot > 0) return `${dir}${name.slice(0, dot)} (${suffix})${name.slice(dot)}`;
    return `${dir}${name} (${suffix})`;
  }

  private makeUniqueZipPath(path: string, used: Set<string>): string {
    if (!used.has(path)) {
      used.add(path);
      return path;
    }
    let suffix = 2;
    let candidate = this.withSuffix(path, suffix);
    while (used.has(candidate)) {
      suffix += 1;
      candidate = this.withSuffix(path, suffix);
    }
    used.add(candidate);
    return candidate;
  }

  private buildDownloadPatternTokens(
    absolutePath: string,
    format: string | null,
    meta?: Awaited<ReturnType<BookRepository['findPatternMetadataByBookIds']>>[number],
  ): Record<string, string> {
    const pathExtension = extname(absolutePath).toLowerCase().slice(1);
    const extension = pathExtension || (format && format !== 'unknown' ? format : 'bin');
    const stem = basename(absolutePath, extname(absolutePath));
    const tokens: Record<string, string> = { originalFilename: stem, extension };

    if (!meta) return tokens;
    if (meta.title) tokens['title'] = meta.title;
    if (meta.subtitle) tokens['subtitle'] = meta.subtitle;
    if (meta.publisher) tokens['publisher'] = meta.publisher;
    if (meta.language) tokens['language'] = meta.language;
    if (meta.isbn13) tokens['isbn'] = meta.isbn13;
    if (meta.publishedYear) tokens['year'] = String(meta.publishedYear);
    if (meta.seriesName) tokens['series'] = meta.seriesName;

    const seriesIndex = formatSeriesIndex(meta.seriesIndex);
    if (seriesIndex) tokens['seriesIndex'] = seriesIndex;
    if (meta.authors.length > 0) tokens['authors'] = meta.authors.join(', ');

    return tokens;
  }

  private async resolveDownloadFilenameForFile(file: { bookId: number; absolutePath: string; format: string | null }): Promise<string> {
    const originalFilename = basename(file.absolutePath);
    try {
      const [pattern, metaRows] = await Promise.all([
        this.appSettings.getDownloadPattern(),
        this.bookRepo.findPatternMetadataByBookIds([file.bookId]),
      ]);
      const tokens = this.buildDownloadPatternTokens(file.absolutePath, file.format, metaRows[0]);
      const resolvedPath = resolveUploadPath(pattern || DEFAULT_DOWNLOAD_PATTERN, tokens, tokens.extension);
      const resolvedName = resolvedPath?.split('/').filter(Boolean).pop() ?? null;
      return this.sanitizeFilenameSegment(resolvedName ?? originalFilename, originalFilename);
    } catch (err) {
      const event = 'book.resolve_download_filename';
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${file.bookId} errorClass=${errorClass} error="${errorMessage}" - download filename pattern resolution failed`,
      );
      return this.sanitizeFilenameSegment(originalFilename, originalFilename);
    }
  }

  async getFileInfo(
    fileId: number,
    user: RequestUser,
  ): Promise<{ path: string; size: number; format: string; bookId: number; originalFilename: string }> {
    const file = await this.verifyFileAccess(fileId, user);
    let size: number;
    try {
      ({ size } = await stat(file.absolutePath));
    } catch (err) {
      if (this.isMissingFilesystemEntry(err)) {
        throw new NotFoundException(`File ${fileId} not found on disk`);
      }
      throw err;
    }
    const originalFilename = basename(file.absolutePath);
    return { path: file.absolutePath, size, format: file.format ?? 'unknown', bookId: file.bookId, originalFilename };
  }

  async resolveDownloadFilename(file: { bookId: number; absolutePath: string; format: string | null }): Promise<string> {
    return this.resolveDownloadFilenameForFile(file);
  }

  async renameFile(fileId: number, dto: UpdateBookFileDto, user: RequestUser): Promise<void> {
    const event = 'book.rename_file';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] fileId=${fileId} userId=${user.id} - rename file started`);
    try {
      const file = await this.verifyFileAccess(fileId, user);

      let newAbsolutePath = file.absolutePath;
      if (dto.filename && dto.filename !== basename(file.absolutePath)) {
        if (dto.filename.includes('/') || dto.filename.includes('\\')) {
          throw new BadRequestException('Filename cannot contain path separators');
        }
        newAbsolutePath = join(dirname(file.absolutePath), dto.filename);
        if (newAbsolutePath !== file.absolutePath) {
          try {
            await rename(file.absolutePath, newAbsolutePath);
          } catch (err) {
            throw new BadRequestException(`Failed to rename file on disk: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      await this.bookRepo.updateBookFile(fileId, {
        absolutePath: newAbsolutePath !== file.absolutePath ? newAbsolutePath : undefined,
      });

      this.logger.log(`[${event}] [end] fileId=${fileId} durationMs=${Date.now() - startedAt} - rename file completed`);
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] fileId=${fileId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - rename file failed`,
      );
      throw err;
    }
  }

  async deleteFile(fileId: number, user: RequestUser): Promise<void> {
    const event = 'book.delete_file';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] fileId=${fileId} userId=${user.id} - delete file started`);
    try {
      const file = await this.verifyFileAccess(fileId, user);

      try {
        await rm(file.absolutePath, { force: true });
      } catch {
        this.logger.warn(`Failed to physically delete file at ${file.absolutePath}`);
      }

      // the file watcher will eventually catch the unlink and clean up the database.
      // however, to be responsive, we can manually clean up the database here too,
      // but if the file is the last file, the scanner logic is better suited to mark the book missing.
      // So we leave the DB cleanup to the file watcher, which is more robust.
      const book = await this.bookRepo.findBookBase(file.bookId);
      const wasPrimary = book?.primaryFileId === fileId;

      await this.bookRepo.deleteBookFile(fileId);

      const allFiles = await this.bookRepo.findFilesForBook(file.bookId);
      // deleteBookFile already removes it, but just in case
      const remaining = allFiles.filter((f) => f.id !== fileId);
      if (remaining.length === 0) {
        // mark book as missing if no files left
        await this.bookRepo.updateBookPrimaryFile(file.bookId, null);
      } else if (wasPrimary) {
        // pick the first remaining content file or just the first remaining
        const newPrimary = remaining.find((f) => f.role === 'content') || remaining[0];
        await this.bookRepo.updateBookPrimaryFile(file.bookId, newPrimary?.id ?? null);
      }

      this.logger.log(`[${event}] [end] fileId=${fileId} durationMs=${Date.now() - startedAt} - delete file completed`);
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] fileId=${fileId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - delete file failed`,
      );
      throw err;
    }
  }

  async searchAcrossLibraries(q: string, limit: number, user: RequestUser) {
    const libs = await this.libraryService.findAll(user);
    const libraryIds = libs.map((l) => l.id);
    const contentFilters = this.isSuperuser(user) ? undefined : user.contentFilters;
    return this.bookRepo.searchAcrossLibraries(libraryIds, q, limit, contentFilters);
  }

  async deleteBooks(bookIds: number[], user: RequestUser): Promise<void> {
    const event = 'book.delete_books';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] count=${bookIds.length} userId=${user.id} - delete books started`);
    try {
      if (bookIds.length === 0) {
        this.logger.log(`[${event}] [end] count=0 durationMs=${Date.now() - startedAt} deletedBooks=0 deletedFiles=0 - delete books completed`);
        return;
      }
      const rows = await this.verifyLibraryAccessForBookIds(bookIds, user);
      const files = await this.bookRepo.findAllFilesByBookIds(bookIds);
      await this.bookRepo.deleteByIds(bookIds);
      const deleteTargets = [
        ...rows.map((row) => ({
          path: join(this.appDataPath, 'covers', String(row.id)),
          options: { recursive: true, force: true },
          kind: 'coverDir' as const,
        })),
        ...files.map((file) => ({ path: file.absolutePath, options: { force: true }, kind: 'bookFile' as const })),
      ];
      const deleteResults = await Promise.allSettled(deleteTargets.map((target) => rm(target.path, target.options)));
      let failedDeletes = 0;
      for (let i = 0; i < deleteResults.length; i += 1) {
        const result = deleteResults[i];
        if (result?.status !== 'rejected') continue;
        failedDeletes += 1;
        const target = deleteTargets[i]!;
        const reason = result.reason;
        const errorClass = reason instanceof Error ? reason.name : 'Error';
        const errorMessage = sanitizeLogValue(reason instanceof Error ? reason.message : String(reason));
        const pathValue = sanitizeLogValue(target.path);
        this.logger.warn(
          `[${event}] [fail] userId=${user.id} path="${pathValue}" kind=${target.kind} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - delete books cleanup target failed`,
        );
      }
      this.logger.log(
        `[${event}] [end] count=${bookIds.length} durationMs=${Date.now() - startedAt} deletedBooks=${rows.length} deletedFiles=${files.length} failedDeletes=${failedDeletes} - delete books completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] count=${bookIds.length} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - delete books failed`,
      );
      throw err;
    }
  }

  async updateMetadata(
    id: number,
    dto: UpdateBookMetadataDto,
    user: RequestUser,
    options: { postSaveMode?: PostMetadataSaveMode } = {},
  ): Promise<MetadataSaveResult> {
    const event = 'book.update_metadata';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${id} userId=${user.id} - metadata update started`);
    try {
      await this.verifyBookAccess(id, user);
      await this.bookMetadataLockService.assertManualUpdateAllowed(id, dto);
      const { detail, scalarFieldCount, write, libraryAutoWriteEnabled } = await this.persistMetadataUpdate(id, dto, user, {
        postSaveMode: options.postSaveMode ?? 'schedule',
      });
      this.logger.log(
        `[${event}] [end] bookId=${id} durationMs=${Date.now() - startedAt} scalarFields=${scalarFieldCount} authorsUpdated=${dto.authors !== undefined} narratorsUpdated=${dto.audioMetadata?.narrators !== undefined} genresUpdated=${dto.genres !== undefined} tagsUpdated=${dto.tags !== undefined} audioMetadataUpdated=${dto.audioMetadata !== undefined} comicMetadataUpdated=${dto.comicMetadata !== undefined} customMetadataUpdated=${dto.customMetadata !== undefined} - metadata update completed`,
      );
      return { book: detail, write, libraryAutoWriteEnabled };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${id} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata update failed`,
      );
      throw err;
    }
  }

  async updateMetadataAndLocks(
    id: number,
    dto: UpdateBookMetadataAndLocksDto,
    user: RequestUser,
    options: { postSaveMode?: PostMetadataSaveMode } = {},
  ): Promise<MetadataSaveResult> {
    const event = 'book.update_metadata_and_locks';
    const startedAt = Date.now();
    const metadata = dto.metadata ?? {};
    this.logger.log(
      `[${event}] [start] bookId=${id} userId=${user.id} metadataFields=${Object.keys(metadata).length} lockFields=${dto.lockedFields.length} - metadata and lock update started`,
    );
    try {
      await this.verifyBookAccess(id, user);
      // No lock guard here: this endpoint sets metadata and locks together from one explicit manual
      // request, so a field carried in the payload is always an intentional edit (the editor disables
      // locked inputs). Guarding on the final lock state would reject the legitimate unlock -> edit ->
      // re-lock flow (issue #328). Automated writes are filtered separately via filterAutomatedBookUpdate.
      const { detail, scalarFieldCount, normalizedLockedFields, write, libraryAutoWriteEnabled } = await this.persistMetadataUpdate(
        id,
        metadata,
        user,
        {
          lockedFields: dto.lockedFields,
          postSaveMode: options.postSaveMode ?? 'schedule',
        },
      );
      this.logger.log(
        `[${event}] [end] bookId=${id} durationMs=${Date.now() - startedAt} scalarFields=${scalarFieldCount} customMetadataUpdated=${metadata.customMetadata !== undefined} lockFields=${normalizedLockedFields?.length ?? 0} - metadata and lock update completed`,
      );
      return { book: detail, write, libraryAutoWriteEnabled };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${id} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata and lock update failed`,
      );
      throw err;
    }
  }

  private async persistMetadataUpdate(
    id: number,
    dto: UpdateBookMetadataDto,
    user: RequestUser,
    options: { lockedFields?: readonly string[]; postSaveMode?: PostMetadataSaveMode } = {},
  ): Promise<{
    detail: BookDetailDto;
    scalarFieldCount: number;
    normalizedLockedFields?: BookMetadataLockField[];
    write: WriteResult | null;
    libraryAutoWriteEnabled: boolean;
  }> {
    const scalarFields: Parameters<BookRepository['updateMetadataFields']>[1] = {};
    if (dto.title !== undefined) scalarFields.title = dto.title ?? null;
    if (dto.subtitle !== undefined) scalarFields.subtitle = dto.subtitle ?? null;
    if (dto.description !== undefined) scalarFields.description = dto.description ?? null;
    if (dto.publisher !== undefined) scalarFields.publisher = dto.publisher ?? null;
    if (dto.publishedYear !== undefined) scalarFields.publishedYear = dto.publishedYear ?? null;
    if (dto.language !== undefined) scalarFields.language = dto.language ?? null;
    if (dto.pageCount !== undefined) scalarFields.pageCount = dto.pageCount ?? null;
    if (dto.seriesMemberships === undefined) {
      if (dto.seriesName !== undefined) scalarFields.seriesName = dto.seriesName ?? null;
      if (dto.seriesIndex !== undefined) scalarFields.seriesIndex = dto.seriesIndex ?? null;
    }
    if (dto.isbn10 !== undefined) scalarFields.isbn10 = dto.isbn10 ?? null;
    if (dto.isbn13 !== undefined) scalarFields.isbn13 = dto.isbn13 ?? null;
    if (dto.googleBooksId !== undefined) scalarFields.googleBooksId = dto.googleBooksId ?? null;
    if (dto.goodreadsId !== undefined) scalarFields.goodreadsId = dto.goodreadsId ?? null;
    if (dto.amazonId !== undefined) scalarFields.amazonId = dto.amazonId ?? null;
    if (dto.hardcoverId !== undefined) scalarFields.hardcoverId = dto.hardcoverId ?? null;
    if (dto.hardcoverEditionId !== undefined) scalarFields.hardcoverEditionId = dto.hardcoverEditionId ?? null;
    if (dto.openLibraryId !== undefined) scalarFields.openLibraryId = dto.openLibraryId ?? null;
    if (dto.itunesId !== undefined) scalarFields.itunesId = dto.itunesId ?? null;
    if (dto.audibleId !== undefined) scalarFields.audibleId = dto.audibleId ?? null;
    if (dto.koboId !== undefined) scalarFields.koboId = dto.koboId ?? null;
    if (dto.comicvineId !== undefined) scalarFields.comicvineId = dto.comicvineId ?? null;
    if (dto.ranobedbId !== undefined) scalarFields.ranobedbId = dto.ranobedbId ?? null;
    if (dto.lubimyczytacId !== undefined) scalarFields.lubimyczytacId = dto.lubimyczytacId ?? null;
    if (dto.aladinId !== undefined) scalarFields.aladinId = dto.aladinId ?? null;
    if (dto.rating !== undefined) scalarFields.rating = dto.rating ?? null;
    if (dto.audioMetadata) {
      if (dto.audioMetadata.durationSeconds !== undefined) scalarFields.durationSeconds = dto.audioMetadata.durationSeconds ?? null;
      if (dto.audioMetadata.abridged !== undefined) scalarFields.abridged = dto.audioMetadata.abridged ?? false;
      if (dto.audioMetadata.chapters !== undefined) scalarFields.chapters = dto.audioMetadata.chapters ?? null;
    }

    const communityRatings = this.normalizeCommunityRatingInputs(dto.communityRatings);
    const scalarFieldCount = Object.keys(scalarFields).length;
    const hasMetadataUpdate = Object.keys(dto).length > 0;
    const customMetadataLibraryId = dto.customMetadata !== undefined ? await this.bookRepo.findLibraryIdByBookId(id) : null;
    if (dto.customMetadata !== undefined && customMetadataLibraryId === null) throw new NotFoundException(`Book ${id} not found`);
    let replacedAuthorIds: number[] = [];
    let normalizedLockedFields: BookMetadataLockField[] | undefined;
    let write: WriteResult | null = null;
    let libraryAutoWriteEnabled = false;

    await this.bookRepo.withTransaction(async (tx) => {
      if (scalarFieldCount > 0) {
        scalarFields.updatedAt = new Date();
        await this.bookRepo.updateMetadataFields(id, scalarFields, tx);
      }
      this.throwIfMetadataUpdateFailpoint('afterScalarUpdate');

      if (communityRatings !== undefined) {
        await this.bookRepo.replaceCommunityRatings(id, communityRatings, tx);
      }

      if (dto.seriesMemberships !== undefined) {
        await this.seriesMemberships?.replaceForBook(id, dto.seriesMemberships, tx);
      }
      this.throwIfMetadataUpdateFailpoint('afterSeriesMembershipsReplace');

      if (dto.comicMetadata) {
        await this.comicMetadataService.upsert(id, dto.comicMetadata, tx);
      }
      this.throwIfMetadataUpdateFailpoint('afterComicMetadataUpsert');

      if (dto.authors !== undefined) {
        replacedAuthorIds = await this.metadataService.replaceAuthors(
          id,
          dto.authors.map((name) => ({ name, sortName: null })),
          { executor: tx, emitEvent: false },
        );
      }
      this.throwIfMetadataUpdateFailpoint('afterAuthorsReplace');

      if (dto.audioMetadata?.narrators !== undefined) {
        await this.narratorService.replaceForBook(id, dto.audioMetadata.narrators, { executor: tx });
      }
      this.throwIfMetadataUpdateFailpoint('afterNarratorsReplace');

      if (dto.genres !== undefined) {
        await this.metadataService.replaceGenres(id, dto.genres, { executor: tx });
      }
      this.throwIfMetadataUpdateFailpoint('afterGenresReplace');

      if (dto.tags !== undefined) {
        await this.metadataService.replaceTags(id, dto.tags, { executor: tx });
      }
      this.throwIfMetadataUpdateFailpoint('afterTagsReplace');

      if (dto.customMetadata !== undefined) {
        await this.customMetadataService.updateBookValues(id, customMetadataLibraryId!, dto.customMetadata, tx);
      }

      if (options.lockedFields !== undefined) {
        normalizedLockedFields = await this.bookMetadataLockService.replaceLockedFields(id, options.lockedFields, tx);
      }

      this.throwIfMetadataUpdateFailpoint('beforeTransactionCommit');
    });

    if (dto.authors !== undefined) {
      this.metadataService.emitAuthorsReplaced(id, replacedAuthorIds);
    }

    if (dto.rating !== undefined) {
      const rating = dto.rating ?? null;
      await this.bookRepo.bulkSetRating([id], rating, user.id);
      this.achievementEvents?.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, {
        userId: user.id,
        bookIds: [id],
        rating,
      });
    }

    if (hasMetadataUpdate) {
      this.embedder?.embedBook(id).catch((err: Error) => this.logger.warn(`Embedding failed for book ${id}: ${err.message}`));
      const hasRenameRelevantField =
        dto.seriesMemberships !== undefined ||
        Array.from(RENAME_RELEVANT_FIELDS).some((field) => (dto as Record<string, unknown>)[field] !== undefined);
      const postSaveMode = options.postSaveMode ?? 'schedule';
      if (postSaveMode === 'sync') {
        const settingsResult = await this.findLibraryWriteSettingsAfterSave(id);
        const settings = settingsResult.settings;
        write = settingsResult.writeFailure;
        libraryAutoWriteEnabled = settings?.fileWriteEnabled ?? false;
        this.fileWriteService?.cancelPendingWrite(id);
        this.fileRenameService?.cancelPendingRename(id);

        if (libraryAutoWriteEnabled) {
          write = await this.writeMetadataToFileAfterSave(id, user);
        }

        if (hasRenameRelevantField && settings?.fileRenameEnabled) {
          await this.renameFileAfterSave(id, user);
        }
      } else {
        this.fileWriteService?.scheduleWrite(id, 'auto', user.id);
        if (hasRenameRelevantField) {
          this.fileRenameService?.scheduleRename(id, user.id);
        }
      }
      this.scoreService.calculateAndSave(id).catch((err: Error) => this.logger.warn(`Score calculation failed for book ${id}: ${err.message}`));
    }

    const detail = await this.getDetail(id, user);
    return { detail, scalarFieldCount, normalizedLockedFields, write, libraryAutoWriteEnabled };
  }

  private async findLibraryWriteSettingsAfterSave(bookId: number): Promise<LibraryWriteSettingsLookupResult> {
    const startedAt = Date.now();
    try {
      return {
        settings: (await this.fileWriteService?.findLibraryWriteSettingsForBook(bookId)) ?? null,
        writeFailure: null,
      };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[book.update_metadata_file_write_settings] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - post-save file write settings lookup failed`,
      );
      return {
        settings: null,
        writeFailure: {
          status: 'failed',
          fieldsWritten: [],
          durationMs: Date.now() - startedAt,
          reason: 'file write settings unavailable',
        },
      };
    }
  }

  private async writeMetadataToFileAfterSave(bookId: number, user: RequestUser): Promise<WriteResult> {
    try {
      return (
        (await this.fileWriteService?.writeToFile(bookId, 'sync', user.id, false, false, true)) ?? {
          status: 'skipped',
          fieldsWritten: [],
          durationMs: 0,
          reason: 'file write service unavailable',
        }
      );
    } catch (err) {
      return {
        status: 'failed',
        fieldsWritten: [],
        durationMs: 0,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async renameFileAfterSave(bookId: number, user: RequestUser): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.fileRenameService?.performRename(bookId, user.id, false, true);
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[book.update_metadata_rename] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - post-save file rename failed`,
      );
    }
  }

  async updateMetadataLocks(id: number, lockedFields: string[], user: RequestUser): Promise<BookDetailDto> {
    const event = 'book.update_metadata_locks';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${id} userId=${user.id} - metadata lock update started`);
    try {
      await this.verifyBookAccess(id, user);
      const normalizedLockedFields = await this.bookMetadataLockService.replaceLockedFields(id, lockedFields);
      const detail = await this.getDetail(id, user);
      this.logger.log(
        `[${event}] [end] bookId=${id} durationMs=${Date.now() - startedAt} lockedFields=${normalizedLockedFields.length} - metadata lock update completed`,
      );
      return detail;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${id} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata lock update failed`,
      );
      throw err;
    }
  }

  setMetadataUpdateFailpointForTests(failpoint: MetadataUpdateFailpoint | null): void {
    if (failpoint !== null && !METADATA_UPDATE_FAILPOINTS.includes(failpoint)) {
      throw new InternalServerErrorException(`Unknown metadata update failpoint: ${failpoint}`);
    }
    this.metadataUpdateFailpoint = failpoint;
  }

  clearMetadataUpdateFailpointForTests(): void {
    this.metadataUpdateFailpoint = null;
  }

  private throwIfMetadataUpdateFailpoint(stage: MetadataUpdateFailpoint): void {
    if (this.metadataUpdateFailpoint !== stage) return;
    this.metadataUpdateFailpoint = null;
    throw new InternalServerErrorException(`Metadata update failpoint triggered: ${stage}`);
  }

  async embedAll(): Promise<{ queued: number }> {
    const event = 'book.embed_all';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] - embed all started`);
    try {
      if (!this.embedder) {
        this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} queued=0 runStarted=false - embed all completed`);
        return { queued: 0 };
      }
      if (this.embeddingRun) {
        this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} queued=0 runStarted=false alreadyRunning=true - embed all completed`);
        return { queued: 0 };
      }
      const bookIds = await this.bookRepo.findAllIds();
      this.embeddingRun = this.runEmbeddings(bookIds).finally(() => {
        this.embeddingRun = null;
      });
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} queued=${bookIds.length} runStarted=true - embed all completed`);
      return { queued: bookIds.length };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(`[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - embed all failed`);
      throw err;
    }
  }

  private async runEmbeddings(bookIds: number[]): Promise<void> {
    const event = 'book.run_embeddings';
    const startedAt = Date.now();
    const batch = 10;
    this.logger.log(`[${event}] [start] totalBooks=${bookIds.length} batchSize=${batch} - embeddings run started`);
    if (!this.embedder) {
      this.logger.log(
        `[${event}] [end] totalBooks=${bookIds.length} durationMs=${Date.now() - startedAt} processed=0 failed=0 - embeddings run completed`,
      );
      return;
    }
    let processed = 0;
    let failed = 0;
    for (let i = 0; i < bookIds.length; i += batch) {
      const currentBatch = bookIds.slice(i, i + batch);
      const results = await Promise.allSettled(currentBatch.map((id) => this.embedder!.embedBook(id)));
      for (let batchIndex = 0; batchIndex < results.length; batchIndex += 1) {
        const result = results[batchIndex]!;
        const bookId = currentBatch[batchIndex]!;
        if (result.status === 'fulfilled') {
          processed += 1;
          continue;
        }
        failed += 1;
        const reason = result.reason;
        const errorClass = reason instanceof Error ? reason.name : 'Error';
        const errorMessage = sanitizeLogValue(reason instanceof Error ? reason.message : String(reason));
        this.logger.warn(
          `[${event}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - embedding run item failed`,
        );
      }
    }
    this.logger.log(
      `[${event}] [end] totalBooks=${bookIds.length} durationMs=${Date.now() - startedAt} processed=${processed} failed=${failed} - embeddings run completed`,
    );
  }

  async getProgress(userId: number, fileId: number, user: RequestUser) {
    await this.verifyFileAccess(fileId, user);
    return this.bookRepo.findProgress(userId, fileId);
  }

  async getBookProgress(userId: number, bookId: number, user: RequestUser) {
    await this.verifyBookAccess(bookId, user);
    const rows = await this.bookRepo.findProgressByBook(userId, bookId);
    return rows.map((row) => ({
      fileId: row.fileId,
      cfi: row.cfi ?? null,
      pageNumber: row.pageNumber ?? null,
      percentage: row.percentage ?? 0,
      koboLocationSource: row.koboLocationSource ?? null,
      koboLocationType: row.koboLocationType ?? null,
      koboLocationValue: row.koboLocationValue ?? null,
      koboContentSourceProgressPercent: row.koboContentSourceProgressPercent ?? null,
      koreaderProgress: row.koreaderProgress ?? null,
      updatedAt: row.updatedAt ?? null,
    }));
  }

  async getAudioProgress(userId: number, bookId: number, user: RequestUser) {
    await this.verifyBookAccess(bookId, user);
    return this.bookRepo.findAudioProgress(userId, bookId);
  }

  async saveAudioProgress(userId: number, bookId: number, dto: UpsertAudioProgressDto, user: RequestUser) {
    const libraryId = await this.bookRepo.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(userId, libraryId, this.isSuperuser(user));
    const currentFile = await this.verifyFileAccess(dto.currentFileId, user);
    if (currentFile.bookId !== bookId) {
      throw new BadRequestException(`currentFileId ${dto.currentFileId} does not belong to book ${bookId}`);
    }
    await this.bookRepo.upsertAudioProgress(userId, bookId, dto.currentFileId, dto.positionSeconds, dto.percentage);
    this.libraryService
      .findOne(libraryId)
      .then((lib) => this.userBookStatusService.autoUpdate(userId, bookId, dto.percentage, lib.readingThreshold, lib.markAsFinishedPercentComplete))
      .catch((err: Error) => this.logger.warn(`Auto status update failed for book ${bookId}: ${err.message}`));
  }

  /**
   * Advances the Kobo bookmark for progress reported by non-web readers (KOReader).
   * Percent-only: the precise KoboSpan Location is computed at delivery time by the
   * Kobo reading-state pull path.
   */
  async syncKoboReadingStateForExternalProgress(userId: number, fileId: number, percentage: number): Promise<void> {
    if (!(await this.bookRepo.isKoboTwoWayProgressSyncEnabled(userId))) return;
    await this.bookRepo.syncKoboReadingStateFromProgress(userId, fileId, percentage, null, null, null, null);
  }

  async saveProgress(userId: number, fileId: number, dto: SaveProgressDto, user: RequestUser) {
    const file = await this.verifyFileAccess(fileId, user);
    await this.bookRepo.upsertProgress(
      userId,
      fileId,
      dto.cfi ?? null,
      dto.pageNumber ?? null,
      dto.percentage,
      dto.positionSeconds ?? null,
      dto.koboLocationSource ?? null,
      dto.koboLocationType ?? null,
      dto.koboLocationValue ?? null,
      dto.koboContentSourceProgressPercent ?? null,
      dto.koreaderProgress ?? null,
    );
    if (file.format === 'epub' && this.hasPermission(user, Permission.KoboSync) && (await this.bookRepo.isKoboTwoWayProgressSyncEnabled(userId))) {
      await this.bookRepo.syncKoboReadingStateFromProgress(
        userId,
        fileId,
        dto.percentage,
        dto.koboLocationSource ?? null,
        dto.koboLocationType ?? null,
        dto.koboLocationValue ?? null,
        dto.koboContentSourceProgressPercent ?? null,
      );
    }
    this.libraryService
      .findOne(file.libraryId)
      .then((lib) =>
        this.userBookStatusService.autoUpdate(userId, file.bookId, dto.percentage, lib.readingThreshold, lib.markAsFinishedPercentComplete),
      )
      .catch((err: Error) => this.logger.warn(`Auto status update failed for book ${file.bookId}: ${err.message}`));
  }

  async clearFileProgress(userId: number, fileId: number, user: RequestUser): Promise<void> {
    await this.verifyFileAccess(fileId, user);
    await this.bookRepo.clearFileProgress(userId, fileId);
  }

  async setReadStatus(bookId: number, dto: SetStatusDto, user: RequestUser): Promise<UserBookStatus> {
    await this.verifyBookAccess(bookId, user);
    const hasStatus = Object.prototype.hasOwnProperty.call(dto, 'status');
    const hasStartedAt = Object.prototype.hasOwnProperty.call(dto, 'startedAt');
    const hasFinishedAt = Object.prototype.hasOwnProperty.call(dto, 'finishedAt');
    if (!hasStatus && !hasStartedAt && !hasFinishedAt) {
      throw new BadRequestException('At least one of status, startedAt, or finishedAt is required');
    }

    const timeZone = this.resolveUserTimeZone(user);
    const patch: { status?: ReadStatus; startedAt?: Date | null; finishedAt?: Date | null } = {};

    let startedKey: string | null | undefined;
    if (hasStartedAt) {
      if (dto.startedAt === null) {
        patch.startedAt = null;
        startedKey = null;
      } else {
        const normalized = this.parseManualReadDateInput(dto.startedAt, 'startedAt', timeZone);
        patch.startedAt = normalized.date;
        startedKey = normalized.dateKey;
      }
    }

    let finishedKey: string | null | undefined;
    if (hasFinishedAt) {
      if (dto.finishedAt === null) {
        patch.finishedAt = null;
        finishedKey = null;
      } else {
        const normalized = this.parseManualReadDateInput(dto.finishedAt, 'finishedAt', timeZone);
        patch.finishedAt = normalized.date;
        finishedKey = normalized.dateKey;
      }
    }

    if (hasStatus && dto.status !== undefined) {
      patch.status = dto.status;
    }

    const existing = await this.userBookStatusService.findOne(user.id, bookId);
    const effectiveStarted = hasStartedAt ? (startedKey ?? null) : this.normalizeStoredStatusDateKey(existing?.startedAt ?? null, timeZone);
    const effectiveFinished = hasFinishedAt ? (finishedKey ?? null) : this.normalizeStoredStatusDateKey(existing?.finishedAt ?? null, timeZone);

    if (effectiveStarted && effectiveFinished && effectiveFinished < effectiveStarted) {
      throw new BadRequestException('finishedAt must be on or after startedAt');
    }

    const updated = await this.userBookStatusService.updateManual(user.id, bookId, patch);
    return this.toDateOnlyReadStatus(updated, timeZone);
  }

  private resolveUserTimeZone(user: RequestUser): string {
    const timezoneValue = (user.settings as { timezone?: unknown } | undefined)?.timezone;
    return resolveTimeZone(timezoneValue, 'UTC');
  }

  private parseManualReadDateInput(
    value: string | null | undefined,
    field: 'startedAt' | 'finishedAt',
    timeZone: string,
  ): { dateKey: string; date: Date } {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a date string or null`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} must be a non-empty date string`);
    }

    const dateKey = this.normalizeInputToDateKey(trimmed, field, timeZone);
    const todayKey = toDateKeyInTimeZone(new Date(), timeZone);
    if (dateKey > todayKey) {
      throw new BadRequestException(`${field} cannot be in the future`);
    }
    return {
      dateKey,
      date: toTimeZoneStartOfDay(dateKey, timeZone),
    };
  }

  private normalizeInputToDateKey(value: string, field: 'startedAt' | 'finishedAt', timeZone: string): string {
    if (isDateKey(value)) {
      return value;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return toDateKeyInTimeZone(parsed, timeZone);
  }

  private normalizeStoredStatusDateKey(value: string | null, timeZone: string): string | null {
    if (!value) return null;
    if (isDateKey(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return toDateKeyInTimeZone(parsed, timeZone);
  }

  private toDateOnlyReadStatus(status: UserBookStatus, timeZone: string): UserBookStatus {
    return {
      ...status,
      startedAt: this.normalizeStoredStatusDateKey(status.startedAt, timeZone),
      finishedAt: this.normalizeStoredStatusDateKey(status.finishedAt, timeZone),
    };
  }

  async bulkSetStatus(bookIds: number[], status: ReadStatus, user: RequestUser): Promise<void> {
    const event = 'book.bulk.set_status';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${bookIds.length} status=${status} - bulk set status started`);
    await this.verifyLibraryAccessForBookIds(bookIds, user);
    await this.userBookStatusService.bulkSetManual(user.id, bookIds, status);
    this.logger.log(
      `[${event}] [end] userId=${user.id} count=${bookIds.length} status=${status} durationMs=${Date.now() - startedAt} - bulk set status completed`,
    );
  }

  async bulkSetRating(bookIds: number[], rating: number | null, user: RequestUser): Promise<void> {
    const event = 'book.bulk.set_rating';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${bookIds.length} rating=${rating ?? 'null'} - bulk set rating started`);
    await this.verifyLibraryAccessForBookIds(bookIds, user);
    const lockedIds = await this.bookMetadataLockService.getBookIdsWithLockedField(bookIds, 'rating');
    const updatableIds = bookIds.filter((bookId) => !lockedIds.has(bookId));
    if (updatableIds.length > 0) {
      await this.bookRepo.bulkSetRating(updatableIds, rating, user.id);
      this.triggerPostMetadataUpdateEffects(updatableIds, user.id);
      this.achievementEvents?.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, {
        userId: user.id,
        bookIds: updatableIds,
        rating,
      });
    }
    this.logger.log(
      `[${event}] [end] userId=${user.id} count=${bookIds.length} rating=${rating ?? 'null'} updated=${updatableIds.length} skippedLocked=${lockedIds.size} durationMs=${Date.now() - startedAt} - bulk set rating completed`,
    );
  }

  async bulkSetMetadata(bookIds: number[], field: BulkMetadataField, value: string | number | string[] | null, user: RequestUser): Promise<void> {
    const event = 'book.bulk.set_metadata';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${bookIds.length} field=${field} - bulk set metadata started`);
    await this.verifyLibraryAccessForBookIds(bookIds, user);
    const lockField = BULK_METADATA_LOCK_FIELD_BY_FIELD[field];
    const lockedIds = await this.bookMetadataLockService.getBookIdsWithLockedField(bookIds, lockField);
    const updatableIds = bookIds.filter((bookId) => !lockedIds.has(bookId));
    if (updatableIds.length > 0) {
      const normalizeListValue = (raw: string | number | string[] | null): string[] => {
        if (Array.isArray(raw)) return [...new Set(raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
        if (raw === null) return [];
        const normalized = String(raw).trim();
        return normalized.length > 0 ? [normalized] : [];
      };
      if (field === 'seriesName' || field === 'publisher' || field === 'language' || field === 'publishedYear') {
        if (field === 'publishedYear') {
          const year = value === null ? null : typeof value === 'number' ? value : Number(value);
          if (year !== null && (!Number.isFinite(year) || !Number.isInteger(year))) {
            throw new BadRequestException('Invalid publishedYear value');
          }
          await this.bookRepo.bulkUpdateMetadataFields(updatableIds, { publishedYear: year, updatedAt: new Date() });
        } else {
          const textValue = value === null ? null : String(value).trim();
          await this.bookRepo.bulkUpdateMetadataFields(updatableIds, { [field]: textValue?.length ? textValue : null, updatedAt: new Date() });
        }
      } else {
        const names = normalizeListValue(value);
        await this.bookRepo.withTransaction(async (tx) => {
          for (const bookId of updatableIds) {
            if (field === 'authors') {
              await this.metadataService.replaceAuthors(
                bookId,
                names.map((name) => ({ name, sortName: null })),
                { executor: tx },
              );
              continue;
            }
            if (field === 'genres') {
              await this.metadataService.replaceGenres(bookId, names, { executor: tx });
              continue;
            }
            if (field === 'tags') {
              await this.metadataService.replaceTags(bookId, names, { executor: tx });
              continue;
            }
            await this.narratorService.replaceForBook(bookId, names, { executor: tx });
          }
        });
      }
      this.triggerPostMetadataUpdateEffects(updatableIds, user.id);
    }
    this.logger.log(
      `[${event}] [end] userId=${user.id} count=${bookIds.length} field=${field} updated=${updatableIds.length} skippedLocked=${lockedIds.size} durationMs=${Date.now() - startedAt} - bulk set metadata completed`,
    );
  }

  async bulkUpdateTags(bookIds: number[], mode: 'add' | 'remove' | 'replace', tags: string[], user: RequestUser): Promise<void> {
    const event = 'book.bulk.update_tags';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${bookIds.length} mode=${mode} tagCount=${tags.length} - bulk update tags started`);
    await this.verifyLibraryAccessForBookIds(bookIds, user);
    await this.bookRepo.withTransaction(async (tx) => {
      if (mode === 'replace') {
        for (const bookId of bookIds) {
          await this.metadataService.replaceTags(bookId, tags, { executor: tx });
        }
        return;
      }

      const currentTagsMap = await this.bookRepo.findTagsByBookIds(bookIds, tx);
      for (const bookId of bookIds) {
        const current = currentTagsMap.get(bookId) ?? [];
        const next = mode === 'add' ? [...new Set([...current, ...tags])] : current.filter((t) => !tags.includes(t));
        await this.metadataService.replaceTags(bookId, next, { executor: tx });
      }
    });
    this.triggerPostMetadataUpdateEffects(bookIds, user.id);

    this.logger.log(
      `[${event}] [end] userId=${user.id} count=${bookIds.length} mode=${mode} tagCount=${tags.length} durationMs=${Date.now() - startedAt} - bulk update tags completed`,
    );
  }

  async bulkSetMetadataLock(bookIds: number[], locked: boolean, user: RequestUser): Promise<void> {
    const event = 'book.bulk.set_metadata_lock';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${bookIds.length} locked=${locked} - bulk set metadata lock started`);
    await this.verifyLibraryAccessForBookIds(bookIds, user);
    const fields: BookMetadataLockField[] = locked ? [...BOOK_METADATA_LOCK_FIELDS] : [];
    await this.bookMetadataLockService.bulkReplaceLockedFields(bookIds, fields);
    this.logger.log(
      `[${event}] [end] userId=${user.id} count=${bookIds.length} locked=${locked} durationMs=${Date.now() - startedAt} - bulk set metadata lock completed`,
    );
  }

  async bulkEditMetadata(bookIds: number[], fields: BulkEditFieldsDto, user: RequestUser): Promise<BulkEditMetadataResult> {
    const event = 'book.bulk.edit_metadata';
    const startedAt = Date.now();
    const fieldNames = Object.keys(fields).filter((k) => (fields as unknown as Record<string, unknown>)[k] !== undefined);
    this.logger.log(`[${event}] [start] userId=${user.id} count=${bookIds.length} fields=${fieldNames.join(',')} - bulk edit metadata started`);

    if (!fields.hasAtLeastOneField()) {
      throw new BadRequestException('fields must contain at least one editable field');
    }
    if (!fields.hasValidArrayValues()) {
      throw new BadRequestException('array fields with add or remove mode must have a non-empty values array');
    }

    await this.verifyLibraryAccessForBookIds(bookIds, user);

    const locksMap = await this.bookMetadataLockService.getLockedFieldsMap(bookIds);
    const fieldResults: Record<string, BulkEditFieldResult> = {};
    const allUpdatedBookIds = new Set<number>();

    const getUpdatableIds = (lockField: BookMetadataLockField): number[] => {
      return bookIds.filter((id) => {
        const locked = locksMap.get(id) ?? [];
        return !locked.includes(lockField);
      });
    };

    const getSeriesUpdatableIds = (): number[] => {
      return bookIds.filter((id) => {
        const locked = locksMap.get(id) ?? [];
        return !locked.includes('seriesName') && !locked.includes('seriesIndex');
      });
    };

    const recordResult = (fieldName: string, updatableIds: number[]) => {
      const skippedLocked = bookIds.length - updatableIds.length;
      fieldResults[fieldName] = { updated: updatableIds.length, skippedLocked };
      for (const id of updatableIds) allUpdatedBookIds.add(id);
    };

    try {
      await this.bookRepo.withTransaction(async (tx) => {
        for (const fieldName of ['seriesName', 'publisher', 'language'] as const) {
          if (!fields[fieldName]) continue;
          const ids = getUpdatableIds(BULK_METADATA_LOCK_FIELD_BY_FIELD[fieldName]);
          recordResult(fieldName, ids);
          if (ids.length === 0) continue;
          const val = fields[fieldName].value;
          const textValue = val === null ? null : String(val).trim() || null;
          await this.bookRepo.bulkUpdateMetadataFields(ids, { [fieldName]: textValue, updatedAt: new Date() }, tx);
        }

        if (fields.seriesMemberships !== undefined) {
          const ids = getSeriesUpdatableIds();
          recordResult('seriesMemberships', ids);
          for (const bookId of ids) {
            await this.seriesMemberships?.replaceForBook(bookId, fields.seriesMemberships, tx);
          }
        }

        if (fields.publishedYear) {
          const ids = getUpdatableIds('publishedYear');
          recordResult('publishedYear', ids);
          if (ids.length > 0) {
            const val = fields.publishedYear.value;
            if (val !== null && (!Number.isFinite(val) || !Number.isInteger(val))) {
              throw new BadRequestException('Invalid publishedYear value');
            }
            await this.bookRepo.bulkUpdateMetadataFields(ids, { publishedYear: val, updatedAt: new Date() }, tx);
          }
        }

        if (fields.authors) {
          const ids = getUpdatableIds('authors');
          recordResult('authors', ids);
          if (ids.length > 0) {
            const names = this.normalizeListValues(fields.authors.values);
            if (fields.authors.mode === 'replace') {
              for (const bookId of ids) {
                await this.metadataService.replaceAuthors(
                  bookId,
                  names.map((name) => ({ name, sortName: null })),
                  { executor: tx },
                );
              }
            } else {
              const currentMap = await this.bookRepo.findAuthorsByBookIds(ids, tx);
              for (const bookId of ids) {
                const current = currentMap.get(bookId) ?? [];
                const merged = fields.authors!.mode === 'add' ? [...new Set([...current, ...names])] : current.filter((n) => !names.includes(n));
                await this.metadataService.replaceAuthors(
                  bookId,
                  merged.map((name) => ({ name, sortName: null })),
                  { executor: tx },
                );
              }
            }
          }
        }

        if (fields.genres) {
          const ids = getUpdatableIds('genres');
          recordResult('genres', ids);
          if (ids.length > 0) {
            const names = this.normalizeListValues(fields.genres.values);
            if (fields.genres.mode === 'replace') {
              for (const bookId of ids) {
                await this.metadataService.replaceGenres(bookId, names, { executor: tx });
              }
            } else {
              const currentMap = await this.bookRepo.findGenresByBookIds(ids, tx);
              for (const bookId of ids) {
                const current = currentMap.get(bookId) ?? [];
                const merged = fields.genres!.mode === 'add' ? [...new Set([...current, ...names])] : current.filter((n) => !names.includes(n));
                await this.metadataService.replaceGenres(bookId, merged, { executor: tx });
              }
            }
          }
        }

        if (fields.tags) {
          const ids = getUpdatableIds('tags');
          recordResult('tags', ids);
          if (ids.length > 0) {
            const names = this.normalizeListValues(fields.tags.values);
            if (fields.tags.mode === 'replace') {
              for (const bookId of ids) {
                await this.metadataService.replaceTags(bookId, names, { executor: tx });
              }
            } else {
              const currentMap = await this.bookRepo.findTagsByBookIds(ids, tx);
              for (const bookId of ids) {
                const current = currentMap.get(bookId) ?? [];
                const merged = fields.tags!.mode === 'add' ? [...new Set([...current, ...names])] : current.filter((n) => !names.includes(n));
                await this.metadataService.replaceTags(bookId, merged, { executor: tx });
              }
            }
          }
        }

        if (fields.narrators) {
          const ids = getUpdatableIds('narrators');
          recordResult('narrators', ids);
          if (ids.length > 0) {
            const names = this.normalizeListValues(fields.narrators.values);
            if (fields.narrators.mode === 'replace') {
              for (const bookId of ids) {
                await this.narratorService.replaceForBook(bookId, names, { executor: tx });
              }
            } else {
              const currentMap = await this.bookRepo.findNarratorsByBookIds(ids, tx);
              for (const bookId of ids) {
                const current = currentMap.get(bookId) ?? [];
                const merged = fields.narrators!.mode === 'add' ? [...new Set([...current, ...names])] : current.filter((n) => !names.includes(n));
                await this.narratorService.replaceForBook(bookId, merged, { executor: tx });
              }
            }
          }
        }
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = error instanceof Error ? sanitizeLogValue(error.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] userId=${user.id} count=${bookIds.length} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - bulk edit metadata failed`,
      );
      throw error;
    }

    if (allUpdatedBookIds.size > 0) {
      this.triggerPostMetadataUpdateEffects([...allUpdatedBookIds], user.id);
    }

    const result: BulkEditMetadataResult = {
      updatedBooks: allUpdatedBookIds.size,
      fields: fieldResults,
    };

    this.logger.log(
      `[${event}] [end] userId=${user.id} count=${bookIds.length} updatedBooks=${allUpdatedBookIds.size} fieldCount=${fieldNames.length} durationMs=${Date.now() - startedAt} - bulk edit metadata completed`,
    );

    return result;
  }

  private normalizeListValues(values: string[]): string[] {
    return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
  }

  async getKoboState(id: number, user: RequestUser): Promise<BookKoboState> {
    await this.verifyBookAccess(id, user);

    if (!this.hasPermission(user, Permission.KoboSync)) {
      return {
        eligibleForKoboSync: false,
        syncCollections: [],
        readingState: null,
        snapshot: null,
      };
    }

    const [readingStateRow, snapshotRow, syncCollections] = await Promise.all([
      this.bookRepo.findKoboReadingState(user.id, id),
      this.bookRepo.findKoboSnapshotState(user.id, id),
      this.bookRepo.findKoboSyncCollectionNamesForBook(user.id, id),
    ]);

    const currentBookmark = (readingStateRow?.currentBookmark ?? null) as Record<string, unknown> | null;
    const statusInfo = (readingStateRow?.statusInfo ?? null) as Record<string, unknown> | null;

    const progressCandidate = currentBookmark?.ProgressPercent;
    const progressPercent = typeof progressCandidate === 'number' ? Math.max(0, Math.min(100, progressCandidate)) : null;
    const status = typeof statusInfo?.Status === 'string' ? statusInfo.Status : null;

    return {
      eligibleForKoboSync: syncCollections.length > 0,
      syncCollections,
      readingState: readingStateRow
        ? {
            status,
            progressPercent,
            createdAtKobo: readingStateRow.createdAtKobo ?? null,
            lastModifiedKobo: readingStateRow.lastModifiedKobo ?? null,
            priorityTimestamp: readingStateRow.priorityTimestamp ?? null,
            updatedAt: readingStateRow.updatedAt.toISOString(),
          }
        : null,
      snapshot: snapshotRow
        ? {
            snapshotId: snapshotRow.snapshotId,
            snapshotUpdatedAt: snapshotRow.snapshotUpdatedAt.toISOString(),
            inSnapshot: snapshotRow.synced !== null,
            synced: snapshotRow.synced ?? null,
            pendingDelete: snapshotRow.pendingDelete ?? null,
            isNew: snapshotRow.isNew ?? null,
            removedByDevice: snapshotRow.removedByDevice ?? null,
            fileHash: snapshotRow.fileHash ?? null,
            metadataHash: snapshotRow.metadataHash ?? null,
          }
        : null,
    };
  }

  async refreshMetadata(id: number, preview: boolean, user: RequestUser): Promise<BookDetailDto | BookMetadataRefreshPreviewResponse> {
    const event = 'book.refresh_metadata';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${id} userId=${user.id} preview=${preview} - refresh metadata started`);
    try {
      const found = await this.bookRepo.findById(id);
      if (!found) throw new NotFoundException(`Book ${id} not found`);

      const { book, authorRows, genreRows, communityRatingRows } = found;
      await this.libraryService.verifyUserAccess(user.id, book.books.libraryId, this.isSuperuser(user));
      const meta = book.book_metadata;

      const providerIds = this.collectExistingProviderIds(meta ?? {});

      const searchParams: MetadataSearchParams = {
        title: meta?.title ?? undefined,
        author: authorRows[0]?.name ?? undefined,
        isbn: meta?.isbn13 ?? meta?.isbn10 ?? undefined,
        existingProviderIds: providerIds,
        isAudiobook: (meta?.durationSeconds !== null && meta?.durationSeconds !== undefined) || !!meta?.audibleId,
        maxCandidatesPerProvider: 1,
      };

      const existingFields: Partial<Record<MetadataField, unknown>> = {
        title: meta?.title,
        subtitle: meta?.subtitle,
        description: meta?.description,
        authors: authorRows.map((a) => a.name),
        publisher: meta?.publisher,
        publishedYear: meta?.publishedYear,
        language: meta?.language,
        pageCount: meta?.pageCount,
        communityRating: communityRatingRows,
        seriesName: meta?.seriesName,
        seriesIndex: meta?.seriesIndex,
        genres: genreRows.map((g) => g.name),
        cover: meta?.coverSource,
        duration: meta?.durationSeconds ?? undefined,
        abridged: meta?.abridged ?? undefined,
      };

      const {
        resolved,
        providerIds: resolvedProviderIds,
        diagnostics,
      } = await this.pipeline.runWithSources(searchParams, existingFields, book.books.libraryId);

      if (preview) {
        const previewResult = this.buildMetadataRefreshPreview(resolved, resolvedProviderIds);
        const previewDiagnostics = this.buildMetadataRefreshPreviewDiagnostics(previewResult, diagnostics);
        this.logger.log(
          `[${event}] [end] bookId=${id} preview=true durationMs=${Date.now() - startedAt} resolvedFields=${previewDiagnostics.resolvedFieldCount} emptyReason=${previewDiagnostics.reason ?? 'none'} - refresh metadata completed`,
        );
        return { metadata: previewResult, diagnostics: previewDiagnostics };
      }

      const {
        resolved: filteredResolved,
        providerIds: filteredProviderIds,
        skippedFields,
      } = await this.bookMetadataLockService.filterResolvedMetadata(id, resolved, resolvedProviderIds);

      const r = filteredResolved as Record<string, unknown>;
      const dto: UpdateBookMetadataDto = {};
      if (r.title !== undefined) dto.title = r.title as string | null;
      if (r.subtitle !== undefined) dto.subtitle = r.subtitle as string | null;
      if (r.description !== undefined) dto.description = r.description as string | null;
      if (r.authors !== undefined) dto.authors = r.authors as string[];
      if (r.genres !== undefined) dto.genres = r.genres as string[];
      if (r.publisher !== undefined) dto.publisher = r.publisher as string | null;
      if (r.publishedYear !== undefined) dto.publishedYear = r.publishedYear as number | null;
      if (r.language !== undefined) dto.language = r.language as string | null;
      if (r.pageCount !== undefined) dto.pageCount = r.pageCount as number | null;
      if (r.communityRatings !== undefined) dto.communityRatings = r.communityRatings as UpdateBookMetadataDto['communityRatings'];
      if (r.seriesName !== undefined) dto.seriesName = r.seriesName as string | null;
      if (r.seriesIndex !== undefined) dto.seriesIndex = r.seriesIndex as number | null;
      if (r.seriesMemberships !== undefined) dto.seriesMemberships = r.seriesMemberships as UpdateBookMetadataDto['seriesMemberships'];
      if (r.narrators !== undefined || r.duration !== undefined || r.abridged !== undefined || r.chapters !== undefined) {
        dto.audioMetadata = {};
        if (r.narrators !== undefined) dto.audioMetadata.narrators = r.narrators as string[];
        if (r.duration !== undefined) dto.audioMetadata.durationSeconds = r.duration as number | null;
        if (r.abridged !== undefined) dto.audioMetadata.abridged = r.abridged as boolean | null;
        if (r.chapters !== undefined) dto.audioMetadata.chapters = r.chapters as NonNullable<typeof dto.audioMetadata.chapters>;
      }
      if (r.comicMetadata !== undefined) dto.comicMetadata = r.comicMetadata as UpdateBookMetadataDto['comicMetadata'];
      this.applyResolvedProviderIds(dto, filteredProviderIds);

      const updatedFields = Object.keys(dto).length;
      let detail: BookDetailDto | undefined;
      if (updatedFields > 0) {
        const saveResult = await this.updateMetadata(id, dto, user, { postSaveMode: 'schedule' });
        detail = saveResult.book;
      }

      // Mark successful non-preview provider refreshes so freshness analytics are accurate,
      // even when no scalar field changed after reconciliation.
      await this.bookRepo.updateMetadataFields(id, { lastMetadataFetchAt: new Date(), updatedAt: new Date() });

      let coverDownloaded = false;
      if (filteredResolved.coverUrl) {
        await this.metadataService.downloadAndSaveCover(filteredResolved.coverUrl, id);
        detail = await this.getDetail(id, user);
        coverDownloaded = true;
      }

      const result = detail ?? (await this.getDetail(id, user));
      this.logger.log(
        `[${event}] [end] bookId=${id} preview=false durationMs=${Date.now() - startedAt} updatedFields=${updatedFields} skippedLockedFields=${skippedFields.join('|') || 'none'} coverDownloaded=${coverDownloaded} - refresh metadata completed`,
      );
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${id} userId=${user.id} preview=${preview} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - refresh metadata failed`,
      );
      throw err;
    }
  }

  async bulkRefreshMetadata(
    bookIds: number[],
    user: RequestUser,
    onProgress?: (event: { bookId: number; success: boolean; detail?: BookDetailDto; error?: string }) => void,
    options?: { isCancelled?: () => boolean },
  ): Promise<{ processed: number; failed: number }> {
    const event = 'book.bulk_refresh_metadata';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] count=${bookIds.length} userId=${user.id} - bulk refresh metadata started`);
    try {
      if (bookIds.length === 0) {
        this.logger.log(`[${event}] [end] count=0 durationMs=${Date.now() - startedAt} processed=0 failed=0 - bulk refresh metadata completed`);
        return { processed: 0, failed: 0 };
      }
      await this.verifyLibraryAccessForBookIds(bookIds, user);

      let processed = 0;
      let failed = 0;
      let callbackInterrupted = false;
      let cancelled = false;
      for (const id of bookIds) {
        if (options?.isCancelled?.()) {
          cancelled = true;
          break;
        }
        let success = false;
        let detail: BookDetailDto | undefined;
        let errorMessage: string | undefined;
        try {
          const refreshed = await this.refreshMetadata(id, false, user);
          detail = refreshed as BookDetailDto;
          processed++;
          success = true;
        } catch (err) {
          const itemErrorClass = err instanceof Error ? err.name : 'Error';
          const itemError = sanitizeLogValue(err instanceof Error ? err.message : String(err));
          errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[${event}] [fail] bookId=${id} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${itemErrorClass} error="${itemError}" - bulk refresh metadata item failed`,
          );
          failed++;
        }
        try {
          onProgress?.({ bookId: id, success, detail, error: errorMessage });
        } catch {
          callbackInterrupted = true;
          break;
        }
      }
      this.logger.log(
        `[${event}] [end] count=${bookIds.length} durationMs=${Date.now() - startedAt} processed=${processed} failed=${failed} callbackInterrupted=${callbackInterrupted} cancelled=${cancelled} - bulk refresh metadata completed`,
      );
      return { processed, failed };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] count=${bookIds.length} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - bulk refresh metadata failed`,
      );
      throw err;
    }
  }

  async bulkReExtractCover(
    bookIds: number[],
    user: RequestUser,
    onProgress?: (bookId: number) => void,
    options?: { isCancelled?: () => boolean },
  ): Promise<{ processed: number; updated: number }> {
    const event = 'book.bulk_reextract_cover';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] count=${bookIds.length} userId=${user.id} - bulk re-extract cover started`);
    try {
      if (bookIds.length === 0) {
        this.logger.log(`[${event}] [end] count=0 durationMs=${Date.now() - startedAt} processed=0 updated=0 - bulk re-extract cover completed`);
        return { processed: 0, updated: 0 };
      }
      await this.verifyLibraryAccessForBookIds(bookIds, user);

      const [files, coverLockedBookIds] = await Promise.all([
        this.bookRepo.findPrimaryFilesByBookIds(bookIds),
        this.bookMetadataLockService.getCoverLockedBookIds(bookIds),
      ]);
      const filesByBookId = new Map(files.map((f) => [f.bookId, f]));

      let processed = 0;
      let updated = 0;
      let skipped = 0;
      let callbackInterrupted = false;
      let cancelled = false;
      for (const id of bookIds) {
        if (options?.isCancelled?.()) {
          cancelled = true;
          break;
        }
        const file = filesByBookId.get(id);
        if (!file) continue;
        if (coverLockedBookIds.has(id)) {
          skipped++;
          continue;
        }
        processed++;
        const saved = await this.metadataService.refreshCoverForBook(id, file.absolutePath, file.format ?? '');
        if (saved) {
          updated++;
        }
        try {
          onProgress?.(id);
        } catch {
          callbackInterrupted = true;
          break;
        }
      }
      this.logger.log(
        `[${event}] [end] count=${bookIds.length} durationMs=${Date.now() - startedAt} processed=${processed} updated=${updated} skippedLocked=${skipped} callbackInterrupted=${callbackInterrupted} cancelled=${cancelled} - bulk re-extract cover completed`,
      );
      return { processed, updated };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] count=${bookIds.length} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - bulk re-extract cover failed`,
      );
      throw err;
    }
  }

  private async resolveExportFileSize(file: ExportCandidateFile): Promise<number> {
    if (typeof file.sizeBytes === 'number' && Number.isFinite(file.sizeBytes) && file.sizeBytes >= 0) {
      return file.sizeBytes;
    }

    try {
      const { size } = await stat(file.absolutePath);
      return size;
    } catch (err) {
      if (this.isMissingFilesystemEntry(err)) {
        throw new NotFoundException(`File for book ${file.bookId} is missing on disk`);
      }
      throw err;
    }
  }

  async getExportFiles(bookIds: number[], user: RequestUser, scope: ExportScope): Promise<ExportPlan> {
    const event = 'book.get_export_files';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] count=${bookIds.length} userId=${user.id} scope=${scope} - get export files started`);
    try {
      const uniqueBookIds = [...new Set(bookIds)];
      if (uniqueBookIds.length === 0) throw new BadRequestException('No books selected');
      if (uniqueBookIds.length > EXPORT_LIMITS.MAX_BOOKS) {
        throw new BadRequestException(`Too many books selected. Limit is ${EXPORT_LIMITS.MAX_BOOKS}.`);
      }

      const rows = await this.bookRepo.findLibraryIdsByBookIds(uniqueBookIds);
      const foundBookIds = new Set(rows.map((row) => row.id));
      const missingBookIds = uniqueBookIds.filter((id) => !foundBookIds.has(id));
      if (missingBookIds.length > 0) {
        throw new BadRequestException(`Some selected books were not found: ${missingBookIds.join(', ')}`);
      }

      const uniqueLibraryIds = [...new Set(rows.map((row) => row.libraryId))];
      await Promise.all(uniqueLibraryIds.map((libraryId) => this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user))));

      const bookOrder = new Map(uniqueBookIds.map((id, index) => [id, index]));
      const fetchedFiles: ExportCandidateFile[] =
        scope === 'primary' ? await this.bookRepo.findPrimaryFilesByBookIds(uniqueBookIds) : await this.bookRepo.findAllFilesByBookIds(uniqueBookIds);
      const files = scope === 'audio' ? fetchedFiles.filter((file) => !!file.format && isAudioFormat(file.format)) : fetchedFiles;

      const booksWithFiles = new Set(files.map((file) => file.bookId));
      const booksWithoutExportFiles = uniqueBookIds.filter((id) => !booksWithFiles.has(id));
      if (booksWithoutExportFiles.length > 0) {
        throw new BadRequestException(`Some selected books have no exportable files: ${booksWithoutExportFiles.join(', ')}`);
      }
      if (files.length > EXPORT_LIMITS.MAX_FILES) {
        throw new BadRequestException(`Too many files selected for export. Limit is ${EXPORT_LIMITS.MAX_FILES}.`);
      }

      const orderedFiles = files.sort((a, b) => {
        const aOrder = bookOrder.get(a.bookId) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = bookOrder.get(b.bookId) ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aSortOrder = a.sortOrder ?? 0;
        const bSortOrder = b.sortOrder ?? 0;
        if (aSortOrder !== bSortOrder) return aSortOrder - bSortOrder;
        return a.absolutePath.localeCompare(b.absolutePath);
      });
      const [pattern, metadataRows] = await Promise.all([
        this.appSettings.getDownloadPattern(),
        this.bookRepo.findPatternMetadataByBookIds([...new Set(orderedFiles.map((f) => f.bookId))]),
      ]);
      const metadataByBookId = new Map(metadataRows.map((row) => [row.bookId, row]));
      const usedPaths = new Set<string>();
      let projectedBytes = 0;

      const result: ExportPlan['files'] = [];
      for (const file of orderedFiles) {
        const sizeBytes = await this.resolveExportFileSize(file);
        projectedBytes += sizeBytes;
        if (projectedBytes > EXPORT_LIMITS.MAX_PROJECTED_BYTES) {
          throw new BadRequestException(`Export exceeds projected size limit of ${EXPORT_LIMITS.MAX_PROJECTED_BYTES} bytes.`);
        }

        const tokens = this.buildDownloadPatternTokens(file.absolutePath, file.format, metadataByBookId.get(file.bookId));
        const resolvedPath = resolveUploadPath(pattern || DEFAULT_DOWNLOAD_PATTERN, tokens, tokens.extension);
        const fallbackFilename = basename(file.absolutePath);
        const rawZipPath = resolvedPath ?? fallbackFilename;
        const safeZipPath = this.sanitizeZipPath(rawZipPath, fallbackFilename);
        const zipPath = this.makeUniqueZipPath(safeZipPath, usedPaths);
        result.push({ absolutePath: file.absolutePath, zipPath, sizeBytes });
      }

      this.logger.log(
        `[${event}] [end] count=${uniqueBookIds.length} durationMs=${Date.now() - startedAt} files=${result.length} projectedBytes=${projectedBytes} scope=${scope} - get export files completed`,
      );
      return {
        files: result,
        projectedBytes,
        bookCount: uniqueBookIds.length,
        scope,
      };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] count=${bookIds.length} userId=${user.id} scope=${scope} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - get export files failed`,
      );
      throw err;
    }
  }

  async getDetail(id: number, user: RequestUser): Promise<BookDetailDto> {
    await this.verifyBookAccess(id, user);
    const [result, personalRating, readStatus, comicMeta, collectionRows] = await Promise.all([
      this.bookRepo.findById(id),
      this.bookRepo.findRatingByBookAndUser(id, user.id),
      this.userBookStatusService.findOne(user.id, id),
      this.comicMetadataService.findByBookId(id),
      this.bookRepo.findCollectionsByBookId(id, user.id),
    ]);
    if (!result) throw new NotFoundException(`Book ${id} not found`);

    const { book, authorRows, genreRows, tagRows, fileRows, narratorRows, seriesMembershipRows, communityRatingRows } = result;
    const meta = book.book_metadata;
    const customMetadata = await this.customMetadataService.getBookValues(id, book.books.libraryId);
    const hasAudioFiles = fileRows.some((f) => f.format && isAudioFormat(f.format));
    const resolvedChapters = this.resolveChapters(meta?.chapters as AudiobookChapter[] | null | undefined, fileRows);
    const supplementalFields = buildBookDetailSupplementalFields({
      readStatus,
      hasAudioFiles,
      narratorRows,
      audioMeta: {
        durationSeconds: meta?.durationSeconds,
        abridged: meta?.abridged,
      },
      chapters: resolvedChapters,
      comicMeta,
      collections: collectionRows,
    });

    return {
      id: book.books.id,
      libraryId: book.books.libraryId,
      libraryName: book.libraries?.name ?? '',
      status: book.books.status,
      folderPath: book.books.folderPath,
      addedAt: book.books.addedAt,
      updatedAt: book.books.updatedAt ?? null,
      title: meta?.title ?? null,
      subtitle: meta?.subtitle ?? null,
      description: meta?.description ?? null,
      isbn10: meta?.isbn10 ?? null,
      isbn13: meta?.isbn13 ?? null,
      publisher: meta?.publisher ?? null,
      publishedYear: meta?.publishedYear ?? null,
      language: meta?.language ?? null,
      pageCount: meta?.pageCount ?? null,
      seriesId: meta?.seriesId ?? null,
      seriesName: meta?.seriesName ?? null,
      seriesIndex: meta?.seriesIndex ?? null,
      seriesMemberships: seriesMembershipRows,
      rating: personalRating,
      communityRatings: this.mapCommunityRatingRows(communityRatingRows),
      coverSource: (meta?.coverSource as 'extracted' | 'custom' | null) ?? null,
      hardcoverEditionId: meta?.hardcoverEditionId ?? null,
      lockedFields: this.bookMetadataLockService.normalizeLockedFields(meta?.lockedFields),
      providerIds: {
        [MetadataProviderKey.GOOGLE]: meta?.googleBooksId ?? null,
        [MetadataProviderKey.GOODREADS]: meta?.goodreadsId ?? null,
        [MetadataProviderKey.AMAZON]: meta?.amazonId ?? null,
        [MetadataProviderKey.HARDCOVER]: meta?.hardcoverId ?? null,
        [MetadataProviderKey.OPEN_LIBRARY]: meta?.openLibraryId ?? null,
        [MetadataProviderKey.ITUNES]: meta?.itunesId ?? null,
        [MetadataProviderKey.AUDIBLE]: meta?.audibleId ?? null,
        [MetadataProviderKey.KOBO]: meta?.koboId ?? null,
        [MetadataProviderKey.COMICVINE]: meta?.comicvineId ?? null,
        [MetadataProviderKey.RANOBEDB]: meta?.ranobedbId ?? null,
        [MetadataProviderKey.LUBIMYCZYTAC]: meta?.lubimyczytacId ?? null,
        [MetadataProviderKey.ALADIN]: meta?.aladinId ?? null,
      },
      authors: authorRows,
      genres: genreRows.map((g) => g.name),
      tags: tagRows.map((t) => t.name),
      files: fileRows.map((f) => ({
        id: f.id,
        format: f.format,
        role: f.id === book.books.primaryFileId ? 'primary' : f.role,
        sizeBytes: f.sizeBytes,
        absolutePath: f.absolutePath,
        createdAt: f.createdAt,
        filename: basename(f.absolutePath),
        durationSeconds: f.durationSeconds,
      })),
      lastWrittenAt: meta?.lastWrittenAt ?? null,
      metadataScore: meta?.metadataScore ?? null,
      formatPriority: (book.libraries?.formatPriority as string[] | null) ?? [],
      customMetadata,
      fileWriteStatus: this.fileWriteService?.resolveBookFileWriteStatus(book.libraries, fileRows, book.books.primaryFileId) ?? {
        enabled: false,
        reason: 'library_disabled',
        writableFormats: [],
        writableFields: [],
      },
      ...supplementalFields,
    };
  }

  async writeAndRename(bookId: number, user: RequestUser): Promise<BookWriteAndRenameResult> {
    await this.verifyBookAccess(bookId, user);

    this.fileWriteService?.cancelPendingWrite(bookId);
    this.fileRenameService?.cancelPendingRename(bookId);

    const settings = (await this.fileWriteService?.findLibraryWriteSettingsForBook(bookId)) ?? null;

    let write: WriteResult;
    try {
      write = (await this.fileWriteService?.writeToFile(bookId, 'sync', user.id, false, true, true)) ?? {
        status: 'skipped',
        fieldsWritten: [],
        durationMs: 0,
        reason: 'file write service unavailable',
      };
    } catch (err) {
      write = {
        status: 'failed',
        fieldsWritten: [],
        durationMs: 0,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    let rename: FileRenameResult;
    try {
      rename = (await this.fileRenameService?.performRename(bookId, user.id, true, true)) ?? {
        status: 'skipped',
        durationMs: 0,
        reason: 'file rename service unavailable',
      };
    } catch (err) {
      rename = {
        status: 'failed',
        durationMs: 0,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      write,
      rename,
      libraryAutoWriteEnabled: settings?.fileWriteEnabled ?? false,
      libraryAutoRenameEnabled: settings?.fileRenameEnabled ?? false,
    };
  }

  async getMetadataFromFile(id: number, user: RequestUser): Promise<Record<string, unknown>> {
    await this.verifyBookAccess(id, user);
    const file = await this.bookRepo.findPrimaryFile(id);
    if (!file) throw new NotFoundException(`Book ${id} has no primary file`);

    const { absolutePath, format } = file;
    if (!format) return {};

    switch (format) {
      case 'epub': {
        const parsed = await extractEpubMetadata(absolutePath);
        if (!parsed) return {};
        const customMetadata = await this.customMetadataService.parseFileValuesForBook(id, parsed.customMetadata);
        return {
          title: parsed.title,
          subtitle: parsed.subtitle,
          description: parsed.description,
          publisher: parsed.publisher,
          publishedYear: parsed.publishedYear,
          language: parsed.language,
          pageCount: parsed.pageCount,
          isbn10: parsed.isbn10,
          isbn13: parsed.isbn13,
          seriesName: parsed.seriesName,
          seriesIndex: parsed.seriesIndex,
          googleBooksId: parsed.googleBooksId,
          goodreadsId: parsed.goodreadsId,
          amazonId: parsed.amazonId,
          hardcoverId: parsed.hardcoverId,
          hardcoverEditionId: parsed.hardcoverEditionId,
          openLibraryId: parsed.openLibraryId,
          itunesId: parsed.itunesId,
          koboId: parsed.koboId,
          ranobedbId: parsed.ranobedbId,
          lubimyczytacId: parsed.lubimyczytacId,
          aladinId: parsed.aladinId,
          customMetadata: customMetadata.length > 0 ? customMetadata : undefined,
          authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
          genres: parsed.genres.length > 0 ? parsed.genres : undefined,
        };
      }
      case 'pdf': {
        const parsed = await parsePdfFile(absolutePath, {
          extractCover: false,
          onWarning: (warning) => this.logPdfFileMetadataWarning(warning),
        });
        if (!parsed) return {};
        return {
          title: parsed.title,
          subtitle: parsed.subtitle,
          description: parsed.description,
          publisher: parsed.publisher,
          publishedYear: parsed.publishedYear,
          language: parsed.language,
          pageCount: parsed.pageCount,
          isbn10: parsed.isbn10,
          isbn13: parsed.isbn13,
          seriesName: parsed.seriesName,
          seriesIndex: parsed.seriesIndex,
          googleBooksId: parsed.googleBooksId,
          goodreadsId: parsed.goodreadsId,
          amazonId: parsed.amazonId,
          hardcoverId: parsed.hardcoverId,
          hardcoverEditionId: parsed.hardcoverEditionId,
          openLibraryId: parsed.openLibraryId,
          itunesId: parsed.itunesId,
          koboId: parsed.koboId,
          ranobedbId: parsed.ranobedbId,
          lubimyczytacId: parsed.lubimyczytacId,
          aladinId: parsed.aladinId,
          authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
          genres: parsed.genres.length > 0 ? parsed.genres : undefined,
        };
      }
      case 'mobi':
      case 'azw3':
      case 'azw': {
        const parsed = await parseMobiFile(absolutePath);
        if (!parsed) return {};
        const year = parsed.publishedDate ? parseInt(parsed.publishedDate.substring(0, 4), 10) || undefined : undefined;
        return {
          title: parsed.title,
          description: parsed.description,
          publisher: parsed.publisher,
          publishedYear: year,
          language: parsed.language,
          isbn13: parsed.isbn,
          authors: parsed.authors.length > 0 ? parsed.authors : undefined,
          genres: parsed.tags.length > 0 ? parsed.tags : undefined,
        };
      }
      case 'cbz':
      case 'cbr':
      case 'cb7': {
        const extractor = format === 'cbz' ? extractCbzMetadata : format === 'cbr' ? extractCbrMetadata : extractCb7Metadata;
        const parsed = await extractor(absolutePath);
        if (!parsed) return {};
        const cbzGenres = parsed.genres.length > 0 ? parsed.genres : parsed.tags;
        return {
          title: parsed.title,
          subtitle: parsed.subtitle,
          description: parsed.description,
          publisher: parsed.publisher,
          publishedYear: parsed.publishedYear,
          language: parsed.language,
          pageCount: parsed.pageCount,
          isbn10: parsed.isbn10,
          isbn13: parsed.isbn13,
          seriesName: parsed.seriesName,
          seriesIndex: parsed.seriesIndex,
          googleBooksId: parsed.googleBooksId,
          goodreadsId: parsed.goodreadsId,
          amazonId: parsed.amazonId,
          hardcoverId: parsed.hardcoverId,
          hardcoverEditionId: parsed.hardcoverEditionId,
          openLibraryId: parsed.openLibraryId,
          itunesId: parsed.itunesId,
          koboId: parsed.koboId,
          ranobedbId: parsed.ranobedbId,
          lubimyczytacId: parsed.lubimyczytacId,
          aladinId: parsed.aladinId,
          authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
          genres: cbzGenres.length > 0 ? cbzGenres : undefined,
          comicMetadata: parsed.comicMetadata ?? undefined,
        };
      }
      case 'fb2': {
        const parsed = await parseFb2File(absolutePath);
        if (!parsed) return {};
        return {
          title: parsed.title,
          description: parsed.description,
          publishedYear: parsed.publishedYear,
          language: parsed.language,
          seriesName: parsed.seriesName,
          seriesIndex: parsed.seriesIndex,
          authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
          genres: parsed.genres.length > 0 ? parsed.genres : undefined,
        };
      }
      default: {
        if (isAudioFormat(format)) {
          const parsed = await extractAudioMetadata(absolutePath);
          const result: Record<string, unknown> = {};
          if (parsed.title !== null) result.title = parsed.title;
          if (parsed.subtitle !== null) result.subtitle = parsed.subtitle;
          if (parsed.description !== null) result.description = parsed.description;
          if (parsed.publisher !== null) result.publisher = parsed.publisher;
          if (parsed.publishedYear !== null) result.publishedYear = parsed.publishedYear;
          if (parsed.language !== null) result.language = parsed.language;
          if (parsed.seriesName !== null) result.seriesName = parsed.seriesName;
          if (parsed.seriesIndex !== null) result.seriesIndex = parsed.seriesIndex;
          if (parsed.audibleId !== null) result.audibleId = parsed.audibleId;
          if (parsed.durationSeconds !== null) result.durationSeconds = parsed.durationSeconds;
          if (parsed.authors.length > 0) result.authors = parsed.authors.map((a) => a.name);
          if (parsed.genres.length > 0) result.genres = parsed.genres;
          if (parsed.narrators.length > 0) result.narrators = parsed.narrators;
          return result;
        }
        return {};
      }
    }
  }

  private logPdfFileMetadataWarning(warning: PdfParseWarning): void {
    const pathValue = sanitizeLogValue(warning.absolutePath);
    if (warning.code === 'buffered-large-pdf') {
      this.logger.warn(
        `[book.file_metadata_pdf] [end] path="${pathValue}" code=${warning.code} sizeBytes=${warning.sizeBytes ?? 0} thresholdBytes=${warning.thresholdBytes ?? 0} - large pdf buffered in memory`,
      );
      return;
    }
    const errorMessage = sanitizeLogValue(warning.errorMessage);
    this.logger.warn(
      `[book.file_metadata_pdf] [fail] path="${pathValue}" code=${warning.code} errorClass=${warning.errorClass} error="${errorMessage}" - pdf file metadata warning emitted`,
    );
  }

  private triggerPostMetadataUpdateEffects(bookIds: number[], userId: number): void {
    for (const bookId of bookIds) {
      this.fileWriteService?.scheduleWrite(bookId, 'auto', userId);
      this.fileRenameService?.scheduleRename(bookId, userId);
      void this.scoreService
        .calculateAndSave(bookId)
        .catch((err: Error) => this.logger.warn(`Score calculation failed for book ${bookId}: ${err.message}`));
    }
  }

  private resolveChapters(
    stored: AudiobookChapter[] | null | undefined,
    fileRows: { absolutePath: string; format: string | null; durationSeconds: number | null }[],
  ): AudiobookChapter[] | null {
    if (stored && stored.length > 0) return stored;

    const audioFiles = fileRows.filter((f) => f.format && isAudioFormat(f.format));
    if (audioFiles.length < 2) return stored ?? null;

    const chapters: AudiobookChapter[] = [];
    let offsetMs = 0;
    for (const f of audioFiles) {
      const nameWithExt = basename(f.absolutePath);
      const title = nameWithExt.replace(/\.[^.]+$/, '');
      chapters.push({ title, startMs: offsetMs });
      offsetMs += Math.round((f.durationSeconds ?? 0) * 1000);
    }
    return chapters;
  }
}
