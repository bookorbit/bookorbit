import { Inject, Injectable } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import type { ContentFilterRules, ReadStatus, StorygraphBookSyncMode } from '@bookorbit/types';
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewStorygraphBookState, NewStorygraphUserSetting, StorygraphBookState, StorygraphUserSetting } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BookSyncData {
  bookId: number;
  isbn13: string | null;
  isbn10: string | null;
  title: string | null;
  authorName: string | null;
  format: string | null;
  status: string;
  progress: number | null;
}

export interface StorygraphBookAccessScope {
  accessibleLibraryIds?: number[];
  contentFilters?: ContentFilterRules;
}

export interface StorygraphBookSyncScopeSettings {
  bookSyncMode: StorygraphBookSyncMode;
}

interface BookSyncDataQueryOptions {
  bookId?: number;
  includeUnread?: boolean;
  statuses?: ReadStatus[];
  afterBookId?: number;
  limit?: number;
  accessScope?: StorygraphBookAccessScope;
  syncScope?: StorygraphBookSyncScopeSettings;
}

@Injectable()
export class StorygraphRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- User Settings ----

  async findSettings(userId: number): Promise<StorygraphUserSetting | undefined> {
    return this.db.query.storygraphUserSettings.findFirst({
      where: eq(schema.storygraphUserSettings.userId, userId),
    });
  }

  async upsertSettings(
    userId: number,
    data: Partial<Omit<StorygraphUserSetting, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<StorygraphUserSetting> {
    const [row] = await this.db
      .insert(schema.storygraphUserSettings)
      .values({ userId, ...data } as NewStorygraphUserSetting)
      .onConflictDoUpdate({
        target: schema.storygraphUserSettings.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deleteSettings(userId: number): Promise<void> {
    await this.db.delete(schema.storygraphUserSettings).where(eq(schema.storygraphUserSettings.userId, userId));
  }

  async userHasStorygraphSyncPermission(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({
        isSuperuser: schema.users.isSuperuser,
        permissionName: schema.userPermissions.permissionName,
      })
      .from(schema.users)
      .leftJoin(
        schema.userPermissions,
        and(eq(schema.userPermissions.userId, schema.users.id), eq(schema.userPermissions.permissionName, Permission.StorygraphSync)),
      )
      .where(and(eq(schema.users.id, userId), eq(schema.users.active, true)))
      .limit(1);

    return row?.isSuperuser === true || row?.permissionName === Permission.StorygraphSync;
  }

  // ---- Book State ----

  async findBookState(userId: number, bookId: number): Promise<StorygraphBookState | undefined> {
    return this.db.query.storygraphBookState.findFirst({
      where: and(eq(schema.storygraphBookState.userId, userId), eq(schema.storygraphBookState.bookId, bookId)),
    });
  }

  async findBookStatesByBookIds(userId: number, bookIds: number[]): Promise<StorygraphBookState[]> {
    if (bookIds.length === 0) return [];
    return this.db.query.storygraphBookState.findMany({
      where: and(eq(schema.storygraphBookState.userId, userId), inArray(schema.storygraphBookState.bookId, bookIds)),
    });
  }

  async upsertBookState(data: NewStorygraphBookState): Promise<StorygraphBookState> {
    const [row] = await this.db
      .insert(schema.storygraphBookState)
      .values(data)
      .onConflictDoUpdate({
        target: [schema.storygraphBookState.userId, schema.storygraphBookState.bookId],
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async setBookSyncOverride(userId: number, bookId: number, syncOverride: 'included' | 'excluded' | null): Promise<StorygraphBookState> {
    const [row] = await this.db
      .insert(schema.storygraphBookState)
      .values({ userId, bookId, syncOverride })
      .onConflictDoUpdate({
        target: [schema.storygraphBookState.userId, schema.storygraphBookState.bookId],
        set: { syncOverride, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  // Clears the "already synced" markers while keeping the match, so a book that left the
  // reading list (marked unread) re-syncs when it is added back instead of being treated as
  // up to date against a StoryGraph shelf entry it no longer has.
  async resetSyncProgress(userId: number, bookId: number): Promise<void> {
    await this.db
      .update(schema.storygraphBookState)
      .set({ lastSyncedAt: null, lastSyncedStatus: null, lastSyncedProgress: null, syncError: null, updatedAt: new Date() })
      .where(and(eq(schema.storygraphBookState.userId, userId), eq(schema.storygraphBookState.bookId, bookId)));
  }

  // Clears the cached match and last-synced snapshot so the next sync re-runs matching from
  // scratch instead of trusting a previous (possibly wrong) match.
  async clearBookMatch(userId: number, bookId: number): Promise<void> {
    await this.upsertBookState({
      userId,
      bookId,
      storygraphBookId: null,
      matchMethod: null,
      matchError: null,
      lastSyncedAt: null,
    });
  }

  // ---- Sync Settings ----

  async updateLastSyncedAt(userId: number, at: Date): Promise<void> {
    await this.db.update(schema.storygraphUserSettings).set({ lastSyncedAt: at }).where(eq(schema.storygraphUserSettings.userId, userId));
  }

  async updateSessionCookie(userId: number, sessionCookie: string): Promise<void> {
    await this.db
      .update(schema.storygraphUserSettings)
      .set({ sessionCookie, updatedAt: new Date() })
      .where(eq(schema.storygraphUserSettings.userId, userId));
  }

  // ---- Books for sync ----

  async findSyncableBooks(userId: number, accessScope?: StorygraphBookAccessScope): Promise<BookSyncData[]> {
    return this.findBookSyncDataForUser(userId, { includeUnread: false, accessScope });
  }

  async findSyncableBook(userId: number, bookId: number, accessScope?: StorygraphBookAccessScope): Promise<BookSyncData | null> {
    const [row] = await this.findBookSyncDataForUser(userId, { bookId, includeUnread: false, accessScope });
    return row ?? null;
  }

  async findBookSyncData(userId: number, bookId: number, accessScope?: StorygraphBookAccessScope): Promise<BookSyncData | null> {
    const [row] = await this.findBookSyncDataForUser(userId, { bookId, includeUnread: true, accessScope });
    return row ?? null;
  }

  async findCurrentReadingBooks(userId: number, accessScope?: StorygraphBookAccessScope): Promise<BookSyncData[]> {
    return this.findBookSyncDataForUser(userId, {
      includeUnread: false,
      statuses: ['reading', 'rereading'],
      accessScope,
    });
  }

  async findSyncableBooksBatch(
    userId: number,
    accessScope: StorygraphBookAccessScope | undefined,
    syncScope: StorygraphBookSyncScopeSettings,
    limit: number,
    afterBookId?: number,
  ): Promise<BookSyncData[]> {
    return this.findBookSyncDataForUser(userId, {
      includeUnread: false,
      accessScope,
      syncScope,
      afterBookId,
      limit,
    });
  }

  async countSyncableBooks(
    userId: number,
    accessScope: StorygraphBookAccessScope | undefined,
    syncScope: StorygraphBookSyncScopeSettings,
  ): Promise<number> {
    const bookScopeClauses = this.buildBookScopeClauses(accessScope);
    if (bookScopeClauses === null) return 0;

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.books)
      .leftJoin(schema.userBookStatus, and(eq(schema.userBookStatus.bookId, schema.books.id), eq(schema.userBookStatus.userId, userId)))
      .leftJoin(
        schema.storygraphBookState,
        and(eq(schema.storygraphBookState.userId, userId), eq(schema.storygraphBookState.bookId, schema.books.id)),
      )
      .where(this.buildWhereClause(...bookScopeClauses, ne(schema.userBookStatus.status, 'unread'), this.buildSyncScopeFilter(syncScope)));

    return row?.count ?? 0;
  }

  async countPendingSyncableBooks(
    userId: number,
    accessScope: StorygraphBookAccessScope | undefined,
    syncScope: StorygraphBookSyncScopeSettings,
  ): Promise<number> {
    const bookScopeClauses = this.buildBookScopeClauses(accessScope);
    if (bookScopeClauses === null) return 0;

    const maxProgressSq = this.buildMaxProgressSubquery(userId, bookScopeClauses);

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.books)
      .leftJoin(schema.userBookStatus, and(eq(schema.userBookStatus.bookId, schema.books.id), eq(schema.userBookStatus.userId, userId)))
      .leftJoin(maxProgressSq, eq(maxProgressSq.bookId, schema.books.id))
      .leftJoin(
        schema.storygraphBookState,
        and(eq(schema.storygraphBookState.userId, userId), eq(schema.storygraphBookState.bookId, schema.books.id)),
      )
      .where(
        and(
          ...bookScopeClauses,
          ne(schema.userBookStatus.status, 'unread'),
          this.buildSyncScopeFilter(syncScope),
          or(
            isNull(schema.storygraphBookState.lastSyncedAt),
            sql`${schema.userBookStatus.status} is distinct from ${schema.storygraphBookState.lastSyncedStatus}`,
            sql`${maxProgressSq.maxProgress} is distinct from ${schema.storygraphBookState.lastSyncedProgress}`,
          ),
        ),
      );

    return row?.count ?? 0;
  }

  private async findBookSyncDataForUser(userId: number, options: BookSyncDataQueryOptions = {}): Promise<BookSyncData[]> {
    const bookScopeClauses = this.buildBookScopeClauses(options.accessScope, options.bookId, options.afterBookId);
    if (bookScopeClauses === null) return [];
    const statusFilter =
      options.statuses && options.statuses.length > 0
        ? inArray(schema.userBookStatus.status, options.statuses)
        : options.includeUnread
          ? undefined
          : ne(schema.userBookStatus.status, 'unread');

    const maxProgressSq = this.buildMaxProgressSubquery(userId, bookScopeClauses);
    const firstAuthorSq = this.buildFirstAuthorSubquery(bookScopeClauses);

    const query = this.db
      .select({
        bookId: schema.books.id,
        isbn13: schema.bookMetadata.isbn13,
        isbn10: schema.bookMetadata.isbn10,
        title: schema.bookMetadata.title,
        authorName: firstAuthorSq.authorName,
        format: schema.bookFiles.format,
        status: sql<string>`coalesce(${schema.userBookStatus.status}, 'unread')`,
        progress: maxProgressSq.maxProgress,
      })
      .from(schema.books)
      .leftJoin(schema.userBookStatus, and(eq(schema.userBookStatus.bookId, schema.books.id), eq(schema.userBookStatus.userId, userId)))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .leftJoin(maxProgressSq, eq(maxProgressSq.bookId, schema.books.id))
      .leftJoin(firstAuthorSq, eq(firstAuthorSq.bookId, schema.books.id))
      .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .leftJoin(
        schema.storygraphBookState,
        and(eq(schema.storygraphBookState.userId, userId), eq(schema.storygraphBookState.bookId, schema.books.id)),
      )
      .where(this.buildWhereClause(...bookScopeClauses, statusFilter, options.syncScope ? this.buildSyncScopeFilter(options.syncScope) : undefined))
      .orderBy(asc(schema.books.id));

    const rows = options.limit !== undefined ? await query.limit(options.limit) : await query;

    return rows as BookSyncData[];
  }

  // Books whose most recent sync attempt recorded an error - powers the manual-sync failure list.
  async findBooksWithSyncErrors(
    userId: number,
    accessScope?: StorygraphBookAccessScope,
    limit = 100,
  ): Promise<{ bookId: number; title: string | null; authorName: string | null; syncError: string; lastAttemptAt: Date | null }[]> {
    const bookScopeClauses = this.buildBookScopeClauses(accessScope);
    if (bookScopeClauses === null) return [];
    const firstAuthorSq = this.buildFirstAuthorSubquery(bookScopeClauses);

    const rows = await this.db
      .select({
        bookId: schema.storygraphBookState.bookId,
        title: schema.bookMetadata.title,
        authorName: firstAuthorSq.authorName,
        syncError: schema.storygraphBookState.syncError,
        lastAttemptAt: schema.storygraphBookState.lastSyncedAt,
      })
      .from(schema.storygraphBookState)
      .innerJoin(schema.books, eq(schema.books.id, schema.storygraphBookState.bookId))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.storygraphBookState.bookId))
      .leftJoin(firstAuthorSq, eq(firstAuthorSq.bookId, schema.storygraphBookState.bookId))
      .where(
        this.buildWhereClause(eq(schema.storygraphBookState.userId, userId), isNotNull(schema.storygraphBookState.syncError), ...bookScopeClauses),
      )
      .orderBy(asc(schema.storygraphBookState.bookId))
      .limit(limit);

    return rows as { bookId: number; title: string | null; authorName: string | null; syncError: string; lastAttemptAt: Date | null }[];
  }

  async findBookIdByFileId(bookFileId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, bookFileId))
      .limit(1);
    return row?.bookId ?? null;
  }

  private buildBookScopeClauses(accessScope?: StorygraphBookAccessScope, bookId?: number, afterBookId?: number): SQL[] | null {
    if (accessScope?.accessibleLibraryIds && accessScope.accessibleLibraryIds.length === 0) return null;

    const clauses: SQL[] = [];
    if (bookId !== undefined) clauses.push(eq(schema.books.id, bookId));
    if (afterBookId !== undefined) clauses.push(gt(schema.books.id, afterBookId));
    if (accessScope?.accessibleLibraryIds) clauses.push(inArray(schema.books.libraryId, accessScope.accessibleLibraryIds));
    if (accessScope?.contentFilters) clauses.push(...buildContentFilterClauses(accessScope.contentFilters, this.db));
    return clauses;
  }

  private buildSyncScopeFilter(syncScope: StorygraphBookSyncScopeSettings): SQL {
    if (syncScope.bookSyncMode === 'selected_only') {
      return eq(schema.storygraphBookState.syncOverride, 'included');
    }

    return or(isNull(schema.storygraphBookState.syncOverride), ne(schema.storygraphBookState.syncOverride, 'excluded'))!;
  }

  private buildWhereClause(...clauses: Array<SQL | undefined>): SQL {
    return and(...clauses) ?? sql`true`;
  }

  private buildMaxProgressSubquery(userId: number, bookScopeClauses: SQL[]) {
    return this.db
      .select({
        bookId: schema.books.id,
        maxProgress: sql<number>`max(${schema.readingProgress.percentage})`.as('max_progress'),
      })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.bookId, schema.books.id))
      .innerJoin(schema.readingProgress, and(eq(schema.readingProgress.bookFileId, schema.bookFiles.id), eq(schema.readingProgress.userId, userId)))
      .where(this.buildWhereClause(...bookScopeClauses))
      .groupBy(schema.books.id)
      .as('max_progress_sq');
  }

  private buildFirstAuthorSubquery(bookScopeClauses: SQL[]) {
    return this.db
      .select({
        bookId: schema.bookAuthors.bookId,
        authorName: sql<string>`min(${schema.authors.name})`.as('author_name'),
      })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookAuthors.bookId))
      .where(this.buildWhereClause(...bookScopeClauses))
      .groupBy(schema.bookAuthors.bookId)
      .as('first_author_sq');
  }
}
