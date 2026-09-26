import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';

import type {
  BookQuery,
  BooksPage,
  GroupRule,
  JumpBucketsQuery,
  JumpBucketsResponse,
  MediaType,
  PodcastEpisodePage,
  PodcastScopeRules,
  SortSpec,
} from '@bookorbit/types';
import { APP_FEATURES, PODCAST_PLAYLIST_MAX_SAVED } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { normalizeIconValue } from '../../common/utils/icon-value.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import type { SmartScope } from '../../db/schema/smart-scopes';
import { BookService } from '../book/book.service';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { BookReadService } from '../book/book-read.service';
import { validateGroupRule } from '../book/utils/group-rule.validator';
import { LibraryService } from '../library/library.service';
import { PodcastAccessService } from '../podcast/podcast-access.service';
import { toEpisodeRuleQuery } from '../podcast/podcast-episode-query';
import { PodcastEpisodeRepository } from '../podcast/podcast-episode.repository';
import { CreateSmartScopeDto } from './dto/create-smart-scope.dto';
import { ReorderSmartScopesDto } from './dto/reorder-smart-scopes.dto';
import { UpdateSmartScopeDto } from './dto/update-smart-scope.dto';
import { SmartScopeRepository } from './smart-scope.repository';
import { validatePodcastScopeRules } from './utils/podcast-scope-rules.validator';

/**
 * Counting every scope is the one place a single request scales with how many scopes a user has
 * kept, and each count is a full aggregate over their library. Unbounded, a user with enough scopes
 * takes the whole connection pool for themselves and starves every other request until they finish.
 * Four keeps the listing responsive while leaving most of the pool for everyone else.
 */
const SCOPE_COUNT_CONCURRENCY = 4;

/**
 * SmartScopes: server-backed, rule-based dynamic datasets.
 *
 * A SmartScope is a saved filter rule (GroupRule) stored in the database.
 * When queried it executes the rule against the book catalog and returns a
 * live, always-up-to-date subset of books. It is the server-side equivalent
 * of a smart playlist.
 *
 * Concept boundaries:
 *   - SmartScope    → server-backed, rule-based data filtering (what books appear)
 *   - Saved view    → client-only snapshot of presentation state (layout + sort + filter UI)
 *   - Column preset → client-only column layout template (visibility / order / widths)
 *
 * SmartScopes own data scoping. Saved views and presets own presentation state.
 * They are independent: a saved view may be applied on top of any scope.
 */
@Injectable()
export class SmartScopeService {
  private readonly logger = new Logger(SmartScopeService.name);

  constructor(
    private readonly smartScopeRepo: SmartScopeRepository,
    private readonly bookReadService: BookReadService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
    private readonly podcastEpisodeRepo: PodcastEpisodeRepository,
    private readonly podcastAccess: PodcastAccessService,
  ) {}

  private isPodcastScope(smartScope: SmartScope): boolean {
    return smartScope.mediaType === 'podcasts';
  }

  /** Validates a filter against the vocabulary its medium actually uses. */
  private validateFilterFor(mediaType: MediaType, filter: unknown) {
    return mediaType === 'podcasts' ? validatePodcastScopeRules(filter) : validateGroupRule(filter);
  }

  private assertBookScope(smartScope: SmartScope): void {
    if (this.isPodcastScope(smartScope)) {
      throw new BadRequestException('This is a podcast scope; query its episodes instead');
    }
  }

  private assertPodcastScope(smartScope: SmartScope): asserts smartScope is SmartScope & { libraryId: number } {
    if (!this.isPodcastScope(smartScope)) {
      throw new BadRequestException('This is a book scope; query its books instead');
    }
    if (smartScope.libraryId === null) {
      throw new InternalServerErrorException('This podcast scope has no library');
    }
  }

  private async getSmartScopeOrThrow(id: number): Promise<SmartScope> {
    const [smartScope] = await this.smartScopeRepo.findById(id);
    if (!smartScope) {
      throw new NotFoundException('SmartScope not found');
    }
    return smartScope;
  }

  private assertReadAccess(smartScope: SmartScope, user: RequestUser): void {
    if (!smartScope.isPublic && smartScope.userId !== user.id && !user.isSuperuser) {
      throw new ForbiddenException('No access to this smartScope');
    }
  }

  private assertWriteAccess(smartScope: SmartScope, user: RequestUser, action: 'modify' | 'delete'): void {
    if (smartScope.userId !== user.id && !user.isSuperuser) {
      const message = action === 'modify' ? 'Cannot modify this smartScope' : 'Cannot delete this smartScope';
      throw new ForbiddenException(message);
    }
  }

  private toResponse(smartScope: SmartScope, user: RequestUser, koboSyncEnabled: boolean) {
    return { ...smartScope, isOwner: smartScope.userId === user.id, koboSyncEnabled };
  }

  private async resolveKoboSyncEnabled(smartScope: SmartScope, user: RequestUser): Promise<boolean> {
    if (smartScope.userId === user.id) return smartScope.syncToKobo;
    const subscribed = await this.smartScopeRepo.findKoboSubscribedScopeIds(user.id, [smartScope.id]);
    return subscribed.length > 0;
  }

  async findAll(user: RequestUser) {
    const smartScopes = await this.smartScopeRepo.findAllForUser(user.id);
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    /** Null means every library. A shared podcast scope must not count episodes the viewer cannot see. */
    const canSeeLibrary = (libraryId: number | null) =>
      libraryId !== null && (user.isSuperuser || accessibleLibraryIds === null || accessibleLibraryIds.includes(libraryId));
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    const sharedScopeIds = smartScopes.filter((smartScope) => smartScope.userId !== user.id).map((smartScope) => smartScope.id);
    const subscribedIds = new Set(await this.smartScopeRepo.findKoboSubscribedScopeIds(user.id, sharedScopeIds));
    const koboSyncEnabledFor = (smartScope: SmartScope) => (smartScope.userId === user.id ? smartScope.syncToKobo : subscribedIds.has(smartScope.id));
    return mapWithConcurrency(smartScopes, SCOPE_COUNT_CONCURRENCY, async (smartScope) => {
      const countKey = this.isPodcastScope(smartScope) ? 'episodeCount' : 'bookCount';
      if (!smartScope.filter) {
        return { ...this.toResponse(smartScope, user, koboSyncEnabledFor(smartScope)), [countKey]: 0 };
      }
      const startedAt = Date.now();
      try {
        const filter = this.validateFilterFor(smartScope.mediaType, smartScope.filter);
        if (!filter) return { ...this.toResponse(smartScope, user, koboSyncEnabledFor(smartScope)), [countKey]: 0 };

        if (this.isPodcastScope(smartScope)) {
          if (!canSeeLibrary(smartScope.libraryId)) {
            return { ...this.toResponse(smartScope, user, koboSyncEnabledFor(smartScope)), episodeCount: null };
          }
          const episodeCount = await this.podcastEpisodeRepo.countEpisodes(
            smartScope.libraryId as number,
            user.id,
            toEpisodeRuleQuery(filter as PodcastScopeRules),
          );
          return { ...this.toResponse(smartScope, user, koboSyncEnabledFor(smartScope)), episodeCount };
        }

        const where = this.queryBuilder.buildWhere(filter as GroupRule, {
          accessibleLibraryIds,
          userId: user.id,
          timeZone,
          contentFilters: user.isSuperuser ? undefined : user.contentFilters,
        });
        const bookCount = await this.bookReadService.countWhere(where);
        return { ...this.toResponse(smartScope, user, koboSyncEnabledFor(smartScope)), bookCount };
      } catch (err) {
        if (!(err instanceof BadRequestException)) throw err;
        const errorClass = err.constructor.name;
        const error = sanitizeLogValue(err.message);
        this.logger.error(
          `[smart_scope.count] [fail] scopeId=${smartScope.id} userId=${user.id} mediaType=${smartScope.mediaType} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - smart scope filter is invalid`,
        );
        return { ...this.toResponse(smartScope, user, koboSyncEnabledFor(smartScope)), [countKey]: null };
      }
    });
  }

  async findOne(id: number, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);
    return this.toResponse(smartScope, user, await this.resolveKoboSyncEnabled(smartScope, user));
  }

  /**
   * Scopes whose books belong on this user's Kobo. Exposed for the Kobo module so
   * shared-scope opt-in stays owned by this feature.
   */
  findKoboSyncScopes(userId: number): Promise<SmartScope[]> {
    return this.smartScopeRepo.findKoboSyncScopesForUser(userId);
  }

  async setKoboSync(id: number, user: RequestUser, enabled: boolean) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);
    if (this.isPodcastScope(smartScope)) {
      throw new BadRequestException('Podcast scopes cannot sync to Kobo');
    }

    if (smartScope.userId === user.id) {
      const [updated] = await this.smartScopeRepo.update(id, user.id, { syncToKobo: enabled });
      return this.toResponse(updated ?? { ...smartScope, syncToKobo: enabled }, user, enabled);
    }

    if (!smartScope.isPublic) {
      throw new ForbiddenException('Cannot sync a smartScope that is not shared');
    }

    if (enabled) {
      await this.smartScopeRepo.subscribeToKobo(user.id, id);
    } else {
      await this.smartScopeRepo.unsubscribeFromKobo(user.id, id);
    }
    return this.toResponse(smartScope, user, enabled);
  }

  async create(dto: CreateSmartScopeDto, user: RequestUser) {
    const mediaType: MediaType = dto.mediaType ?? 'books';
    if (mediaType === 'podcasts' && !APP_FEATURES.podcasts) {
      throw new BadRequestException('Podcast scopes are not available');
    }
    const libraryId = await this.resolveScopeLibraryId(mediaType, dto.libraryId, user);
    await this.assertSavedPlaylistRoom(mediaType, user);
    const filter = this.validateFilterFor(mediaType, dto.filter);
    const icon = normalizeIconValue(dto.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const syncToKobo = mediaType === 'books' ? (dto.syncToKobo ?? false) : false;
    const [smartScope] = await this.smartScopeRepo.insert({
      userId: user.id,
      mediaType,
      libraryId,
      name: dto.name,
      icon,
      filter,
      defaultSort: dto.defaultSort ?? [],
      isPublic: dto.isPublic ?? false,
      syncToKobo,
    });
    return this.toResponse(smartScope, user, smartScope.syncToKobo);
  }

  /**
   * Saved podcast playlists are capped, and the cap used to live only in the client. That left the
   * limit unenforced for anything not going through the web app, iOS included, and `GET /smart-scopes`
   * returns every scope in one unpaginated response, so an unbounded count is an unbounded payload.
   * Book scopes are deliberately not capped here; they have never been.
   */
  private async assertSavedPlaylistRoom(mediaType: MediaType, user: RequestUser): Promise<void> {
    if (mediaType !== 'podcasts') return;
    const owned = await this.smartScopeRepo.countOwnedByMediaType(user.id, 'podcasts');
    if (owned >= PODCAST_PLAYLIST_MAX_SAVED) {
      throw new BadRequestException(`You can save at most ${PODCAST_PLAYLIST_MAX_SAVED} podcast playlists`);
    }
  }

  /**
   * Podcast scopes live inside one library and book scopes span every accessible one, so the
   * library is required for the first and refused for the second. The library is authorized
   * against the requesting user, so a scope cannot be created against a library they cannot see.
   */
  private async resolveScopeLibraryId(mediaType: MediaType, libraryId: number | undefined, user: RequestUser): Promise<number | null> {
    if (mediaType === 'books') {
      if (libraryId !== undefined) {
        throw new BadRequestException('Book scopes span every accessible library and cannot target one');
      }
      return null;
    }
    if (libraryId === undefined) {
      throw new BadRequestException('Podcast scopes require a library');
    }
    await this.podcastAccess.requirePodcastLibraryAccess(libraryId, user);
    return libraryId;
  }

  async update(id: number, dto: UpdateSmartScopeDto, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertWriteAccess(smartScope, user, 'modify');

    const hasFilterField = Object.prototype.hasOwnProperty.call(dto, 'filter');
    const filter = hasFilterField ? this.validateFilterFor(smartScope.mediaType, dto.filter) : undefined;
    const icon = dto.icon !== undefined ? normalizeIconValue(dto.icon) : normalizeIconValue(smartScope.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    if (dto.syncToKobo === true && this.isPodcastScope(smartScope)) {
      throw new BadRequestException('Podcast scopes cannot sync to Kobo');
    }
    const [updated] = await this.smartScopeRepo.update(id, smartScope.userId, {
      name: dto.name,
      icon: dto.icon !== undefined ? icon : undefined,
      filter,
      defaultSort: dto.defaultSort,
      isPublic: dto.isPublic,
      syncToKobo: dto.syncToKobo,
    });
    return this.toResponse(updated, user, await this.resolveKoboSyncEnabled(updated, user));
  }

  async remove(id: number, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertWriteAccess(smartScope, user, 'delete');
    await this.smartScopeRepo.delete(id, smartScope.userId);
  }

  async reorder(dto: ReorderSmartScopesDto, user: RequestUser) {
    const distinctIds = new Set(dto.order.map((item) => item.id));
    if (distinctIds.size !== dto.order.length) {
      throw new BadRequestException('Duplicate smartScope IDs are not allowed in reorder payload');
    }

    const updatedCount = await this.smartScopeRepo.updateDisplayOrders(user.id, dto.order);
    if (updatedCount !== dto.order.length) {
      throw new ForbiddenException('Cannot reorder one or more smartScopes');
    }
  }

  async executeSmartScope(
    id: number,
    user: RequestUser,
    page: number,
    size: number,
    q?: string,
    libraryIdsRestriction?: readonly number[],
  ): Promise<BooksPage> {
    return this.queryBooks(
      id,
      user,
      {
        sort: [],
        pagination: { page, size },
        ...(q?.trim() ? { q: q.trim() } : {}),
      },
      libraryIdsRestriction,
    );
  }

  async executeSmartScopeBookIds(id: number, user: RequestUser, size: number, libraryIdsRestriction?: readonly number[]): Promise<number[]> {
    const query: BookQuery = { sort: [], pagination: { page: 0, size } };
    const prepared = await this.prepareBooksQuery(id, user, query, libraryIdsRestriction);
    if (!prepared) return [];
    return this.bookService.executeBookIdsQuery(user.id, prepared.where, prepared.effectiveQuery);
  }

  async queryBooks(id: number, user: RequestUser, query: BookQuery, libraryIdsRestriction?: readonly number[]): Promise<BooksPage> {
    const start = Date.now();
    this.logger.debug(
      `[smart_scope.query_books] [start] scopeId=${id} userId=${user.id} page=${query.pagination.page} size=${query.pagination.size} - query started`,
    );

    const prepared = await this.prepareBooksQuery(id, user, query, libraryIdsRestriction);
    if (!prepared) {
      return { items: [], total: 0, page: query.pagination.page, size: query.pagination.size };
    }
    const { where, effectiveQuery } = prepared;

    try {
      const result = await this.bookService.executeBooksQuery(user.id, where, effectiveQuery, {
        seriesSelectionFilter: query.filter,
      });
      const durationMs = Date.now() - start;
      if (durationMs >= 500) {
        this.logger.warn(
          `[smart_scope.query_books] [end] scopeId=${id} userId=${user.id} resultCount=${result.items.length} durationMs=${durationMs} - slow query`,
        );
      }
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      this.logger.error(
        `[smart_scope.query_books] [fail] scopeId=${id} userId=${user.id} durationMs=${durationMs} errorClass=${(err as Error).constructor?.name} error="${(err as Error).message}" - query failed`,
      );
      throw err;
    }
  }

  async queryJumpBuckets(id: number, user: RequestUser, query: JumpBucketsQuery): Promise<JumpBucketsResponse> {
    const prepared = await this.prepareBooksQuery(id, user, query);
    if (!prepared) {
      return { buckets: [], total: 0, kind: 'letter', granularity: null };
    }
    // Eligibility is validated by the book service against effectiveQuery.sort,
    // i.e. after the scope's defaultSort has been resolved.
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    return this.bookService.executeJumpBucketsQuery(user.id, prepared.where, prepared.effectiveQuery, timeZone, {
      seriesSelectionFilter: query.filter,
    });
  }

  /**
   * Episodes a podcast scope matches. The rules are re-validated on read because the column is
   * jsonb: a scope stored before a vocabulary change must fail loudly rather than silently
   * matching everything.
   */
  async queryEpisodes(id: number, user: RequestUser, page: number, size: number, q?: string): Promise<PodcastEpisodePage> {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);
    this.assertPodcastScope(smartScope);
    // A public scope is readable by everyone, but its library is not: authorize the requester,
    // not the owner, or a shared scope becomes a window into a library they cannot open.
    await this.podcastAccess.requirePodcastLibraryAccess(smartScope.libraryId, user);

    const rules = validatePodcastScopeRules(smartScope.filter);
    if (!rules) {
      return { items: [], total: 0, totalDurationSeconds: 0, page, size };
    }

    const search = q?.trim();
    return this.podcastEpisodeRepo.listEpisodes(smartScope.libraryId, user.id, {
      ...toEpisodeRuleQuery(rules),
      ...(search ? { q: search } : {}),
      page,
      size,
    });
  }

  private async prepareBooksQuery<T extends BookQuery>(
    id: number,
    user: RequestUser,
    query: T,
    libraryIdsRestriction?: readonly number[],
  ): Promise<{ where: SQL | undefined; effectiveQuery: T } | null> {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);
    this.assertBookScope(smartScope);

    const scopeFilter = validateGroupRule(smartScope.filter);
    if (!scopeFilter) return null;

    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const restriction = libraryIdsRestriction ? new Set(libraryIdsRestriction) : undefined;
    const restrictedLibraryIds = restriction ? accessibleLibraryIds.filter((libraryId) => restriction.has(libraryId)) : accessibleLibraryIds;
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    const filter = this.combineFilters(scopeFilter, query.filter);
    const effectiveQuery: T = {
      ...query,
      filter,
      sort: this.resolveSort(query.sort, smartScope),
    };
    const where = this.queryBuilder.buildWhere(filter, {
      accessibleLibraryIds: restrictedLibraryIds,
      userId: user.id,
      q: query.q,
      timeZone,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });
    return { where, effectiveQuery };
  }

  private combineFilters(scopeFilter: GroupRule | null, queryFilter?: GroupRule): GroupRule | undefined {
    if (!scopeFilter) return undefined;
    if (!queryFilter) return scopeFilter;
    return {
      type: 'group',
      join: 'AND',
      rules: [scopeFilter, queryFilter],
    };
  }

  private resolveSort(querySort: SortSpec[] | undefined, smartScope: SmartScope): SortSpec[] {
    if (querySort && querySort.length > 0) {
      return querySort;
    }
    return smartScope.defaultSort ?? [];
  }
}
