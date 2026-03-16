import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';

import type { BooksPage } from '@projectx/types';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import type { RequestUser } from '../../common/types/request-user';
import { books } from '../../db/schema';
import { BookRepository } from '../book/book.repository';
import { CollectionBooksDto } from './dto/collection-books.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { CollectionRepository } from './collection.repository';

@Injectable()
export class CollectionService {
  constructor(
    private readonly collectionRepo: CollectionRepository,
    private readonly bookRepo: BookRepository,
  ) {}

  private isSuperuser(user: RequestUser): boolean {
    return user.isSuperuser;
  }

  private assertAccess(ownerId: number, user: RequestUser): void {
    if (ownerId !== user.id && !this.isSuperuser(user)) {
      throw new ForbiddenException('No access to this collection');
    }
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

  async reorder(dto: ReorderCollectionsDto, user: RequestUser) {
    await this.collectionRepo.updateDisplayOrders(user.id, dto.order);
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
    const { rows, authorRows, fileRows, genreRows, tagRows, progressRows, total } = await this.bookRepo.findCards({
      where,
      orderBy: [],
      limit: size,
      offset: page * size,
      userId: user.id,
    });

    return { items: assembleBookCards(rows, authorRows, fileRows, genreRows, tagRows, progressRows), total, page, size };
  }
}
