import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, type SQL } from 'drizzle-orm';

import {
  APP_FEATURES,
  type BookQuery,
  type BooksPage,
  type JumpBucketsQuery,
  type JumpBucketsResponse,
  type MediaType,
  type PodcastListItem,
  type PodcastPage,
} from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import type { RequestUser } from '../../common/types/request-user';
import { normalizeIconValue } from '../../common/utils/icon-value.utils';
import type { Collection as CollectionRow } from '../../db/schema/collections';
import { BookService } from '../book/book.service';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { LibraryService } from '../library/library.service';
import { PodcastAccessService } from '../podcast/podcast-access.service';
import { PodcastCatalogRepository } from '../podcast/podcast-catalog.repository';
import { AchievementEventsService, ACHIEVEMENT_EVENT_COLLECTION_CREATED } from '../achievement/achievement-events.service';
import { CollectionBooksDto } from './dto/collection-books.dto';
import { CollectionPodcastsDto } from './dto/collection-podcasts.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { CollectionRepository } from './collection.repository';

const COLLECTION_PODCASTS_PAGE_SIZE = 50;
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
    private readonly podcastAccess: PodcastAccessService,
    private readonly podcastCatalogRepo: PodcastCatalogRepository,
  ) {}

  private assertReadAccess(collection: CollectionRow, user: RequestUser): void {
    if (!collection.isPublic && collection.userId !== user.id && !user.isSuperuser) {
      throw new ForbiddenException(COLLECTION_ACCESS_DENIED_MESSAGE);
    }
  }

  private assertWriteAccess(collection: CollectionRow, user: RequestUser): void {
    if (collection.userId !== user.id && !user.isSuperuser) {
      throw new ForbiddenException('Cannot modify this collection');
    }
  }

  private async getCollectionOrThrow(id: number): Promise<CollectionRow> {
    const [collection] = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundException(COLLECTION_NOT_FOUND_MESSAGE);
    return collection;
  }

  private async getReadableCollectionOrThrow(id: number, user: RequestUser): Promise<CollectionRow> {
    const collection = await this.getCollectionOrThrow(id);
    this.assertReadAccess(collection, user);
    return collection;
  }

  private async getWritableCollectionOrThrow(id: number, user: RequestUser): Promise<CollectionRow> {
    const collection = await this.getCollectionOrThrow(id);
    this.assertWriteAccess(collection, user);
    return collection;
  }

  private toResponse<T extends CollectionRow & { bookCount: number }>(collection: T, user: RequestUser) {
    return { ...collection, isOwner: collection.userId === user.id };
  }

  private async buildViewerBookWhere(user: RequestUser): Promise<SQL | undefined> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    return this.queryBuilder.buildWhere(undefined, {
      accessibleLibraryIds: libraryIds,
      userId: user.id,
      timeZone,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });
  }

  private async hydrateForViewer(collection: CollectionRow, user: RequestUser) {
    const visibleBooksWhere = await this.buildViewerBookWhere(user);
    const [hydrated] = await this.collectionRepo.findByIdForViewer(collection.id, user.id, user.isSuperuser, visibleBooksWhere);
    if (!hydrated) throw new NotFoundException(COLLECTION_NOT_FOUND_MESSAGE);
    return this.toResponse(hydrated, user);
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

  async findAll(user: RequestUser, bookIds?: number[]) {
    const visibleBooksWhere = await this.buildViewerBookWhere(user);
    if (bookIds && bookIds.length > 0) {
      const collections = await this.collectionRepo.findAllOwnedForUserWithMembership(user.id, bookIds, visibleBooksWhere);
      return collections.map((collection) => this.toResponse(collection, user));
    }
    const collections = await this.collectionRepo.findAllVisibleForUser(user.id, visibleBooksWhere);
    return collections.map((collection) => this.toResponse(collection, user));
  }

  /**
   * Backs the add-to-collection sheet, which only ever adds books. A selection matching zero
   * books must still list book collections only, or the sheet offers targets that reject the add.
   */
  async findAllWithSelectionMembership(dto: CollectionBooksDto, user: RequestUser) {
    const bookIds = await this.resolveSelectionBookIds(dto, user);
    const visibleBooksWhere = await this.buildViewerBookWhere(user);
    if (bookIds.length > 0) return this.collectionRepo.findAllOwnedForUserWithMembership(user.id, bookIds, visibleBooksWhere);
    const collections = await this.collectionRepo.findAllVisibleForUser(user.id, visibleBooksWhere);
    return collections.filter((collection) => collection.userId === user.id && collection.mediaType === 'books');
  }

  /** Podcast collections annotated with whether they already contain the given show. */
  findAllWithPodcastMembership(user: RequestUser, podcastId: number) {
    if (!APP_FEATURES.podcasts) throw new NotFoundException(COLLECTION_NOT_FOUND_MESSAGE);
    return this.collectionRepo.findAllForUserWithPodcastMembership(user.id, podcastId);
  }

  async findOne(id: number, user: RequestUser) {
    const collection = await this.getReadableCollectionOrThrow(id, user);
    return this.hydrateForViewer(collection, user);
  }

  async create(dto: CreateCollectionDto, user: RequestUser) {
    const icon = normalizeIconValue(dto.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const mediaType: MediaType = dto.mediaType ?? 'books';
    if (mediaType === 'podcasts' && !APP_FEATURES.podcasts) {
      throw new BadRequestException('Podcast collections are not available');
    }
    try {
      const [inserted] = await this.collectionRepo.insert({
        userId: user.id,
        mediaType,
        name: dto.name,
        icon,
        description: dto.description ?? null,
        isPublic: dto.isPublic ?? false,
        // Kobo takes books only, so a podcast collection can never carry the sync flag.
        syncToKobo: mediaType === 'books' ? (dto.syncToKobo ?? false) : false,
      });
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_COLLECTION_CREATED, {
        userId: user.id,
        collectionId: inserted.id,
      });
      return this.hydrateForViewer(inserted, user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A collection with this name already exists');
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateCollectionDto, user: RequestUser) {
    const existing = await this.getWritableCollectionOrThrow(id, user);
    if (dto.syncToKobo === true && existing.mediaType !== 'books') {
      throw new BadRequestException('Podcast collections cannot sync to Kobo');
    }
    const icon = dto.icon !== undefined ? normalizeIconValue(dto.icon) : normalizeIconValue(existing.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }

    try {
      await this.collectionRepo.update(id, existing.userId, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.icon !== undefined && { icon }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        ...(dto.syncToKobo !== undefined && { syncToKobo: dto.syncToKobo }),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A collection with this name already exists');
      }
      throw error;
    }

    const [updated] = await this.collectionRepo.findById(id);
    if (!updated) throw new NotFoundException(COLLECTION_NOT_FOUND_MESSAGE);
    return this.hydrateForViewer(updated, user);
  }

  async remove(id: number, user: RequestUser) {
    const existing = await this.getWritableCollectionOrThrow(id, user);
    await this.collectionRepo.delete(id, existing.userId);
  }

  async reorder(dto: ReorderCollectionsDto, user: RequestUser) {
    const event = 'collection.reorder';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} itemCount=${dto.order.length} - reorder collections started`);
    try {
      const distinctIds = new Set(dto.order.map((item) => item.id));
      if (distinctIds.size !== dto.order.length) {
        throw new BadRequestException('Duplicate collection IDs are not allowed in reorder payload');
      }
      const updatedCount = await this.collectionRepo.updateDisplayOrders(user.id, dto.order);
      if (updatedCount !== dto.order.length) {
        throw new ForbiddenException('Cannot reorder one or more collections');
      }
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

  private assertBookCollection(collection: { mediaType: MediaType }): void {
    if (collection.mediaType !== 'books') {
      throw new BadRequestException('This is a podcast collection; add shows to it instead');
    }
  }

  private assertPodcastCollection(collection: { mediaType: MediaType }): void {
    if (collection.mediaType !== 'podcasts') {
      throw new BadRequestException('This is a book collection; add books to it instead');
    }
  }

  /** Every show must be one the user can actually see, checked before any membership row is written. */
  private async assertPodcastsVisible(podcastIds: number[], user: RequestUser): Promise<void> {
    for (const podcastId of podcastIds) {
      await this.podcastAccess.requirePodcastAccess(podcastId, user);
    }
  }

  async addPodcasts(id: number, dto: CollectionPodcastsDto, user: RequestUser) {
    const event = 'collection.add_podcasts';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] collectionId=${id} userId=${user.id} requestedCount=${dto.podcastIds.length} - add shows started`);
    try {
      const collection = await this.getWritableCollectionOrThrow(id, user);
      this.assertPodcastCollection(collection);
      await this.assertPodcastsVisible(dto.podcastIds, user);
      if (dto.podcastIds.length > 0) {
        await this.collectionRepo.addPodcasts(id, dto.podcastIds);
      }
      this.logger.log(
        `[${event}] [end] collectionId=${id} durationMs=${Date.now() - startedAt} showCount=${dto.podcastIds.length} - add shows completed`,
      );
      return this.hydrateForViewer(collection, user);
    } catch (error) {
      const { errorClass, errorMessage } = this.buildErrorLogFields(error);
      this.logger.warn(
        `[${event}] [fail] collectionId=${id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - add shows failed`,
      );
      throw error;
    }
  }

  async removePodcasts(id: number, dto: CollectionPodcastsDto, user: RequestUser) {
    const collection = await this.getWritableCollectionOrThrow(id, user);
    this.assertPodcastCollection(collection);
    if (dto.podcastIds.length > 0) {
      await this.collectionRepo.removePodcasts(id, dto.podcastIds);
    }
    return this.hydrateForViewer(collection, user);
  }

  /**
   * Member shows. Collections are user-scoped while show listing is library-scoped, so members are
   * grouped by library and hydrated per library, then restored to membership order.
   */
  async getPodcasts(id: number, user: RequestUser, page = 0, size = COLLECTION_PODCASTS_PAGE_SIZE): Promise<PodcastPage<PodcastListItem>> {
    const collection = await this.getReadableCollectionOrThrow(id, user);
    this.assertPodcastCollection(collection);

    // A collection is user-scoped but its members are library-scoped, and access to one member's
    // library can be revoked after the fact. Filtering the membership is what lets the rest of the
    // collection stay readable; checking access per library while hydrating made one lost library
    // take the whole page down with it.
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraryService.findAccessibleLibraryIds(user);
    const [members, total] = await Promise.all([
      this.collectionRepo.findPodcastMembersPage(id, page, size, accessibleLibraryIds),
      this.collectionRepo.countPodcastMembers(id, accessibleLibraryIds),
    ]);
    if (members.length === 0) return { items: [], total, page, size };

    const byLibrary = new Map<number, number[]>();
    for (const member of members) {
      const bucket = byLibrary.get(member.libraryId);
      if (bucket) bucket.push(member.podcastId);
      else byLibrary.set(member.libraryId, [member.podcastId]);
    }

    const pages = await Promise.all(
      [...byLibrary.entries()].map(async ([libraryId, podcastIds]) => {
        const shows = await this.podcastCatalogRepo.listPodcasts(libraryId, user.id, {
          page: 0,
          size: podcastIds.length,
          archived: false,
          podcastIds,
        });
        return shows.items;
      }),
    );

    const byId = new Map(pages.flat().map((show) => [show.id, show]));
    const items = members.map((member) => byId.get(member.podcastId)).filter((show): show is PodcastListItem => show !== undefined);
    return { items, total, page, size };
  }

  async addBooks(id: number, dto: CollectionBooksDto, user: RequestUser) {
    const event = 'collection.add_books';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] collectionId=${id} userId=${user.id} selectionMode=${this.getSelectionMode(dto)} requestedCount=${this.getRequestedCount(dto)} - add books started`,
    );
    try {
      const collection = await this.getWritableCollectionOrThrow(id, user);
      this.assertBookCollection(collection);
      const bookIds = await this.resolveSelectionBookIds(dto, user);
      if (bookIds.length > 0) {
        await this.collectionRepo.addBooks(id, bookIds);
      }
      this.logger.log(`[${event}] [end] collectionId=${id} durationMs=${Date.now() - startedAt} bookCount=${bookIds.length} - add books completed`);
      return this.hydrateForViewer(collection, user);
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
      const collection = await this.getWritableCollectionOrThrow(id, user);
      this.assertBookCollection(collection);
      const bookIds = await this.resolveSelectionBookIds(dto, user);
      if (bookIds.length > 0) {
        await this.collectionRepo.removeBooks(id, bookIds);
      }
      this.logger.log(
        `[${event}] [end] collectionId=${id} durationMs=${Date.now() - startedAt} bookCount=${bookIds.length} - remove books completed`,
      );
      return this.hydrateForViewer(collection, user);
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
      sort: [{ field: 'collectionOrder', dir: 'asc' }],
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
      const page = await this.bookService.executeBooksQuery(user.id, where, query, { defaultCollectionId: id });

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

  async queryJumpBuckets(id: number, user: RequestUser, query: JumpBucketsQuery): Promise<JumpBucketsResponse> {
    const where = await this.buildBooksWhere(id, user, query);
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    return this.bookService.executeJumpBucketsQuery(user.id, where, query, timeZone);
  }

  private async buildBooksWhere(id: number, user: RequestUser, query: BookQuery): Promise<SQL | undefined> {
    await this.getReadableCollectionOrThrow(id, user);
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    const filterWhere = this.queryBuilder.buildWhere(query.filter, {
      accessibleLibraryIds: libraryIds,
      userId: user.id,
      q: query.q,
      timeZone,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });
    return and(filterWhere, this.collectionRepo.buildReadableMembershipWhere(id, user.id, user.isSuperuser));
  }
}
