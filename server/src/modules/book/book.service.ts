import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { access, readdir, stat } from 'fs/promises';
import { basename, join } from 'path';

import { BookRepository } from './book.repository';
import { BookCardDto } from './dto/book-card.dto';
import { BookDetailDto } from './dto/book-detail.dto';
import { GetBooksDto } from './dto/get-books.dto';

@Injectable()
export class BookService {
  private readonly booksPath: string;

  constructor(
    private readonly bookRepo: BookRepository,
    private readonly config: ConfigService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  async getCards(dto: GetBooksDto): Promise<{ items: BookCardDto[]; total: number; page: number; size: number }> {
    const { libraryId, page = 0, size = 50, search } = dto;
    const { rows, authorRows, fileRows, total } = await this.bookRepo.findCards(libraryId, { page, size, search });

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

    const items: BookCardDto[] = rows.map((row) => ({
      id: row.id,
      status: row.status,
      title: row.title ?? basename(row.folderPath),
      seriesName: row.seriesName ?? null,
      seriesIndex: row.seriesIndex ?? null,
      authors: authorsByBook.get(row.id) ?? [],
      files: filesByBook.get(row.id) ?? [],
    }));

    return { items, total, page, size };
  }

  async getCoverPath(id: number): Promise<string | null> {
    const dir = join(this.booksPath, 'covers', String(id));
    try {
      const files = await readdir(dir);
      const cover = files.find((f) => f.startsWith('cover.'));
      return cover ? join(dir, cover) : null;
    } catch {
      return null;
    }
  }

  async getThumbnailPath(id: number): Promise<string | null> {
    const path = join(this.booksPath, 'covers', String(id), 'thumbnail.jpg');
    return access(path).then(() => path).catch(() => null);
  }

  async getFileInfo(fileId: number): Promise<{ path: string; size: number; format: string }> {
    const file = await this.bookRepo.findFileById(fileId);
    if (!file) throw new NotFoundException(`No file with id ${fileId}`);
    const { size } = await stat(file.absolutePath);
    return { path: file.absolutePath, size, format: file.format ?? 'unknown' };
  }

  async getProgress(fileId: number) {
    return this.bookRepo.findProgress(fileId);
  }

  async saveProgress(fileId: number, cfi: string | null | undefined, pageNumber: number | null | undefined, percentage: number) {
    await this.bookRepo.upsertProgress(fileId, cfi ?? null, pageNumber ?? null, percentage);
  }

  async getDetail(id: number): Promise<BookDetailDto> {
    const result = await this.bookRepo.findById(id);
    if (!result) throw new NotFoundException(`Book ${id} not found`);

    const { book, authorRows, tagRows, fileRows } = result;
    const meta = book.book_metadata;

    return {
      id: book.books.id,
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
      files: fileRows,
    };
  }
}
