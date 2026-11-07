import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sep } from 'path';

import { ACTIVE_BOOK_REQUEST_STATUSES } from '@bookorbit/types';
import type {
  BookMergeBusyReason,
  BookMergeJobStatus,
  BookMergeSourceOutcome,
  BookMergeUserDataCategory,
  ContentFilterRules,
} from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { BookMergeJobMove } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
export type MergeTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const FINISHED_STATUSES: BookMergeJobStatus[] = ['done', 'failed', 'rolled_back'];

export interface MergeBookRow {
  id: number;
  libraryId: number;
  libraryFolderId: number;
  libraryFolderPath: string;
  folderPath: string;
  status: string;
  addedAt: Date | null;
  updatedAt: Date;
  primaryFileId: number | null;
  title: string | null;
  metadataUpdatedAt: Date | null;
  organizationMode: string;
  formatPriority: string[] | null;
  allowedFormats: string[];
}

export interface MergeFileRow {
  id: number;
  bookId: number;
  absolutePath: string;
  relPath: string | null;
  role: string;
  format: string | null;
  sizeBytes: number | null;
  mtime: Date | null;
  ino: bigint;
  fileHash: string | null;
  sortOrder: number | null;
  mediaOverlayAvailable: boolean;
}

/** The library settings a merge reads: what a book leaving or entering the library is subject to. */
export interface MergeLibraryRow {
  id: number;
  name: string;
  organizationMode: string;
  formatPriority: string[] | null;
  allowedFormats: string[];
  excludePatterns: string[];
  fileWriteEnabled: boolean;
  fileNamingPattern: string | null;
  watch: boolean;
}

export interface RestrictedReader {
  userId: number;
  rules: ContentFilterRules;
}

export interface MergeRequestLink {
  id: number;
  userIds: number[];
}

export type MergeJobRow = typeof schema.bookMergeJobs.$inferSelect;

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

@Injectable()
export class BookMergeRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  transaction<T>(work: (tx: MergeTx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async findMergedIds(bookIds: number[]): Promise<Map<number, number>> {
    if (bookIds.length === 0) return new Map();
    const rows = await this.db
      .select({ sourceBookId: schema.bookMerges.sourceBookId, targetBookId: schema.bookMerges.targetBookId })
      .from(schema.bookMerges)
      .where(inArray(schema.bookMerges.sourceBookId, bookIds));
    return new Map(rows.map((row) => [row.sourceBookId, row.targetBookId]));
  }

  async loadBooks(bookIds: number[]): Promise<MergeBookRow[]> {
    if (bookIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: schema.books.id,
        libraryId: schema.books.libraryId,
        libraryFolderId: schema.books.libraryFolderId,
        libraryFolderPath: schema.libraryFolders.path,
        folderPath: schema.books.folderPath,
        status: schema.books.status,
        addedAt: schema.books.addedAt,
        updatedAt: schema.books.updatedAt,
        primaryFileId: schema.books.primaryFileId,
        title: schema.bookMetadata.title,
        metadataUpdatedAt: schema.bookMetadata.updatedAt,
        organizationMode: schema.libraries.organizationMode,
        formatPriority: schema.libraries.formatPriority,
        allowedFormats: schema.libraries.allowedFormats,
      })
      .from(schema.books)
      .innerJoin(schema.libraryFolders, eq(schema.libraryFolders.id, schema.books.libraryFolderId))
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.books.libraryId))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .where(inArray(schema.books.id, bookIds));
    return rows.map((row) => ({
      ...row,
      formatPriority: (row.formatPriority as string[] | null) ?? null,
      allowedFormats: row.allowedFormats ?? [],
    }));
  }

  async loadFiles(bookIds: number[]): Promise<MergeFileRow[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({
        id: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        absolutePath: schema.bookFiles.absolutePath,
        relPath: schema.bookFiles.relPath,
        role: schema.bookFiles.role,
        format: schema.bookFiles.format,
        sizeBytes: schema.bookFiles.sizeBytes,
        mtime: schema.bookFiles.mtime,
        ino: schema.bookFiles.ino,
        fileHash: schema.bookFiles.fileHash,
        sortOrder: schema.bookFiles.sortOrder,
        mediaOverlayAvailable: schema.bookFiles.mediaOverlayAvailable,
      })
      .from(schema.bookFiles)
      .where(inArray(schema.bookFiles.bookId, bookIds))
      .orderBy(asc(schema.bookFiles.bookId), asc(schema.bookFiles.sortOrder), asc(schema.bookFiles.id));
  }

  async loadLibraries(libraryIds: number[]): Promise<Map<number, MergeLibraryRow>> {
    if (libraryIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: schema.libraries.id,
        name: schema.libraries.name,
        organizationMode: schema.libraries.organizationMode,
        formatPriority: schema.libraries.formatPriority,
        allowedFormats: schema.libraries.allowedFormats,
        excludePatterns: schema.libraries.excludePatterns,
        fileWriteEnabled: schema.libraries.fileWriteEnabled,
        fileNamingPattern: schema.libraries.fileNamingPattern,
        watch: schema.libraries.watch,
      })
      .from(schema.libraries)
      .where(inArray(schema.libraries.id, libraryIds));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          ...row,
          formatPriority: (row.formatPriority as string[] | null) ?? null,
          allowedFormats: row.allowedFormats ?? [],
          excludePatterns: row.excludePatterns ?? [],
        },
      ]),
    );
  }

  async loadTagsAndGenres(bookIds: number[]) {
    if (bookIds.length === 0) return { tags: [], genres: [] };
    const [tags, genres] = await Promise.all([
      this.db
        .select({ bookId: schema.bookTags.bookId, id: schema.tags.id, name: schema.tags.name })
        .from(schema.bookTags)
        .innerJoin(schema.tags, eq(schema.tags.id, schema.bookTags.tagId))
        .where(inArray(schema.bookTags.bookId, bookIds)),
      this.db
        .select({ bookId: schema.bookGenres.bookId, id: schema.genres.id, name: schema.genres.name })
        .from(schema.bookGenres)
        .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
        .where(inArray(schema.bookGenres.bookId, bookIds)),
    ]);
    return { tags, genres };
  }

  async findCoverMediums(bookId: number): Promise<string[]> {
    const rows = await this.db
      .select({ medium: schema.bookCovers.medium })
      .from(schema.bookCovers)
      .where(and(eq(schema.bookCovers.bookId, bookId), sql`${schema.bookCovers.dormantSince} is null`));
    return rows.map((row) => row.medium);
  }

  /** Books with background work in flight that a merge would race (01-architecture.md 3.1 `BOOK_BUSY`), with what holds each. */
  async findBusyBooks(bookIds: number[]): Promise<Map<number, BookMergeBusyReason>> {
    if (bookIds.length === 0) return new Map();
    const rows = rowsOf<{ book_id: number; reason: BookMergeBusyReason }>(
      await this.db.execute(sql`
        select book_id, 'metadata_fetch' as reason from book_metadata_fetch_queue where book_id in ${bookIds} and status = 'processing'
        union select book_id, 'chapter_lookup' from chapter_lookup_queue where book_id in ${bookIds} and status = 'processing'
        union select book_id, 'chapter_job' from book_chapter_jobs where book_id in ${bookIds} and status in ('queued', 'processing')
        union select book_id, 'read_aloud' from read_aloud_jobs where book_id in ${bookIds} and status in ('queued', 'processing', 'awaiting_review')
        union select target_book_id, 'upload' from upload_sessions where target_book_id in ${bookIds} and status in ('receiving', 'processing')
      `),
    );
    const busy = new Map<number, BookMergeBusyReason>();
    for (const row of rows) if (!busy.has(Number(row.book_id))) busy.set(Number(row.book_id), row.reason);
    return busy;
  }

  /** Per book: the viewer's highlights and shelves, whether the viewer has progress, and how many readers do. */
  async countActivity(
    bookIds: number[],
    viewerId: number,
  ): Promise<Map<number, { highlights: number; shelves: number; hasProgress: boolean; readers: number }>> {
    const activity = new Map<number, { highlights: number; shelves: number; hasProgress: boolean; readers: number }>();
    if (bookIds.length === 0) return activity;
    const rows = rowsOf<{ book_id: number; highlights: number; shelves: number; readers: number; has_progress: boolean }>(
      await this.db.execute(sql`
        with readers as (
          select book_id, user_id from user_book_status where book_id in ${bookIds}
          union select f.book_id, p.user_id from reading_progress p join book_files f on f.id = p.book_file_id where f.book_id in ${bookIds}
          union select book_id, user_id from reading_attempts where book_id in ${bookIds} and deleted_at is null
        )
        select b.id as book_id,
          (select count(*) from annotations a where a.book_id = b.id and a.user_id = ${viewerId} and a.deleted_at is null)::int as highlights,
          (select count(*) from collection_books cb join collections c on c.id = cb.collection_id where cb.book_id = b.id and c.user_id = ${viewerId})::int as shelves,
          (select count(*) from readers r where r.book_id = b.id)::int as readers,
          exists(select 1 from readers r where r.book_id = b.id and r.user_id = ${viewerId}) as has_progress
        from books b where b.id in ${bookIds}
      `),
    );
    for (const row of rows) {
      activity.set(Number(row.book_id), {
        highlights: Number(row.highlights),
        shelves: Number(row.shelves),
        hasProgress: row.has_progress === true,
        readers: Number(row.readers),
      });
    }
    return activity;
  }

  /** True when a book in the library has this folder, or a file row lives under it, matched without case. */
  async isFolderInUse(libraryId: number, folderPath: string): Promise<boolean> {
    const lowered = folderPath.toLowerCase();
    const prefix = `${lowered.replace(/[\\%_]/g, (char) => `\\${char}`)}${sep}%`;
    const rows = rowsOf<{ found: number }>(
      await this.db.execute(sql`
        select 1 as found from books b
        where b.library_id = ${libraryId} and lower(b.folder_path) = ${lowered}
        union all
        select 1 from book_files f join books b on b.id = f.book_id
        where b.library_id = ${libraryId} and lower(f.absolute_path) like ${prefix}
        limit 1
      `),
    );
    return rows.length > 0;
  }

  /** Which of these paths a file row already owns, matched without case (the unique index is global). */
  async findPathOwners(libraryId: number, absolutePaths: string[]): Promise<Map<string, number>> {
    const owners = new Map<string, number>();
    if (absolutePaths.length === 0) return owners;
    const lowered = [...new Set(absolutePaths.map((path) => path.toLowerCase()))];
    const exact = await this.db
      .select({ absolutePath: schema.bookFiles.absolutePath, bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .where(inArray(schema.bookFiles.absolutePath, [...new Set(absolutePaths)]));
    for (const row of exact) owners.set(row.absolutePath.toLowerCase(), row.bookId);
    const folded = rowsOf<{ absolute_path: string; book_id: number }>(
      await this.db.execute(sql`
        select f.absolute_path, f.book_id from book_files f
        join books b on b.id = f.book_id
        where b.library_id = ${libraryId} and lower(f.absolute_path) in ${lowered}
      `),
    );
    for (const row of folded) owners.set(row.absolute_path.toLowerCase(), Number(row.book_id));
    return owners;
  }

  // ── Preview counts ──────────────────────────────────────────────────────────────────────────

  /** Rows and distinct readers per category on the merged-away books, split by the viewer and everyone else. */
  async countUserData(sourceBookIds: number[], viewerId: number) {
    const ids = sourceBookIds;
    const rows = rowsOf<{ category: BookMergeUserDataCategory; mine: boolean; rows: string; users: string }>(
      await this.db.execute(sql`
        with data(category, user_id) as (
          select 'readingProgress', p.user_id from reading_progress p join book_files f on f.id = p.book_file_id where f.book_id in ${ids}
          union all select 'readingHistory', user_id from reading_attempts where book_id in ${ids} and deleted_at is null
          union all select 'readingSessions', user_id from reading_sessions where book_id in ${ids}
          union all select 'annotations', user_id from annotations where book_id in ${ids} and deleted_at is null
          union all select 'bookmarks', user_id from bookmarks where book_id in ${ids} and deleted_at is null
          union all select 'journal', user_id from book_journal_entries where book_id in ${ids} and deleted_at is null
          union all select 'notes', user_id from user_book_notes where book_id in ${ids} and coalesce(trim(note), '') <> ''
          union all select 'ratings', user_id from user_book_ratings where book_id in ${ids} and rating is not null
          union all select 'collections', c.user_id from collection_books cb join collections c on c.id = cb.collection_id where cb.book_id in ${ids}
          union all select 'kobo', user_id from kobo_book_entitlements where book_id in ${ids}
          union all select 'hardcover', user_id from hardcover_book_state where book_id in ${ids}
          union all select 'storygraph', user_id from storygraph_book_state where book_id in ${ids}
        )
        select category, mine, count(*)::text as rows, count(distinct user_id)::text as users
        from (select category, user_id, user_id = ${viewerId} as mine from data) tagged
        group by category, mine
      `),
    );
    return rows.map((row) => ({ category: row.category, mine: row.mine, rows: Number(row.rows), users: Number(row.users) }));
  }

  /** Non-superusers with access to the library and a content filter: the readers a merge can show or hide K from. */
  async findRestrictedReaders(libraryId: number): Promise<RestrictedReader[]> {
    const rows = rowsOf<{ user_id: number; kind: 'tag' | 'genre'; filter_type: 'include' | 'exclude'; item_id: number }>(
      await this.db.execute(sql`
        with readers as (
          select a.user_id from user_library_access a join users u on u.id = a.user_id
          where a.library_id = ${libraryId} and not u.is_superuser
        )
        select t.user_id, 'tag' as kind, t.filter_type::text as filter_type, t.tag_id as item_id
        from user_content_filter_tags t join readers r on r.user_id = t.user_id
        union all
        select g.user_id, 'genre', g.filter_type::text, g.genre_id
        from user_content_filter_genres g join readers r on r.user_id = g.user_id
      `),
    );
    const byUser = new Map<number, ContentFilterRules>();
    for (const row of rows) {
      const userId = Number(row.user_id);
      const rules = byUser.get(userId) ?? { includeTagIds: [], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };
      const key = `${row.filter_type}${row.kind === 'tag' ? 'TagIds' : 'GenreIds'}` as keyof Omit<ContentFilterRules, 'exemptRequestsFromUserId'>;
      rules[key].push(Number(row.item_id));
      byUser.set(userId, rules);
    }
    return [...byUser].map(([userId, rules]) => ({ userId, rules }));
  }

  /** Readers (any user) who have data on the merged-away books, bounded to the given candidates. */
  async findReadersWithData(sourceBookIds: number[], userIds: number[]): Promise<Set<number>> {
    if (sourceBookIds.length === 0 || userIds.length === 0) return new Set();
    const rows = rowsOf<{ user_id: number }>(
      await this.db.execute(sql`
        select distinct user_id from (
          select user_id from reading_attempts where book_id in ${sourceBookIds} and deleted_at is null
          union all select user_id from annotations where book_id in ${sourceBookIds} and deleted_at is null
          union all select user_id from user_book_status where book_id in ${sourceBookIds}
          union all select p.user_id from reading_progress p join book_files f on f.id = p.book_file_id where f.book_id in ${sourceBookIds}
        ) data where user_id in ${userIds}
      `),
    );
    return new Set(rows.map((row) => Number(row.user_id)));
  }

  /**
   * Non-superusers with reading data, shelves, Kobo copies or notes on these books who can open each
   * book's current library but not the destination library: who loses sight of the book and their
   * data on it once the books merge into that library.
   */
  async findReadersLosingAccess(bookIds: number[], destinationLibraryId: number): Promise<Set<number>> {
    if (bookIds.length === 0) return new Set();
    const rows = rowsOf<{ user_id: number }>(
      await this.db.execute(sql`
        with data(book_id, user_id) as (
          select book_id, user_id from reading_attempts where book_id in ${bookIds} and deleted_at is null
          union select f.book_id, p.user_id from reading_progress p join book_files f on f.id = p.book_file_id where f.book_id in ${bookIds}
          union select book_id, user_id from reading_sessions where book_id in ${bookIds}
          union select book_id, user_id from user_book_status where book_id in ${bookIds}
          union select book_id, user_id from annotations where book_id in ${bookIds} and deleted_at is null
          union select book_id, user_id from bookmarks where book_id in ${bookIds} and deleted_at is null
          union select book_id, user_id from book_journal_entries where book_id in ${bookIds} and deleted_at is null
          union select book_id, user_id from user_book_notes where book_id in ${bookIds} and coalesce(trim(note), '') <> ''
          union select book_id, user_id from user_book_ratings where book_id in ${bookIds} and rating is not null
          union select cb.book_id, c.user_id from collection_books cb join collections c on c.id = cb.collection_id where cb.book_id in ${bookIds}
          union select book_id, user_id from kobo_book_entitlements where book_id in ${bookIds}
        )
        select distinct d.user_id from data d
        join books b on b.id = d.book_id
        join users u on u.id = d.user_id and not u.is_superuser
        where b.library_id <> ${destinationLibraryId}
          and exists (select 1 from user_library_access a where a.user_id = d.user_id and a.library_id = b.library_id)
          and not exists (select 1 from user_library_access a where a.user_id = d.user_id and a.library_id = ${destinationLibraryId})
      `),
    );
    return new Set(rows.map((row) => Number(row.user_id)));
  }

  /** Which of these users are non-superusers without access to the library. */
  async findUsersWithoutLibraryAccess(userIds: number[], libraryId: number): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();
    const rows = rowsOf<{ id: number }>(
      await this.db.execute(sql`
        select u.id from users u
        where u.id in ${userIds} and not u.is_superuser
          and not exists (select 1 from user_library_access a where a.user_id = u.id and a.library_id = ${libraryId})
      `),
    );
    return new Set(rows.map((row) => Number(row.id)));
  }

  /** Users whose Kobo holds one of these books and who cannot open the destination library: their device drops it. */
  async countKoboUsersLosingAccess(bookIds: number[], destinationLibraryId: number): Promise<number> {
    if (bookIds.length === 0) return 0;
    const [row] = rowsOf<{ count: string }>(
      await this.db.execute(sql`
        select count(distinct e.user_id)::text as count
        from kobo_book_entitlements e
        join users u on u.id = e.user_id and not u.is_superuser
        where e.book_id in ${bookIds}
          and not exists (select 1 from user_library_access a where a.user_id = e.user_id and a.library_id = ${destinationLibraryId})
      `),
    );
    return Number(row?.count ?? 0);
  }

  /** Custom fields with a value on these books, shown in the book's library today, that the destination library does not use. */
  async countHiddenCustomFields(bookIds: number[], destinationLibraryId: number): Promise<number> {
    if (bookIds.length === 0) return 0;
    const [row] = rowsOf<{ count: string }>(
      await this.db.execute(sql`
        select count(distinct v.field_id)::text as count
        from book_custom_metadata_values v
        join books b on b.id = v.book_id
        join custom_metadata_library_fields shown on shown.field_id = v.field_id and shown.library_id = b.library_id
        where v.book_id in ${bookIds}
          and b.library_id <> ${destinationLibraryId}
          and not exists (
            select 1 from custom_metadata_library_fields f where f.field_id = v.field_id and f.library_id = ${destinationLibraryId}
          )
      `),
    );
    return Number(row?.count ?? 0);
  }

  /**
   * Open requests for the other format of a book these requests already delivered, which would join
   * that book today because it is in their library, per library. The join only happens in the
   * request's own library, so once the book leaves it they arrive as books of their own.
   */
  async countCompanionRequestsLeftBehind(bookIds: number[], destinationLibraryId: number): Promise<Array<{ libraryId: number; count: number }>> {
    if (bookIds.length === 0) return [];
    const rows = rowsOf<{ library_id: number; count: string }>(
      await this.db.execute(sql`
        select pending.target_library_id as library_id, count(*)::text as count
        from book_requests pending
        join book_requests landed on landed.id = pending.companion_request_id and landed.companion_request_id = pending.id
        join books b on b.id = landed.matched_book_id
        where landed.status = 'available'
          and landed.matched_book_id in ${bookIds}
          and pending.target_book_id is null
          and pending.status in ${[...ACTIVE_BOOK_REQUEST_STATUSES]}
          and pending.target_library_id = b.library_id
          and pending.target_library_id <> ${destinationLibraryId}
        group by pending.target_library_id
        order by pending.target_library_id
      `),
    );
    return rows.map((row) => ({ libraryId: Number(row.library_id), count: Number(row.count) }));
  }

  /** Users with reading sessions on these books: their daily reading stats are counted per library. */
  async findSessionReaders(bookIds: number[]): Promise<number[]> {
    if (bookIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ userId: schema.readingSessions.userId })
      .from(schema.readingSessions)
      .where(inArray(schema.readingSessions.bookId, bookIds));
    return rows.map((row) => row.userId).sort((a, b) => a - b);
  }

  async findRequestsOnBooks(bookIds: number[]): Promise<MergeRequestLink[]> {
    if (bookIds.length === 0) return [];
    const rows = rowsOf<{ id: number; user_ids: number[] }>(
      await this.db.execute(sql`
        select r.id, array_remove(array_agg(distinct s.user_id) || array[r.user_id], null) as user_ids
        from book_requests r
        left join book_request_subscribers s on s.request_id = r.id
        where r.matched_book_id in ${bookIds} or r.target_book_id in ${bookIds}
        group by r.id
      `),
    );
    return rows.map((row) => ({ id: Number(row.id), userIds: [...new Set(row.user_ids.map(Number))] }));
  }

  async countKoboEntitlements(bookIds: number[]): Promise<number> {
    if (bookIds.length === 0) return 0;
    const [row] = rowsOf<{ count: string }>(
      await this.db.execute(sql`select count(*)::text as count from kobo_book_entitlements where book_id in ${bookIds}`),
    );
    return Number(row?.count ?? 0);
  }

  /** Users whose Hardcover or StoryGraph link puts the kept book and a source on different remote books. */
  async countRemoteBookConflicts(targetBookId: number, sourceBookIds: number[]): Promise<number> {
    if (sourceBookIds.length === 0) return 0;
    const [row] = rowsOf<{ count: string }>(
      await this.db.execute(sql`
        select count(distinct user_id)::text as count from (
          select s.user_id from hardcover_book_state s
          join hardcover_book_state t on t.book_id = ${targetBookId} and t.user_id = s.user_id
          where s.book_id in ${sourceBookIds} and s.hardcover_book_id is not null and t.hardcover_book_id is not null
            and s.hardcover_book_id <> t.hardcover_book_id
          union all
          select s.user_id from storygraph_book_state s
          join storygraph_book_state t on t.book_id = ${targetBookId} and t.user_id = s.user_id
          where s.book_id in ${sourceBookIds} and s.storygraph_book_id is not null and t.storygraph_book_id is not null
            and s.storygraph_book_id <> t.storygraph_book_id
        ) conflicts
      `),
    );
    return Number(row?.count ?? 0);
  }

  // ── Jobs ────────────────────────────────────────────────────────────────────────────────────

  async createJob(values: typeof schema.bookMergeJobs.$inferInsert): Promise<MergeJobRow> {
    const [row] = await this.db.insert(schema.bookMergeJobs).values(values).returning();
    return row;
  }

  async findJob(jobId: number): Promise<MergeJobRow | null> {
    const [row] = await this.db.select().from(schema.bookMergeJobs).where(eq(schema.bookMergeJobs.id, jobId)).limit(1);
    return row ?? null;
  }

  async findUnfinishedJobs(): Promise<MergeJobRow[]> {
    return this.db
      .select()
      .from(schema.bookMergeJobs)
      .where(notInArray(schema.bookMergeJobs.status, FINISHED_STATUSES))
      .orderBy(asc(schema.bookMergeJobs.id));
  }

  async findInFlightJob(userId: number, targetBookId: number, sourceBookIds: number[]): Promise<MergeJobRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.bookMergeJobs)
      .where(
        and(
          eq(schema.bookMergeJobs.requestedByUserId, userId),
          eq(schema.bookMergeJobs.targetBookId, targetBookId),
          sql`${schema.bookMergeJobs.sourceBookIds} = array[${sql.join(
            sourceBookIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::int[]`,
          notInArray(schema.bookMergeJobs.status, FINISHED_STATUSES),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async updateJob(
    jobId: number,
    values: Partial<
      Pick<
        MergeJobRow,
        'status' | 'moves' | 'outcomes' | 'result' | 'currentSourceBookId' | 'processed' | 'errorCode' | 'error' | 'finishedAt' | 'plan'
      >
    >,
    tx?: MergeTx,
  ): Promise<void> {
    await (tx ?? this.db).update(schema.bookMergeJobs).set(values).where(eq(schema.bookMergeJobs.id, jobId));
  }

  async setMoves(jobId: number, moves: BookMergeJobMove[]): Promise<void> {
    await this.db.update(schema.bookMergeJobs).set({ moves }).where(eq(schema.bookMergeJobs.id, jobId));
  }

  async setOutcomes(jobId: number, outcomes: BookMergeSourceOutcome[], tx?: MergeTx): Promise<void> {
    await (tx ?? this.db).update(schema.bookMergeJobs).set({ outcomes }).where(eq(schema.bookMergeJobs.id, jobId));
  }

  async findStatuses(userIds: number[], bookId: number): Promise<Map<number, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ userId: schema.userBookStatus.userId, status: schema.userBookStatus.status })
      .from(schema.userBookStatus)
      .where(and(eq(schema.userBookStatus.bookId, bookId), inArray(schema.userBookStatus.userId, userIds)));
    return new Map(rows.map((row) => [row.userId, row.status]));
  }

  async findRatings(userIds: number[], bookId: number): Promise<Map<number, number | null>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ userId: schema.userBookRatings.userId, rating: schema.userBookRatings.rating })
      .from(schema.userBookRatings)
      .where(and(eq(schema.userBookRatings.bookId, bookId), inArray(schema.userBookRatings.userId, userIds)));
    return new Map(rows.map((row) => [row.userId, row.rating]));
  }

  async findFilePath(fileId: number, bookId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ absolutePath: schema.bookFiles.absolutePath })
      .from(schema.bookFiles)
      .where(and(eq(schema.bookFiles.id, fileId), eq(schema.bookFiles.bookId, bookId)))
      .limit(1);
    return row?.absolutePath ?? null;
  }

  async findLibraryFolderPath(libraryFolderId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ path: schema.libraryFolders.path })
      .from(schema.libraryFolders)
      .where(eq(schema.libraryFolders.id, libraryFolderId))
      .limit(1);
    return row?.path ?? null;
  }
}
