import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, readdir, stat } from 'fs/promises';
import { basename, join } from 'path';

import type { BookCard, BookQuery, BooksPage } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookRepository } from './book.repository';
import { BookDetailDto } from './dto/book-detail.dto';
import { SaveProgressDto } from './dto/save-progress.dto';

@Injectable()
export class BookService {
  private readonly booksPath: string;

  constructor(
    private readonly bookRepo: BookRepository,
    private readonly libraryService: LibraryService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly config: ConfigService,
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

  private assembleBookCards(
    rows: {
      id: number;
      status: string;
      folderPath: string;
      addedAt: Date;
      title: string | null;
      seriesName: string | null;
      seriesIndex: number | null;
      publishedYear: number | null;
      language: string | null;
      rating: number | null;
    }[],
    authorRows: { bookId: number; name: string }[],
    fileRows: { bookId: number; id: number; format: string | null; role: string }[],
    tagRows: { bookId: number; name: string }[],
    progressRows: { bookFileId: number; percentage: number }[],
  ): BookCard[] {
    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    const filesByBook = new Map<number, { id: number; format: string | null; role: string }[]>();
    for (const row of fileRows) {
      const list = filesByBook.get(row.bookId) ?? [];
      list.push({ id: row.id, format: row.format, role: row.role });
      filesByBook.set(row.bookId, list);
    }

    const tagsByBook = new Map<number, string[]>();
    for (const row of tagRows) {
      const list = tagsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      tagsByBook.set(row.bookId, list);
    }

    const progressByFileId = new Map<number, number>();
    for (const row of progressRows) {
      progressByFileId.set(row.bookFileId, row.percentage);
    }

    return rows.map((row) => {
      const files = filesByBook.get(row.id) ?? [];
      const primaryFile = files.find((f) => f.role === 'primary') ?? files[0] ?? null;
      const readingProgress = primaryFile != null ? (progressByFileId.get(primaryFile.id) ?? null) : null;

      return {
        id: row.id,
        status: row.status,
        title: row.title ?? basename(row.folderPath),
        seriesName: row.seriesName ?? null,
        seriesIndex: row.seriesIndex ?? null,
        authors: authorsByBook.get(row.id) ?? [],
        files,
        publishedYear: row.publishedYear ?? null,
        language: row.language ?? null,
        tags: tagsByBook.get(row.id) ?? [],
        rating: row.rating ?? null,
        readingProgress,
        addedAt: row.addedAt.toISOString(),
      };
    });
  }

  async queryForLibrary(user: RequestUser, libraryId: number, query: BookQuery): Promise<BooksPage> {
    await this.libraryService.verifyUserAccess(user.id, libraryId, this.isSuperuser(user));
    const where = this.queryBuilder.buildWhere(query.filter, { accessibleLibraryIds: [libraryId], implicitLibraryId: libraryId });
    const orderBy = this.queryBuilder.buildOrderBy(query.sort);
    const { rows, authorRows, fileRows, tagRows, progressRows, total } = await this.bookRepo.findCards({
      where,
      orderBy,
      limit: query.pagination.size,
      offset: query.pagination.page * query.pagination.size,
      userId: user.id,
    });
    return {
      items: this.assembleBookCards(rows, authorRows, fileRows, tagRows, progressRows),
      total,
      page: query.pagination.page,
      size: query.pagination.size,
    };
  }

  async globalQuery(user: RequestUser, query: BookQuery): Promise<BooksPage> {
    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = libs.map((l) => l.id);
    const where = this.queryBuilder.buildWhere(query.filter, { accessibleLibraryIds });
    const orderBy = this.queryBuilder.buildOrderBy(query.sort);
    const { rows, authorRows, fileRows, tagRows, progressRows, total } = await this.bookRepo.findCards({
      where,
      orderBy,
      limit: query.pagination.size,
      offset: query.pagination.page * query.pagination.size,
      userId: user.id,
    });
    return {
      items: this.assembleBookCards(rows, authorRows, fileRows, tagRows, progressRows),
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
      const cover = files.find((f) => f.startsWith('cover.'));
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

  async updateRating(id: number, rating: number | null, user: RequestUser): Promise<void> {
    await this.verifyBookAccess(id, user);
    await this.bookRepo.updateRating(id, rating);
  }

  async getProgress(userId: number, fileId: number, user: RequestUser) {
    await this.verifyFileAccess(fileId, user);
    return this.bookRepo.findProgress(userId, fileId);
  }

  async saveProgress(userId: number, fileId: number, dto: SaveProgressDto, user: RequestUser) {
    await this.verifyFileAccess(fileId, user);
    await this.bookRepo.upsertProgress(userId, fileId, dto.cfi ?? null, dto.pageNumber ?? null, dto.percentage);
  }

  async getDetail(id: number, user: RequestUser): Promise<BookDetailDto> {
    await this.verifyBookAccess(id, user);
    const result = await this.bookRepo.findById(id);
    if (!result) throw new NotFoundException(`Book ${id} not found`);

    const { book, authorRows, tagRows, fileRows } = result;
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
      authors: authorRows,
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
