import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, readdir, rm, stat } from 'fs/promises';
import { basename, join } from 'path';

import { MetadataProviderKey } from '@projectx/types';
import type { BookQuery, BooksPage, MetadataField } from '@projectx/types';
import { assembleBookCards } from './utils/assemble-book-cards';
import type { RequestUser } from '../../common/types/request-user';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { MetadataService } from '../metadata/metadata.service';
import { LibraryService } from '../library/library.service';
import { MetadataFetchPipeline, ResolvedMetadataFields } from '../metadata-fetch/metadata-fetch-pipeline';
import type { MetadataSearchParams } from '../metadata-fetch/providers/metadata-search-params';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookRepository } from './book.repository';
import { BookDetailDto } from './dto/book-detail.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';

@Injectable()
export class BookService {
  private readonly logger = new Logger(BookService.name);
  private readonly booksPath: string;

  constructor(
    private readonly bookRepo: BookRepository,
    private readonly libraryService: LibraryService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly metadataService: MetadataService,
    private readonly pipeline: MetadataFetchPipeline,
    private readonly config: ConfigService,
    @Optional() private readonly embedder: BookEmbedderService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  private isSuperuser(user: RequestUser): boolean {
    return user.roles.some((r) => r.isSuperuser);
  }

  private async verifyBookAccess(bookId: number, user: RequestUser): Promise<void> {
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

  async getFileInfo(fileId: number, user: RequestUser): Promise<{ path: string; size: number; format: string }> {
    const file = await this.verifyFileAccess(fileId, user);
    const { size } = await stat(file.absolutePath);
    return { path: file.absolutePath, size, format: file.format ?? 'unknown' };
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
    await this.bookRepo.deleteByIds(bookIds);
    for (const { id: bookId } of rows) {
      const coverDir = join(this.booksPath, 'covers', String(bookId));
      rm(coverDir, { recursive: true, force: true }).catch((err: Error) =>
        this.logger.warn(`Failed to delete cover dir ${coverDir}: ${err.message}`),
      );
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

  async refreshMetadata(id: number, preview: boolean, user: RequestUser): Promise<BookDetailDto | ResolvedMetadataFields> {
    const found = await this.bookRepo.findById(id);
    if (!found) throw new NotFoundException(`Book ${id} not found`);

    const { book, authorRows } = found;
    await this.libraryService.verifyUserAccess(user.id, book.books.libraryId, this.isSuperuser(user));
    const meta = book.book_metadata;

    const providerIds: Partial<Record<MetadataProviderKey, string>> = {};
    if (meta?.googleBooksId) providerIds[MetadataProviderKey.GOOGLE] = meta.googleBooksId;
    if (meta?.goodreadsId) providerIds[MetadataProviderKey.GOODREADS] = meta.goodreadsId;
    if (meta?.amazonId) providerIds[MetadataProviderKey.AMAZON] = meta.amazonId;
    if (meta?.hardcoverId) providerIds[MetadataProviderKey.HARDCOVER] = meta.hardcoverId;
    if (meta?.openLibraryId) providerIds[MetadataProviderKey.OPEN_LIBRARY] = meta.openLibraryId;

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
      cover: meta?.coverSource,
    };

    const resolved = await this.pipeline.run(searchParams, existingFields, book.books.libraryId);

    if (preview) return resolved;

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
        this.logger.warn(`Bulk metadata refresh failed for book ${id}: ${err}`);
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
        onProgress?.(id);
      }
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
    return files.map((f) => ({ absolutePath: f.absolutePath, zipPath: `${f.bookId}/${basename(f.absolutePath)}` }));
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
    };
  }
}
