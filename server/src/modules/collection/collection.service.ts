import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { basename } from 'path';
import { inArray } from 'drizzle-orm';

import type { BookCard, BooksPage } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { books } from '../../db/schema';
import { BookRepository } from '../book/book.repository';
import { CollectionBooksDto } from './dto/collection-books.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { CollectionRepository } from './collection.repository';

@Injectable()
export class CollectionService {
  constructor(
    private readonly collectionRepo: CollectionRepository,
    private readonly bookRepo: BookRepository,
  ) {}

  private isSuperuser(user: RequestUser): boolean {
    return user.roles.some((r) => r.isSuperuser);
  }

  private assertAccess(ownerId: number, user: RequestUser): void {
    if (ownerId !== user.id && !this.isSuperuser(user)) {
      throw new ForbiddenException('No access to this collection');
    }
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
    progressRows: { bookFileId: number; percentage: number | null }[],
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

    const progressByFileId = new Map<number, number | null>();
    for (const row of progressRows) {
      progressByFileId.set(row.bookFileId, row.percentage);
    }

    return rows.map((row) => {
      const primaryFile = (filesByBook.get(row.id) ?? []).find((f) => f.role === 'primary');
      const readingProgress = primaryFile ? (progressByFileId.get(primaryFile.id) ?? null) : null;
      return {
        id: row.id,
        status: row.status,
        title: row.title ?? basename(row.folderPath),
        seriesName: row.seriesName ?? null,
        seriesIndex: row.seriesIndex ?? null,
        publishedYear: row.publishedYear ?? null,
        language: row.language ?? null,
        rating: row.rating ?? null,
        addedAt: row.addedAt.toISOString(),
        authors: authorsByBook.get(row.id) ?? [],
        files: filesByBook.get(row.id) ?? [],
        tags: tagsByBook.get(row.id) ?? [],
        readingProgress,
      };
    });
  }

  findAll(user: RequestUser, bookIds?: number[]) {
    if (bookIds && bookIds.length > 0) {
      return this.collectionRepo.findAllForUserWithMembership(user.id, bookIds);
    }
    return this.collectionRepo.findAllForUser(user.id);
  }

  async findOne(id: number, user: RequestUser) {
    const [collection] = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundException('Collection not found');
    this.assertAccess(collection.userId, user);
    return collection;
  }

  async create(dto: CreateCollectionDto, user: RequestUser) {
    const [inserted] = await this.collectionRepo.insert({
      userId: user.id,
      name: dto.name,
      icon: dto.icon?.trim() || null,
      description: dto.description ?? null,
      syncToKobo: dto.syncToKobo ?? false,
    });
    const [collection] = await this.collectionRepo.findById(inserted.id);
    return collection;
  }

  async update(id: number, dto: UpdateCollectionDto, user: RequestUser) {
    const [existing] = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundException('Collection not found');
    this.assertAccess(existing.userId, user);

    const [updated] = await this.collectionRepo.update(id, existing.userId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.icon !== undefined && { icon: dto.icon.trim() || null }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.syncToKobo !== undefined && { syncToKobo: dto.syncToKobo }),
    });
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    const [existing] = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundException('Collection not found');
    this.assertAccess(existing.userId, user);
    await this.collectionRepo.delete(id, existing.userId);
  }

  async addBooks(id: number, dto: CollectionBooksDto, user: RequestUser) {
    const [existing] = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundException('Collection not found');
    this.assertAccess(existing.userId, user);
    await this.collectionRepo.addBooks(id, dto.bookIds);
    const [updated] = await this.collectionRepo.findById(id);
    return updated;
  }

  async removeBooks(id: number, dto: CollectionBooksDto, user: RequestUser) {
    const [existing] = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundException('Collection not found');
    this.assertAccess(existing.userId, user);
    await this.collectionRepo.removeBooks(id, dto.bookIds);
    const [updated] = await this.collectionRepo.findById(id);
    return updated;
  }

  async getBooks(id: number, user: RequestUser, page: number, size: number): Promise<BooksPage> {
    const [existing] = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundException('Collection not found');
    this.assertAccess(existing.userId, user);

    const bookIdRows = await this.collectionRepo.findBookIds(id);
    if (bookIdRows.length === 0) {
      return { items: [], total: 0, page, size };
    }

    const bookIds = bookIdRows.map((r) => r.bookId);
    const where = inArray(books.id, bookIds);
    const { rows, authorRows, fileRows, tagRows, progressRows, total } = await this.bookRepo.findCards({
      where,
      orderBy: [],
      limit: size,
      offset: page * size,
      userId: user.id,
    });

    return { items: this.assembleBookCards(rows, authorRows, fileRows, tagRows, progressRows), total, page, size };
  }
}
