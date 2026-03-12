import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, readdir, rm, stat } from 'fs/promises';
import { basename, extname, join } from 'path';

import { MetadataProviderKey, Permission, resolveUploadPath } from '@projectx/types';
import type { BookKoboState, BookQuery, BooksPage, MetadataField } from '@projectx/types';
import { assembleBookCards } from './utils/assemble-book-cards';
import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { MetadataService } from '../metadata/metadata.service';
import { LibraryService } from '../library/library.service';
import { MetadataFetchPipeline, ResolvedMetadataFields } from '../metadata-fetch/metadata-fetch-pipeline';
import type { MetadataSearchParams } from '../metadata-fetch/providers/metadata-search-params';
import { FileWriteService } from '../file-write/file-write.service';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookRepository } from './book.repository';
import { BookDetailDto } from './dto/book-detail.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';

@Injectable()
export class BookService {
  private readonly logger = new Logger(BookService.name);
  private readonly booksPath: string;
  private static readonly DEFAULT_DOWNLOAD_PATTERN = '{originalFilename}';

  constructor(
    private readonly bookRepo: BookRepository,
    private readonly libraryService: LibraryService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly metadataService: MetadataService,
    private readonly pipeline: MetadataFetchPipeline,
    private readonly config: ConfigService,
    private readonly appSettings: AppSettingsService,
    @Optional() private readonly embedder: BookEmbedderService,
    @Optional() private readonly fileWriteService: FileWriteService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  private isSuperuser(user: RequestUser): boolean {
    return user.isSuperuser;
  }

  private hasPermission(user: RequestUser, permissionName: Permission): boolean {
    return user.isSuperuser || user.permissions.includes(permissionName);
  }

  private collectExistingProviderIds(meta: {
    googleBooksId?: string | null;
    goodreadsId?: string | null;
    amazonId?: string | null;
    hardcoverId?: string | null;
    openLibraryId?: string | null;
    itunesId?: string | null;
  }): Partial<Record<MetadataProviderKey, string>> {
    const providerIds: Partial<Record<MetadataProviderKey, string>> = {};
    if (meta.googleBooksId) providerIds[MetadataProviderKey.GOOGLE] = meta.googleBooksId;
    if (meta.goodreadsId) providerIds[MetadataProviderKey.GOODREADS] = meta.goodreadsId;
    if (meta.amazonId) providerIds[MetadataProviderKey.AMAZON] = meta.amazonId;
    if (meta.hardcoverId) providerIds[MetadataProviderKey.HARDCOVER] = meta.hardcoverId;
    if (meta.openLibraryId) providerIds[MetadataProviderKey.OPEN_LIBRARY] = meta.openLibraryId;
    if (meta.itunesId) providerIds[MetadataProviderKey.ITUNES] = meta.itunesId;
    return providerIds;
  }

  private applyResolvedProviderIds(
    dto: Pick<UpdateBookMetadataDto, 'googleBooksId' | 'goodreadsId' | 'amazonId' | 'hardcoverId' | 'openLibraryId' | 'itunesId'>,
    providerIds: Partial<Record<MetadataProviderKey, string>>,
  ): void {
    if (providerIds[MetadataProviderKey.GOOGLE]) dto.googleBooksId = providerIds[MetadataProviderKey.GOOGLE];
    if (providerIds[MetadataProviderKey.GOODREADS]) dto.goodreadsId = providerIds[MetadataProviderKey.GOODREADS];
    if (providerIds[MetadataProviderKey.AMAZON]) dto.amazonId = providerIds[MetadataProviderKey.AMAZON];
    if (providerIds[MetadataProviderKey.HARDCOVER]) dto.hardcoverId = providerIds[MetadataProviderKey.HARDCOVER];
    if (providerIds[MetadataProviderKey.OPEN_LIBRARY]) dto.openLibraryId = providerIds[MetadataProviderKey.OPEN_LIBRARY];
    if (providerIds[MetadataProviderKey.ITUNES]) dto.itunesId = providerIds[MetadataProviderKey.ITUNES];
  }

  async verifyBookAccess(bookId: number, user: RequestUser): Promise<void> {
    const libraryId = await this.bookRepo.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user));
  }

  async verifyFileAccess(fileId: number, user: RequestUser): Promise<NonNullable<Awaited<ReturnType<BookRepository['findFileById']>>>> {
    const file = await this.bookRepo.findFileById(fileId);
    if (!file) throw new NotFoundException(`No file with id ${fileId}`);
    await this.libraryService.verifyUserAccess(user.id, file.libraryId, this.isSuperuser(user));
    return file;
  }

  async queryForLibrary(user: RequestUser, libraryId: number, query: BookQuery): Promise<BooksPage> {
    await this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user));
    const where = this.queryBuilder.buildWhere(query.filter, { accessibleLibraryIds: [libraryId], implicitLibraryId: libraryId, userId: user.id });
    const orderBy = this.queryBuilder.buildOrderBy(query.sort);
    const { rows, authorRows, fileRows, genreRows, tagRows, progressRows, total } = await this.bookRepo.findCards({
      where,
      orderBy,
      limit: query.pagination.size,
      offset: query.pagination.page * query.pagination.size,
      userId: user.id,
    });
    return {
      items: assembleBookCards(rows, authorRows, fileRows, genreRows, tagRows, progressRows),
      total,
      page: query.pagination.page,
      size: query.pagination.size,
    };
  }

  async globalQuery(user: RequestUser, query: BookQuery): Promise<BooksPage> {
    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = libs.map((l) => l.id);
    const where = this.queryBuilder.buildWhere(query.filter, { accessibleLibraryIds, userId: user.id });
    const orderBy = this.queryBuilder.buildOrderBy(query.sort);
    const { rows, authorRows, fileRows, genreRows, tagRows, progressRows, total } = await this.bookRepo.findCards({
      where,
      orderBy,
      limit: query.pagination.size,
      offset: query.pagination.page * query.pagination.size,
      userId: user.id,
    });
    return {
      items: assembleBookCards(rows, authorRows, fileRows, genreRows, tagRows, progressRows),
      total,
      page: query.pagination.page,
      size: query.pagination.size,
    };
  }

  async getCoverPath(id: number, user: RequestUser): Promise<string | null> {
    await this.verifyBookAccess(id, user);
    const dir = join(this.booksPath, 'covers', String(id));
    try {
      const files = await readdir(dir);
      const cover = files.find((f) => f.startsWith('cover_custom.')) ?? files.find((f) => f.startsWith('cover_extracted.'));
      return cover ? join(dir, cover) : null;
    } catch {
      return null;
    }
  }

  async getThumbnailPath(id: number, user: RequestUser): Promise<string | null> {
    await this.verifyBookAccess(id, user);
    const path = join(this.booksPath, 'covers', String(id), 'thumbnail.jpg');
    return access(path)
      .then(() => path)
      .catch(() => null);
  }

  private formatSeriesIndex(value: number | null): string | null {
    if (value == null) return null;
    const whole = Math.floor(value);
    const fraction = value - whole;
    const padded = String(whole).padStart(2, '0');
    return fraction > 0 ? `${padded}.${String(fraction).split('.')[1]}` : padded;
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

    const seriesIndex = this.formatSeriesIndex(meta.seriesIndex);
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
      const resolvedPath = resolveUploadPath(pattern || BookService.DEFAULT_DOWNLOAD_PATTERN, tokens, tokens.extension);
      const resolvedName = resolvedPath?.split('/').filter(Boolean).pop() ?? null;
      return this.sanitizeFilenameSegment(resolvedName ?? originalFilename, originalFilename);
    } catch (err) {
      this.logger.warn(`Download filename pattern resolution failed for book ${file.bookId}: ${err instanceof Error ? err.message : String(err)}`);
      return this.sanitizeFilenameSegment(originalFilename, originalFilename);
    }
  }

  async getFileInfo(
    fileId: number,
    user: RequestUser,
  ): Promise<{ path: string; size: number; format: string; bookId: number; originalFilename: string }> {
    const file = await this.verifyFileAccess(fileId, user);
    const { size } = await stat(file.absolutePath);
    const originalFilename = basename(file.absolutePath);
    return { path: file.absolutePath, size, format: file.format ?? 'unknown', bookId: file.bookId, originalFilename };
  }

  async resolveDownloadFilename(file: { bookId: number; absolutePath: string; format: string | null }): Promise<string> {
    return this.resolveDownloadFilenameForFile(file);
  }

  async searchAcrossLibraries(q: string, limit: number, user: RequestUser) {
    const libs = await this.libraryService.findAll(user);
    const libraryIds = libs.map((l) => l.id);
    return this.bookRepo.searchAcrossLibraries(libraryIds, q, limit);
  }

  async deleteBooks(bookIds: number[], user: RequestUser): Promise<void> {
    if (bookIds.length === 0) return;
    const rows = await this.bookRepo.findLibraryIdsByBookIds(bookIds);
    const uniqueLibraryIds = [...new Set(rows.map((r) => r.libraryId))];
    const isSuperuser = this.isSuperuser(user);
    await Promise.all(uniqueLibraryIds.map((libId) => this.libraryService.verifyUserAccess(user.id, libId, isSuperuser)));
    const files = await this.bookRepo.findAllFilesByBookIds(bookIds);
    await this.bookRepo.deleteByIds(bookIds);
    for (const { id: bookId } of rows) {
      const coverDir = join(this.booksPath, 'covers', String(bookId));
      rm(coverDir, { recursive: true, force: true }).catch((err: Error) =>
        this.logger.warn(`Failed to delete cover dir ${coverDir}: ${err.message}`),
      );
    }
    for (const { absolutePath } of files) {
      rm(absolutePath, { force: true }).catch((err: Error) => this.logger.warn(`Failed to delete book file ${absolutePath}: ${err.message}`));
    }
  }

  async updateMetadata(id: number, dto: UpdateBookMetadataDto, user: RequestUser): Promise<BookDetailDto> {
    await this.verifyBookAccess(id, user);

    const scalarFields: Parameters<BookRepository['updateMetadataFields']>[1] = {};
    if ('title' in dto) scalarFields.title = dto.title ?? null;
    if ('subtitle' in dto) scalarFields.subtitle = dto.subtitle ?? null;
    if ('description' in dto) scalarFields.description = dto.description ?? null;
    if ('publisher' in dto) scalarFields.publisher = dto.publisher ?? null;
    if ('publishedYear' in dto) scalarFields.publishedYear = dto.publishedYear ?? null;
    if ('language' in dto) scalarFields.language = dto.language ?? null;
    if ('pageCount' in dto) scalarFields.pageCount = dto.pageCount ?? null;
    if ('seriesName' in dto) scalarFields.seriesName = dto.seriesName ?? null;
    if ('seriesIndex' in dto) scalarFields.seriesIndex = dto.seriesIndex ?? null;
    if ('isbn10' in dto) scalarFields.isbn10 = dto.isbn10 ?? null;
    if ('isbn13' in dto) scalarFields.isbn13 = dto.isbn13 ?? null;
    if ('rating' in dto) scalarFields.rating = dto.rating ?? null;
    if ('googleBooksId' in dto) scalarFields.googleBooksId = dto.googleBooksId ?? null;
    if ('goodreadsId' in dto) scalarFields.goodreadsId = dto.goodreadsId ?? null;
    if ('amazonId' in dto) scalarFields.amazonId = dto.amazonId ?? null;
    if ('hardcoverId' in dto) scalarFields.hardcoverId = dto.hardcoverId ?? null;
    if ('openLibraryId' in dto) scalarFields.openLibraryId = dto.openLibraryId ?? null;
    if ('itunesId' in dto) scalarFields.itunesId = dto.itunesId ?? null;

    if (Object.keys(scalarFields).length > 0) {
      scalarFields.updatedAt = new Date();
      await this.bookRepo.updateMetadataFields(id, scalarFields);
    }

    if (dto.authors !== undefined) {
      await this.metadataService.replaceAuthors(
        id,
        dto.authors.map((name) => ({ name, sortName: null })),
      );
    }
    if (dto.genres !== undefined) {
      await this.metadataService.replaceGenres(id, dto.genres);
    }
    if (dto.tags !== undefined) {
      await this.metadataService.replaceTags(id, dto.tags);
    }

    this.embedder?.embedBook(id).catch((err: Error) => this.logger.warn(`Embedding failed for book ${id}: ${err.message}`));
    this.fileWriteService?.scheduleWrite(id, 'auto', user.id);
    return this.getDetail(id, user);
  }

  async embedAll(): Promise<{ queued: number }> {
    const bookIds = await this.bookRepo.findAllIds();
    this.runEmbeddings(bookIds).catch((err: Error) => this.logger.error(`Embed-all failed: ${err.message}`));
    return { queued: bookIds.length };
  }

  private async runEmbeddings(bookIds: number[]): Promise<void> {
    const BATCH = 10;
    for (let i = 0; i < bookIds.length; i += BATCH) {
      await Promise.all(
        bookIds
          .slice(i, i + BATCH)
          .map((id) => this.embedder?.embedBook(id).catch((err: Error) => this.logger.warn(`Failed to embed book ${id}: ${err.message}`))),
      );
    }
    this.logger.log(`Embeddings complete: ${bookIds.length} books processed`);
  }

  async getProgress(userId: number, fileId: number, user: RequestUser) {
    await this.verifyFileAccess(fileId, user);
    return this.bookRepo.findProgress(userId, fileId);
  }

  async saveProgress(userId: number, fileId: number, dto: SaveProgressDto, user: RequestUser) {
    await this.verifyFileAccess(fileId, user);
    await this.bookRepo.upsertProgress(userId, fileId, dto.cfi ?? null, dto.pageNumber ?? null, dto.percentage);
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

    const progressCandidate = currentBookmark?.ProgressPercent ?? currentBookmark?.ContentSourceProgressPercent;
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
            progressSyncedAt: readingStateRow.progressSyncedAt?.toISOString() ?? null,
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

  async refreshMetadata(id: number, preview: boolean, user: RequestUser): Promise<BookDetailDto | ResolvedMetadataFields> {
    const found = await this.bookRepo.findById(id);
    if (!found) throw new NotFoundException(`Book ${id} not found`);

    const { book, authorRows, genreRows } = found;
    await this.libraryService.verifyUserAccess(user.id, book.books.libraryId, this.isSuperuser(user));
    const meta = book.book_metadata;

    const providerIds = this.collectExistingProviderIds(meta ?? {});

    const searchParams: MetadataSearchParams = {
      title: meta?.title ?? undefined,
      author: authorRows[0]?.name ?? undefined,
      isbn: meta?.isbn13 ?? meta?.isbn10 ?? undefined,
      existingProviderIds: providerIds,
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
      seriesName: meta?.seriesName,
      seriesIndex: meta?.seriesIndex,
      genres: genreRows.map((g) => g.name),
      cover: meta?.coverSource,
    };

    const { resolved, providerIds: resolvedProviderIds } = await this.pipeline.runWithSources(searchParams, existingFields, book.books.libraryId);

    if (preview) {
      const previewResult: ResolvedMetadataFields & {
        googleBooksId?: string;
        goodreadsId?: string;
        amazonId?: string;
        hardcoverId?: string;
        openLibraryId?: string;
        itunesId?: string;
      } = { ...resolved };
      this.applyResolvedProviderIds(previewResult, resolvedProviderIds);
      return previewResult;
    }

    const r = resolved as Record<string, unknown>;
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
    if (r.seriesName !== undefined) dto.seriesName = r.seriesName as string | null;
    if (r.seriesIndex !== undefined) dto.seriesIndex = r.seriesIndex as number | null;
    this.applyResolvedProviderIds(dto, resolvedProviderIds);

    let detail: BookDetailDto | undefined;
    if (Object.keys(dto).length > 0) {
      detail = await this.updateMetadata(id, dto, user);
    }

    if (resolved.coverUrl) {
      await this.metadataService.downloadAndSaveCover(resolved.coverUrl, id);
      detail = await this.getDetail(id, user);
    }

    return detail ?? this.getDetail(id, user);
  }

  async bulkRefreshMetadata(
    bookIds: number[],
    user: RequestUser,
    onProgress?: (bookId: number) => void,
  ): Promise<{ processed: number; failed: number }> {
    if (bookIds.length === 0) return { processed: 0, failed: 0 };
    const rows = await this.bookRepo.findLibraryIdsByBookIds(bookIds);
    const uniqueLibraryIds = [...new Set(rows.map((r) => r.libraryId))];
    const isSuperuser = this.isSuperuser(user);
    await Promise.all(uniqueLibraryIds.map((libId) => this.libraryService.verifyUserAccess(user.id, libId, isSuperuser)));

    let processed = 0;
    let failed = 0;
    for (const id of bookIds) {
      try {
        await this.refreshMetadata(id, false, user);
        processed++;
        onProgress?.(id);
      } catch (err) {
        this.logger.warn(`Bulk metadata refresh failed for book ${id}: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
        onProgress?.(id);
      }
    }
    return { processed, failed };
  }

  async bulkReExtractCover(
    bookIds: number[],
    user: RequestUser,
    onProgress?: (bookId: number) => void,
  ): Promise<{ processed: number; updated: number }> {
    if (bookIds.length === 0) return { processed: 0, updated: 0 };
    const rows = await this.bookRepo.findLibraryIdsByBookIds(bookIds);
    const uniqueLibraryIds = [...new Set(rows.map((r) => r.libraryId))];
    const isSuperuser = this.isSuperuser(user);
    await Promise.all(uniqueLibraryIds.map((libId) => this.libraryService.verifyUserAccess(user.id, libId, isSuperuser)));

    const files = await this.bookRepo.findPrimaryFilesByBookIds(bookIds);
    const filesByBookId = new Map(files.map((f) => [f.bookId, f]));

    let processed = 0;
    let updated = 0;
    for (const id of bookIds) {
      const file = filesByBookId.get(id);
      if (!file) continue;
      processed++;
      const saved = await this.metadataService.refreshCoverForBook(id, file.absolutePath, file.format ?? '');
      if (saved) {
        updated++;
      }
      onProgress?.(id);
    }
    return { processed, updated };
  }

  async getExportFiles(bookIds: number[], user: RequestUser, allFormats: boolean): Promise<{ absolutePath: string; zipPath: string }[]> {
    if (bookIds.length === 0) throw new BadRequestException('No books selected');
    const rows = await this.bookRepo.findLibraryIdsByBookIds(bookIds);
    const uniqueLibraryIds = [...new Set(rows.map((r) => r.libraryId))];
    const isSuperuser = this.isSuperuser(user);
    await Promise.all(uniqueLibraryIds.map((libId) => this.libraryService.verifyUserAccess(user.id, libId, isSuperuser)));

    const files = allFormats ? await this.bookRepo.findAllFilesByBookIds(bookIds) : await this.bookRepo.findPrimaryFilesByBookIds(bookIds);
    const [pattern, metadataRows] = await Promise.all([
      this.appSettings.getDownloadPattern(),
      this.bookRepo.findPatternMetadataByBookIds([...new Set(files.map((f) => f.bookId))]),
    ]);
    const metadataByBookId = new Map(metadataRows.map((row) => [row.bookId, row]));
    const usedPaths = new Set<string>();

    return files.map((file) => {
      const tokens = this.buildDownloadPatternTokens(file.absolutePath, file.format, metadataByBookId.get(file.bookId));
      const resolvedPath = resolveUploadPath(pattern || BookService.DEFAULT_DOWNLOAD_PATTERN, tokens, tokens.extension);
      const fallbackFilename = basename(file.absolutePath);
      const rawZipPath = resolvedPath ?? fallbackFilename;
      const safeZipPath = this.sanitizeZipPath(rawZipPath, fallbackFilename);
      const zipPath = this.makeUniqueZipPath(safeZipPath, usedPaths);
      return { absolutePath: file.absolutePath, zipPath };
    });
  }

  async getDetail(id: number, user: RequestUser): Promise<BookDetailDto> {
    await this.verifyBookAccess(id, user);
    const result = await this.bookRepo.findById(id);
    if (!result) throw new NotFoundException(`Book ${id} not found`);

    const { book, authorRows, genreRows, tagRows, fileRows } = result;
    const meta = book.book_metadata;

    return {
      id: book.books.id,
      libraryId: book.books.libraryId,
      status: book.books.status,
      folderPath: book.books.folderPath,
      title: meta?.title ?? null,
      subtitle: meta?.subtitle ?? null,
      description: meta?.description ?? null,
      isbn10: meta?.isbn10 ?? null,
      isbn13: meta?.isbn13 ?? null,
      publisher: meta?.publisher ?? null,
      publishedYear: meta?.publishedYear ?? null,
      language: meta?.language ?? null,
      pageCount: meta?.pageCount ?? null,
      seriesName: meta?.seriesName ?? null,
      seriesIndex: meta?.seriesIndex ?? null,
      rating: meta?.rating ?? null,
      coverSource: (meta?.coverSource as 'extracted' | 'custom' | null) ?? null,
      providerIds: {
        [MetadataProviderKey.GOOGLE]: meta?.googleBooksId ?? null,
        [MetadataProviderKey.GOODREADS]: meta?.goodreadsId ?? null,
        [MetadataProviderKey.AMAZON]: meta?.amazonId ?? null,
        [MetadataProviderKey.HARDCOVER]: meta?.hardcoverId ?? null,
        [MetadataProviderKey.OPEN_LIBRARY]: meta?.openLibraryId ?? null,
        [MetadataProviderKey.ITUNES]: meta?.itunesId ?? null,
      },
      authors: authorRows,
      genres: genreRows.map((g) => g.name),
      tags: tagRows.map((t) => t.name),
      files: fileRows.map((f) => ({
        id: f.id,
        format: f.format,
        role: f.role,
        sizeBytes: f.sizeBytes,
        absolutePath: f.absolutePath,
        createdAt: f.createdAt,
        filename: basename(f.absolutePath),
      })),
      lastWrittenAt: meta?.lastWrittenAt ?? null,
    };
  }
}
