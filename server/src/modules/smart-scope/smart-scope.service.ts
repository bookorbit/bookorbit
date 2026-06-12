import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';

import type { BookQuery, BooksPage, GroupRule, JumpBucketsResponse, SortSpec } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import type { SmartScope } from '../../db/schema/smart-scopes';
import { BookService } from '../book/book.service';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { BookReadService } from '../book/book-read.service';
import { validateGroupRule } from '../book/utils/group-rule.validator';
import { LibraryService } from '../library/library.service';
import { CreateSmartScopeDto } from './dto/create-smart-scope.dto';
import { ReorderSmartScopesDto } from './dto/reorder-smart-scopes.dto';
import { UpdateSmartScopeDto } from './dto/update-smart-scope.dto';
import { SmartScopeRepository } from './smart-scope.repository';

function normalizeIcon(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const icon = value.trim();
  return icon.length > 0 ? icon : null;
}

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
  ) {}

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

  async findAll(user: RequestUser) {
    const smartScopes = await this.smartScopeRepo.findAllForUser(user.id);
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    return Promise.all(
      smartScopes.map(async (smartScope) => {
        if (!smartScope.filter) {
          return { ...smartScope, bookCount: 0 };
        }
        const where = this.queryBuilder.buildWhere(smartScope.filter, { accessibleLibraryIds, userId: user.id, timeZone });
        const bookCount = await this.bookReadService.countWhere(where);
        return { ...smartScope, bookCount };
      }),
    );
  }

  async findOne(id: number, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);
    return smartScope;
  }

  async create(dto: CreateSmartScopeDto, user: RequestUser) {
    const filter = validateGroupRule(dto.filter);
    const icon = normalizeIcon(dto.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const [smartScope] = await this.smartScopeRepo.insert({
      userId: user.id,
      name: dto.name,
      icon,
      filter,
      defaultSort: dto.defaultSort ?? [],
      isPublic: dto.isPublic ?? false,
    });
    return smartScope;
  }

  async update(id: number, dto: UpdateSmartScopeDto, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertWriteAccess(smartScope, user, 'modify');

    const hasFilterField = Object.prototype.hasOwnProperty.call(dto, 'filter');
    const filter = hasFilterField ? validateGroupRule(dto.filter) : undefined;
    const icon = dto.icon !== undefined ? normalizeIcon(dto.icon) : normalizeIcon(smartScope.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const [updated] = await this.smartScopeRepo.update(id, smartScope.userId, {
      name: dto.name,
      icon: dto.icon !== undefined ? icon : undefined,
      filter,
      defaultSort: dto.defaultSort,
      isPublic: dto.isPublic,
    });
    return updated;
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

  async executeSmartScope(id: number, user: RequestUser, page: number, size: number, q?: string): Promise<BooksPage> {
    return this.queryBooks(id, user, {
      sort: [],
      pagination: { page, size },
      ...(q?.trim() ? { q: q.trim() } : {}),
    });
  }

  async queryBooks(id: number, user: RequestUser, query: BookQuery): Promise<BooksPage> {
    const start = Date.now();
    this.logger.debug(
      `[smart_scope.query_books] [start] scopeId=${id} userId=${user.id} page=${query.pagination.page} size=${query.pagination.size} - query started`,
    );

    const prepared = await this.prepareBooksQuery(id, user, query);
    if (!prepared) {
      return { items: [], total: 0, page: query.pagination.page, size: query.pagination.size };
    }
    const { where, effectiveQuery } = prepared;

    try {
      const result = await this.bookService.executeBooksQuery(user.id, where, effectiveQuery);
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

  async queryJumpBuckets(id: number, user: RequestUser, query: BookQuery): Promise<JumpBucketsResponse> {
    const prepared = await this.prepareBooksQuery(id, user, query);
    if (!prepared) {
      return { buckets: [], total: 0 };
    }
    // Eligibility is validated by the book service against effectiveQuery.sort,
    // i.e. after the scope's defaultSort has been resolved.
    return this.bookService.executeJumpBucketsQuery(user.id, prepared.where, prepared.effectiveQuery);
  }

  private async prepareBooksQuery(
    id: number,
    user: RequestUser,
    query: BookQuery,
  ): Promise<{ where: SQL | undefined; effectiveQuery: BookQuery } | null> {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);

    if (!smartScope.filter) return null;

    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    const filter = this.combineFilters(smartScope.filter, query.filter);
    const effectiveQuery: BookQuery = {
      ...query,
      filter,
      sort: this.resolveSort(query.sort, smartScope),
    };
    const where = this.queryBuilder.buildWhere(filter, {
      accessibleLibraryIds,
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
