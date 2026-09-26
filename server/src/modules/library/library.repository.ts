import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gt, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { APP_FEATURES, type AccessLevel, type ContentFilterRules, type LibraryStats } from '@bookorbit/types';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import { MIN_VALID_FILE_TIME_MS } from '../../common/utils/file-time.utils';
import * as schema from '../../db/schema';
import {
  bookFiles,
  books,
  libraries,
  libraryFolders,
  podcastEpisodeMedia,
  podcastEpisodes,
  podcastJobs,
  podcastLibrarySettings,
  podcasts,
} from '../../db/schema';
import { LIBRARY_BOOK_STATUS_PRESENT } from './library.constants';

type Db = NodePgDatabase<typeof schema>;

const visibleLibraryCondition = APP_FEATURES.podcasts ? undefined : eq(libraries.type, 'books');

/**
 * Podcast libraries hold shows rather than books, so the row count that fills their badge comes from
 * a different table. The subquery only runs for podcast libraries, and it excludes archived shows so
 * the count matches the show list the library view opens on.
 */
const podcastShowCount = sql<number | null>`case when ${libraries.type} = 'podcasts' then (
  select count(*)::int from ${podcasts} where ${podcasts.libraryId} = ${libraries.id} and ${podcasts.archivedAt} is null
) end`;

@Injectable()
export class LibraryRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db
      .select({
        ...getTableColumns(libraries),
        accessLevel: sql<AccessLevel | null>`null`,
        bookCount: sql<number>`count(${books.id})::int`,
        podcastCount: podcastShowCount,
      })
      .from(libraries)
      .leftJoin(books, and(eq(books.libraryId, libraries.id), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)))
      .where(visibleLibraryCondition)
      .groupBy(libraries.id)
      .orderBy(libraries.displayOrder, libraries.name);
  }

  findAllForUser(userId: number, contentFilters?: ContentFilterRules) {
    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const bookJoinOn = and(eq(books.libraryId, libraries.id), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT), ...filterClauses)!;

    return this.db
      .select({
        id: libraries.id,
        type: libraries.type,
        accessLevel: schema.userLibraryAccess.accessLevel,
        name: libraries.name,
        icon: libraries.icon,
        displayOrder: libraries.displayOrder,
        coverAspectRatio: libraries.coverAspectRatio,
        scanMode: libraries.scanMode,
        fileRenameEnabled: libraries.fileRenameEnabled,
        createdAt: libraries.createdAt,
        updatedAt: libraries.updatedAt,
        bookCount: sql<number>`count(${books.id})::int`,
        podcastCount: podcastShowCount,
      })
      .from(libraries)
      .innerJoin(schema.userLibraryAccess, and(eq(schema.userLibraryAccess.libraryId, libraries.id), eq(schema.userLibraryAccess.userId, userId)))
      .leftJoin(books, bookJoinOn)
      .where(visibleLibraryCondition)
      .groupBy(libraries.id, schema.userLibraryAccess.accessLevel)
      .orderBy(libraries.displayOrder, libraries.name);
  }

  findAllIds() {
    return this.db.select({ id: libraries.id }).from(libraries).where(visibleLibraryCondition).orderBy(libraries.displayOrder, libraries.name);
  }

  findAutoScanSchedules() {
    return this.db
      .select({ id: libraries.id, autoScanCronExpression: libraries.autoScanCronExpression })
      .from(libraries)
      .where(isNotNull(libraries.autoScanCronExpression))
      .orderBy(libraries.id);
  }

  findAccessibleIdsForUser(userId: number) {
    return this.db
      .select({ id: libraries.id })
      .from(libraries)
      .innerJoin(schema.userLibraryAccess, and(eq(schema.userLibraryAccess.libraryId, libraries.id), eq(schema.userLibraryAccess.userId, userId)))
      .where(visibleLibraryCondition)
      .orderBy(libraries.displayOrder, libraries.name);
  }

  findById(id: number) {
    return this.db
      .select()
      .from(libraries)
      .where(and(eq(libraries.id, id), visibleLibraryCondition))
      .limit(1);
  }

  findByIds(ids: number[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(and(inArray(libraries.id, ids), visibleLibraryCondition));
  }

  findByName(name: string, excludeId?: number) {
    return this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(
        excludeId
          ? and(eq(sql`lower(${libraries.name})`, name.toLowerCase()), sql`${libraries.id} != ${excludeId}`)
          : eq(sql`lower(${libraries.name})`, name.toLowerCase()),
      )
      .limit(1);
  }

  findFoldersByLibrary(libraryId: number) {
    return this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, libraryId)).orderBy(libraryFolders.createdAt, libraryFolders.id);
  }

  findAllFolders() {
    return this.db.select().from(libraryFolders).orderBy(libraryFolders.libraryId, libraryFolders.createdAt, libraryFolders.id);
  }

  findFoldersByLibraryIds(libraryIds: number[]) {
    if (libraryIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(libraryFolders)
      .where(inArray(libraryFolders.libraryId, libraryIds))
      .orderBy(libraryFolders.libraryId, libraryFolders.createdAt, libraryFolders.id);
  }

  findAllFolderPaths() {
    return this.db
      .select({ libraryId: libraryFolders.libraryId, path: libraryFolders.path, libraryName: libraries.name })
      .from(libraryFolders)
      .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
      .orderBy(libraries.displayOrder, libraries.name, libraryFolders.createdAt, libraryFolders.id);
  }

  insert(data: typeof libraries.$inferInsert) {
    return this.db.insert(libraries).values(data).returning();
  }

  update(id: number, data: Partial<typeof libraries.$inferInsert>) {
    return this.db
      .update(libraries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(libraries.id, id))
      .returning();
  }

  insertFolders(data: (typeof libraryFolders.$inferInsert)[]) {
    return this.db.insert(libraryFolders).values(data).returning();
  }

  insertPodcastSettings(libraryId: number) {
    return this.db.insert(podcastLibrarySettings).values({ libraryId }).onConflictDoNothing();
  }

  /**
   * Files BookOrbit downloaded and may therefore delete. Local-origin media is excluded: those rows
   * point at files the user brought, which BookOrbit adopted where they lay and never owns.
   */
  findPodcastMediaFiles(libraryId: number, afterEpisodeId: number, limit: number) {
    return this.db
      .select({ episodeId: podcastEpisodes.id, localPath: podcastEpisodeMedia.localPath })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(
        and(
          eq(podcasts.libraryId, libraryId),
          eq(podcastEpisodes.origin, 'feed'),
          gt(podcastEpisodes.id, afterEpisodeId),
          isNotNull(podcastEpisodeMedia.localPath),
        ),
      )
      .orderBy(asc(podcastEpisodes.id))
      .limit(limit);
  }

  findPodcastIds(libraryId: number, afterPodcastId: number, limit: number) {
    return this.db
      .select({ id: podcasts.id })
      .from(podcasts)
      .where(and(eq(podcasts.libraryId, libraryId), gt(podcasts.id, afterPodcastId)))
      .orderBy(asc(podcasts.id))
      .limit(limit);
  }

  findPodcastCleanupJobs(libraryId: number, afterJobId: number, limit: number) {
    return this.db
      .select({ id: podcastJobs.id, payload: podcastJobs.payload })
      .from(podcastJobs)
      .where(
        and(
          eq(podcastJobs.libraryId, libraryId),
          eq(podcastJobs.type, 'file_cleanup'),
          gt(podcastJobs.id, afterJobId),
          sql`${podcastJobs.status} in ('queued', 'failed', 'cancelled')`,
        ),
      )
      .orderBy(asc(podcastJobs.id))
      .limit(limit);
  }

  /** Whether anything lives in the downloads root, which is what makes repointing it unsafe. */
  async hasPodcastMediaFiles(libraryId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ episodeId: podcastEpisodes.id })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcastEpisodes.origin, 'feed'), isNotNull(podcastEpisodeMedia.localPath)))
      .limit(1);
    return row !== undefined;
  }

  async hasBlockingPodcastStorageJobs(libraryId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: podcastJobs.id })
      .from(podcastJobs)
      .where(
        and(
          eq(podcastJobs.libraryId, libraryId),
          inArray(podcastJobs.type, ['download', 'retention', 'purge', 'merge', 'file_cleanup']),
          sql`(${podcastJobs.status} = 'processing' or (${podcastJobs.type} = 'file_cleanup' and ${podcastJobs.status} in ('queued', 'failed', 'cancelled')))`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async cancelPodcastJobs(libraryId: number): Promise<number> {
    const rows = await this.db
      .update(podcastJobs)
      .set({
        cancelRequested: true,
        status: sql`case when ${podcastJobs.status} = 'queued' then 'cancelled' else ${podcastJobs.status} end`,
        updatedAt: new Date(),
      })
      .where(and(eq(podcastJobs.libraryId, libraryId), sql`${podcastJobs.status} in ('queued', 'processing')`))
      .returning({ status: podcastJobs.status, type: podcastJobs.type, episodeId: podcastJobs.episodeId });
    const cancelledEpisodeIds = rows.flatMap((row) =>
      row.status === 'cancelled' && row.type === 'download' && row.episodeId !== null ? [row.episodeId] : [],
    );
    if (cancelledEpisodeIds.length > 0) {
      await this.db
        .update(podcastEpisodeMedia)
        .set({ status: 'remote', lastError: null, updatedAt: new Date() })
        .where(and(inArray(podcastEpisodeMedia.episodeId, cancelledEpisodeIds), eq(podcastEpisodeMedia.status, 'queued')));
    }
    return rows.filter((row) => row.status === 'processing').length;
  }

  findBookIdsByLibrary(libraryId: number) {
    return this.db.select({ id: books.id }).from(books).where(eq(books.libraryId, libraryId));
  }

  delete(id: number) {
    return this.db.delete(libraries).where(eq(libraries.id, id));
  }

  deleteFolder(id: number) {
    return this.db.delete(libraryFolders).where(eq(libraryFolders.id, id));
  }

  deleteFoldersByLibrary(libraryId: number) {
    return this.db.delete(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
  }

  async updateDisplayOrders(order: { id: number; displayOrder: number }[]) {
    await this.db.transaction(async (tx) => {
      for (const item of order) {
        await tx.update(libraries).set({ displayOrder: item.displayOrder }).where(eq(libraries.id, item.id));
      }
    });
  }

  async getStats(libraryId: number) {
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)));

    const formatRows = await this.db
      .select({
        format: bookFiles.format,
        count: sql<number>`count(*)::int`,
        totalSize: sql<number>`coalesce(sum(${bookFiles.sizeBytes}), 0)::bigint`,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(eq(books.libraryId, libraryId), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)))
      .groupBy(bookFiles.format);

    const formatCounts: Record<string, number> = {};
    let totalSizeBytes = 0n;
    for (const row of formatRows) {
      if (row.format) formatCounts[row.format] = row.count;
      totalSizeBytes += toBigInt(row.totalSize);
    }

    return {
      totalBooks: countRow?.count ?? 0,
      totalSizeBytes: toSafeNumber(totalSizeBytes),
      formatCounts,
    };
  }

  /**
   * The same aggregates as getStats, for many libraries in two round trips instead of two per
   * library. Book counts come from books alone so titles with no primary file still count, while
   * sizes and formats need the bookFiles join.
   */
  async getStatsForLibraries(libraryIds: number[]) {
    if (libraryIds.length === 0) return new Map<number, LibraryStats>();

    const [countRows, formatRows] = await Promise.all([
      this.db
        .select({ libraryId: books.libraryId, count: sql<number>`count(*)::int` })
        .from(books)
        .where(and(inArray(books.libraryId, libraryIds), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)))
        .groupBy(books.libraryId),
      this.db
        .select({
          libraryId: books.libraryId,
          format: bookFiles.format,
          count: sql<number>`count(*)::int`,
          totalSize: sql<number>`coalesce(sum(${bookFiles.sizeBytes}), 0)::bigint`,
        })
        .from(books)
        .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
        .where(and(inArray(books.libraryId, libraryIds), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)))
        .groupBy(books.libraryId, bookFiles.format),
    ]);

    const sizeByLibrary = new Map<number, bigint>();
    const formatsByLibrary = new Map<number, Record<string, number>>();
    for (const row of formatRows) {
      sizeByLibrary.set(row.libraryId, (sizeByLibrary.get(row.libraryId) ?? 0n) + toBigInt(row.totalSize));
      if (!row.format) continue;
      const formats = formatsByLibrary.get(row.libraryId);
      if (formats) formats[row.format] = row.count;
      else formatsByLibrary.set(row.libraryId, { [row.format]: row.count });
    }

    const countByLibrary = new Map(countRows.map((row) => [row.libraryId, row.count]));
    const stats = new Map<number, LibraryStats>();
    for (const libraryId of libraryIds) {
      stats.set(libraryId, {
        totalBooks: countByLibrary.get(libraryId) ?? 0,
        totalSizeBytes: toSafeNumber(sizeByLibrary.get(libraryId) ?? 0n),
        formatCounts: formatsByLibrary.get(libraryId) ?? {},
      });
    }
    return stats;
  }

  /**
   * Which of these users can open this library, answered in one query rather than one per user.
   *
   * A superuser holds no row in the access table and reaches every library anyway, so the flag is
   * read alongside the grants: filtering on grants alone would report an administrator as having
   * access to nothing.
   */
  findUserIdsWithAccess(libraryId: number, userIds: number[]) {
    return this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .leftJoin(
        schema.userLibraryAccess,
        and(eq(schema.userLibraryAccess.userId, schema.users.id), eq(schema.userLibraryAccess.libraryId, libraryId)),
      )
      .where(and(inArray(schema.users.id, userIds), or(eq(schema.users.isSuperuser, true), isNotNull(schema.userLibraryAccess.userId))));
  }

  async getAddedAtRecomputeBounds(libraryId: number) {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        maxId: sql<number>`coalesce(max(${books.id}), 0)::int`,
      })
      .from(books)
      .where(eq(books.libraryId, libraryId));
    return row ?? { total: 0, maxId: 0 };
  }

  findAddedAtBookBatch(libraryId: number, afterId: number, maxId: number, limit: number) {
    return this.db
      .select({ id: books.id, addedAt: books.addedAt, previousAddedAt: sql<string>`${books.addedAt}::text` })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), gt(books.id, afterId), lte(books.id, maxId)))
      .orderBy(books.id)
      .limit(limit);
  }

  findAddedAtMtimes(libraryId: number, bookIds: number[]) {
    return this.db
      .select({ bookId: bookFiles.bookId, mtime: sql<Date>`min(${bookFiles.mtime})`.mapWith(bookFiles.mtime) })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(
        and(
          eq(books.libraryId, libraryId),
          inArray(books.id, bookIds),
          eq(bookFiles.role, 'content'),
          gt(bookFiles.mtime, new Date(MIN_VALID_FILE_TIME_MS)),
        ),
      )
      .groupBy(bookFiles.bookId);
  }

  findAddedAtFileBatch(libraryId: number, bookIds: number[], afterId: number, limit: number) {
    return this.db
      .select({
        id: bookFiles.id,
        bookId: bookFiles.bookId,
        absolutePath: bookFiles.absolutePath,
        mtime: bookFiles.mtime,
        rootPath: libraryFolders.path,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, books.libraryFolderId))
      .where(and(eq(books.libraryId, libraryId), inArray(books.id, bookIds), eq(bookFiles.role, 'content'), gt(bookFiles.id, afterId)))
      .orderBy(bookFiles.id)
      .limit(limit);
  }

  async updateAddedAtBatch(libraryId: number, values: { id: number; addedAt: Date; previousAddedAt: string }[]): Promise<number[]> {
    if (values.length === 0) return [];
    const rows = sql.join(
      values.map(({ id, addedAt, previousAddedAt }) => sql`(${id}::int, ${addedAt.toISOString()}::timestamptz, ${previousAddedAt}::timestamptz)`),
      sql`, `,
    );
    const result = await this.db
      .update(books)
      .set({ addedAt: sql`dates.added_at`, updatedAt: new Date() })
      .from(sql`(values ${rows}) as dates(id, added_at, previous_added_at)`)
      .where(and(eq(books.libraryId, libraryId), sql`${books.id} = dates.id`, sql`${books.addedAt} = dates.previous_added_at`))
      .returning({ id: books.id });
    return result.map(({ id }) => id);
  }

  async hasUserAccess(userId: number, libraryId: number): Promise<boolean> {
    const row = await this.db.query.userLibraryAccess.findFirst({
      where: and(eq(schema.userLibraryAccess.userId, userId), eq(schema.userLibraryAccess.libraryId, libraryId)),
    });
    return row !== undefined;
  }

  async findUserAccessLevel(userId: number, libraryId: number): Promise<AccessLevel | null> {
    const row = await this.db.query.userLibraryAccess.findFirst({
      columns: { accessLevel: true },
      where: and(eq(schema.userLibraryAccess.userId, userId), eq(schema.userLibraryAccess.libraryId, libraryId)),
    });
    return row?.accessLevel ?? null;
  }

  getAccess(libraryId: number) {
    return this.db.query.userLibraryAccess.findMany({
      where: eq(schema.userLibraryAccess.libraryId, libraryId),
    });
  }

  async grantAccess(libraryId: number, userId: number, accessLevel: AccessLevel) {
    await this.db
      .insert(schema.userLibraryAccess)
      .values({ libraryId, userId, accessLevel })
      .onConflictDoUpdate({
        target: [schema.userLibraryAccess.libraryId, schema.userLibraryAccess.userId],
        set: { accessLevel },
      });
  }

  async updateAccess(libraryId: number, userId: number, accessLevel: AccessLevel) {
    await this.db
      .update(schema.userLibraryAccess)
      .set({ accessLevel })
      .where(and(eq(schema.userLibraryAccess.libraryId, libraryId), eq(schema.userLibraryAccess.userId, userId)));
  }

  async revokeAccess(libraryId: number, userId: number) {
    await this.db
      .delete(schema.userLibraryAccess)
      .where(and(eq(schema.userLibraryAccess.libraryId, libraryId), eq(schema.userLibraryAccess.userId, userId)));
  }

  getUsersNotInLibrary(libraryId: number) {
    const subquery = this.db
      .select({ userId: schema.userLibraryAccess.userId })
      .from(schema.userLibraryAccess)
      .where(eq(schema.userLibraryAccess.libraryId, libraryId));

    return this.db
      .select({ id: schema.users.id, username: schema.users.username, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), sql`${schema.users.id} not in (${subquery})`));
  }

  getAccessWithUsers(libraryId: number) {
    return this.db
      .select({
        userId: schema.userLibraryAccess.userId,
        accessLevel: schema.userLibraryAccess.accessLevel,
        username: schema.users.username,
        name: schema.users.name,
      })
      .from(schema.userLibraryAccess)
      .innerJoin(schema.users, eq(schema.users.id, schema.userLibraryAccess.userId))
      .where(eq(schema.userLibraryAccess.libraryId, libraryId));
  }
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  throw new TypeError(`Unsupported bigint value: ${String(value)}`);
}

function toSafeNumber(value: bigint): number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maxSafe) {
    throw new RangeError('Library stats totalSizeBytes exceeds Number.MAX_SAFE_INTEGER');
  }
  return Number(value);
}
