import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, type SQL } from 'drizzle-orm';

import type { BookQuery, BooksPage, JumpBucketsResponse } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import type { RequestUser } from '../../common/types/request-user';
import { normalizeIconValue } from '../../common/utils/icon-value.utils';
import { BookService } from '../book/book.service';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { LibraryService } from '../library/library.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_COLLECTION_CREATED } from '../achievement/achievement-events.service';
import { CollectionBooksDto } from './dto/collection-books.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { CollectionRepository } from './collection.repository';

const COLLECTION_NOT_FOUND_MESSAGE = 'Collection not found';
const COLLECTION_ACCESS_DENIED_MESSAGE = 'No access to this collection';

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const directCode = (error as { code?: unknown }).code;
  if (directCode === '23505') return true;

  if (!(error instanceof Error)) return false;
  const causeCode = (error.cause as { code?: unknown } | undefined)?.code;
  return causeCode === '23505';
}

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly collectionRepo: CollectionRepository,
    private readonly libraryService: LibraryService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly bookService: BookService,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  private assertAccess(ownerId: number, user: RequestUser): void {
    if (ownerId !== user.id && !user.isSuperuser) {
      throw new ForbiddenException(COLLECTION_ACCESS_DENIED_MESSAGE);
    }
  }

  private async findCollectionForUserOrThrow(id: number, user: RequestUser) {
    const [collection] = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundException(COLLECTION_NOT_FOUND_MESSAGE);
    this.assertAccess(collection.userId, user);
    return collection;
  }

  private buildErrorLogFields(error: unknown): { errorClass: string; errorMessage: string } {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    return { errorClass, errorMessage };
  }

  private getSelectionMode(dto: CollectionBooksDto): 'ids' | 'query' {
    return dto.query ? 'query' : 'ids';
  }

  private getRequestedCount(dto: CollectionBooksDto): number {
    return dto.bookIds?.length ?? 0;
  }

  private async resolveSelectionBookIds(dto: CollectionBooksDto, user: RequestUser): Promise<number[]> {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return [...new Set(ids)];
  }

  findAll(user: RequestUser, bookIds?: number[]) {
    if (bookIds && bookIds.length > 0) {
      return this.collectionRepo.findAllForUserWithMembership(user.id, bookIds);
    }
    return this.collectionRepo.findAllForUser(user.id);
  }

  async findAllWithSelectionMembership(dto: CollectionBooksDto, user: RequestUser) {
    const bookIds = await this.resolveSelectionBookIds(dto, user);
    return this.findAll(user, bookIds);
  }

  async findOne(id: number, user: RequestUser) {
    return this.findCollectionForUserOrThrow(id, user);
  }

  async create(dto: CreateCollectionDto, user: RequestUser) {
    const icon = normalizeIconValue(dto.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    try {
      const [inserted] = await this.collectionRepo.insert({
        userId: user.id,
        name: dto.name,
        icon,
        description: dto.description ?? null,
        syncToKobo: dto.syncToKobo ?? false,
      });
      const [collection] = await this.collectionRepo.findById(inserted.id);
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_COLLECTION_CREATED, {
        userId: user.id,
        collectionId: inserted.id,
      });
      return collection;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A collection with this name already exists');
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateCollectionDto, user: RequestUser) {
    const existing = await this.findCollectionForUserOrThrow(id, user);
    const icon = dto.icon !== undefined ? normalizeIconValue(dto.icon) : normalizeIconValue(existing.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }

    try {
      await this.collectionRepo.update(id, existing.userId, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.icon !== undefined && { icon }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.syncToKobo !== undefined && { syncToKobo: dto.syncToKobo }),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A collection with this name already exists');
      }
      throw error;
    }

    const [updated] = await this.collectionRepo.findById(id);
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    const existing = await this.findCollectionForUserOrThrow(id, user);
    await this.collectionRepo.delete(id, existing.userId);
  }

  async reorder(dto: ReorderCollectionsDto, user: RequestUser) {
    const event = 'collection.reorder';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} itemCount=${dto.order.length} - reorder collections started`);
    try {
      await this.collectionRepo.updateDisplayOrders(user.id, dto.order);
      this.logger.log(
        `[${event}] [end] userId=${user.id} durationMs=${Date.now() - startedAt} itemCount=${dto.order.length} - reorder collections completed`,
      );
    } catch (error) {
      const { errorClass, errorMessage } = this.buildErrorLogFields(error);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - reorder collections failed`,
      );
      throw error;
    }
  }

  async addBooks(id: number, dto: CollectionBooksDto, user: RequestUser) {
    const event = 'collection.add_books';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] collectionId=${id} userId=${user.id} selectionMode=${this.getSelectionMode(dto)} requestedCount=${this.getRequestedCount(dto)} - add books started`,
    );
    try {
      await this.findCollectionForUserOrThrow(id, user);
      const bookIds = await this.resolveSelectionBookIds(dto, user);
      if (bookIds.length > 0) {
        await this.collectionRepo.addBooks(id, bookIds);
      }
      const [updated] = await this.collectionRepo.findById(id);
      this.logger.log(`[${event}] [end] collectionId=${id} durationMs=${Date.now() - startedAt} bookCount=${bookIds.length} - add books completed`);
      return updated;
    } catch (error) {
      const { errorClass, errorMessage } = this.buildErrorLogFields(error);
      this.logger.warn(
        `[${event}] [fail] collectionId=${id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - add books failed`,
      );
      throw error;
    }
  }

  async removeBooks(id: number, dto: CollectionBooksDto, user: RequestUser) {
    const event = 'collection.remove_books';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] collectionId=${id} userId=${user.id} selectionMode=${this.getSelectionMode(dto)} requestedCount=${this.getRequestedCount(dto)} - remove books started`,
    );
    try {
      await this.findCollectionForUserOrThrow(id, user);
      const bookIds = await this.resolveSelectionBookIds(dto, user);
      if (bookIds.length > 0) {
        await this.collectionRepo.removeBooks(id, bookIds);
      }
      const [updated] = await this.collectionRepo.findById(id);
      this.logger.log(
        `[${event}] [end] collectionId=${id} durationMs=${Date.now() - startedAt} bookCount=${bookIds.length} - remove books completed`,
      );
      return updated;
    } catch (error) {
      const { errorClass, errorMessage } = this.buildErrorLogFields(error);
      this.logger.warn(
        `[${event}] [fail] collectionId=${id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - remove books failed`,
      );
      throw error;
    }
  }

  async getBooks(id: number, user: RequestUser, page: number, size: number, collapseSeries?: boolean, q?: string): Promise<BooksPage> {
    return this.queryBooks(id, user, {
      sort: [],
      pagination: { page, size },
      ...(collapseSeries ? { collapseSeries: true } : {}),
      ...(q?.trim() ? { q: q.trim() } : {}),
    });
  }

  async queryBooks(id: number, user: RequestUser, query: BookQuery): Promise<BooksPage> {
    const event = 'collection.query_books';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] collectionId=${id} userId=${user.id} page=${query.pagination.page} size=${query.pagination.size} collapseSeries=${query.collapseSeries ?? false} hasSearch=${!!query.q?.trim()} - query collection books started`,
    );
    try {
      const where = await this.buildBooksWhere(id, user, query);
      const page = await this.bookService.executeBooksQuery(user.id, where, query);

      this.logger.log(
        `[${event}] [end] collectionId=${id} durationMs=${Date.now() - startedAt} total=${page.total} itemCount=${page.items.length} - query collection books completed`,
      );
      return page;
    } catch (error) {
      const { errorClass, errorMessage } = this.buildErrorLogFields(error);
      this.logger.warn(
        `[${event}] [fail] collectionId=${id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - query collection books failed`,
      );
      throw error;
    }
  }

  async queryJumpBuckets(id: number, user: RequestUser, query: BookQuery): Promise<JumpBucketsResponse> {
    const where = await this.buildBooksWhere(id, user, query);
    return this.bookService.executeJumpBucketsQuery(user.id, where, query);
  }

  private async buildBooksWhere(id: number, user: RequestUser, query: BookQuery): Promise<SQL | undefined> {
    await this.findCollectionForUserOrThrow(id, user);
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    const filterWhere = this.queryBuilder.buildWhere(query.filter, {
      accessibleLibraryIds: libraryIds,
      userId: user.id,
      q: query.q,
      timeZone,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });
    return and(filterWhere, this.collectionRepo.buildMembershipWhere(id));
  }
}
