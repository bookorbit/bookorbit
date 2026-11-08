import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql, sum, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';

import { DB } from '../../db';
import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookDockFiles,
  bookDockUnitFiles,
  bookFiles,
  bookMetadata,
  books,
  libraries,
  libraryFolders,
  type BookDockFileRow,
  type BookDockUnitFileRow,
  type NewBookDockFileRow,
  type NewBookDockUnitFileRow,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SORT_COLUMNS = {
  createdAt: bookDockFiles.createdAt,
  fileName: bookDockFiles.fileName,
  format: bookDockFiles.format,
  status: bookDockFiles.status,
  fileSize: bookDockFiles.fileSize,
} as const;

/**
 * Sidecars carry no sort order, so they sort after the content files rather than before them.
 *
 * The direction sits inside the fragment on purpose: wrapping it as `asc(sql\`... nulls last\`)`
 * renders `sort_order nulls last asc`, which Postgres rejects outright. Exported so the SQL it
 * produces can be read in a test rather than assumed.
 */
export const UNIT_FILE_ORDER = [sql`${bookDockUnitFiles.sortOrder} asc nulls last`, asc(bookDockUnitFiles.id)] as const;

/** Below this, a provider match is treated as a guess the user should confirm. */
export const NEEDS_REVIEW_CONFIDENCE_BELOW = 70;

/**
 * A file is ready to file but still wants a human: either nothing decided where it
 * goes, or the provider match is too weak to trust. Both are plain indexed columns,
 * so this stays a WHERE clause rather than post-filtering a page in memory.
 */
/** Exactly what finalize accepts: ready, with both halves of a destination resolved. */
function readyToFileCondition(): SQL {
  return and(eq(bookDockFiles.status, 'ready'), isNotNull(bookDockFiles.targetLibraryId), isNotNull(bookDockFiles.targetFolderId)) as SQL;
}

function needsReviewCondition(): SQL {
  return and(
    eq(bookDockFiles.status, 'ready'),
    or(isNull(bookDockFiles.targetLibraryId), isNull(bookDockFiles.targetFolderId), lt(bookDockFiles.confidence, NEEDS_REVIEW_CONFIDENCE_BELOW)),
  ) as SQL;
}

export interface ListOptions {
  status?: string;
  needsReview?: boolean;
  readyToFile?: boolean;
  page: number;
  limit: number;
  sort: string;
  order: string;
  search?: string;
  userId: number;
  canManageAll: boolean;
}

export interface SelectionBatchOptions {
  limit: number;
  afterId?: number;
  excludedIds?: number[];
  status?: string;
  needsReview?: boolean;
  readyToFile?: boolean;
  search?: string;
  userId: number;
  canManageAll: boolean;
}

/** An existing book a docked file was asked to join, and where it lives. */
export interface BookDockJoinTargetRow {
  bookId: number;
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
  /** The book is its own file: `folderPath` is the path of one of its files, not a folder. */
  storedAsFile: boolean;
  status: string;
  title: string | null;
}

/** A book a docked file might be another format of. `titleKey` is `lower(title)`, as the index has it. */
export interface BookDockJoinCandidateRow {
  bookId: number;
  libraryId: number;
  folderPath: string;
  /** The library folder the book is kept under. */
  libraryFolderPath: string;
  /** The book is its own file: `folderPath` is the path of one of its files, not a folder. */
  storedAsFile: boolean;
  title: string | null;
  titleKey: string | null;
  isbn10: string | null;
  isbn13: string | null;
  hardcoverId: string | null;
  openLibraryId: string | null;
}

/**
 * Whether the book is its own file, as a loose book at a library folder's root is: the scanner keys
 * it by the file's path, so `folderPath` names that file rather than a folder. One lookup on the
 * unique `book_files.absolute_path` index.
 */
function storedAsFile(): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${bookFiles} bf where bf.book_id = ${books.id} and bf.absolute_path = ${books.folderPath})`;
}

/** However many files a batch carries, one probe never reads more than this many books. */
export const JOIN_CANDIDATE_LIMIT = 500;

@Injectable()
export class BookDockRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Whether a book library with this id exists. An app setting can outlive the library it names. */
  async bookLibraryExists(libraryId: number): Promise<boolean> {
    const [row] = await this.db.select({ id: libraries.id }).from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    return row !== undefined;
  }

  async findAll(opts: ListOptions): Promise<{ items: BookDockFileRow[]; total: number }> {
    const conditions = this.buildSelectionConditions(opts.status, opts.search, opts.userId, opts.canManageAll, opts.needsReview, opts.readyToFile);

    const where = conditions.length ? and(...conditions) : undefined;

    const orderFn = opts.order === 'asc' ? asc : desc;
    const orderBy =
      opts.sort === 'attention'
        ? [this.attentionRank(), desc(bookDockFiles.createdAt), desc(bookDockFiles.id)]
        : [orderFn(SORT_COLUMNS[opts.sort as keyof typeof SORT_COLUMNS] ?? bookDockFiles.createdAt), orderFn(bookDockFiles.id)];

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(bookDockFiles)
        .where(where)
        .orderBy(...orderBy)
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit),
      this.db.select({ total: count() }).from(bookDockFiles).where(where),
    ]);

    return { items, total };
  }

  /**
   * Decisions first, then failures, then settled files, then work still in flight -
   * which the client also surfaces as a progress readout, so it never needs the top
   * of the list.
   */
  private attentionRank(): SQL {
    return sql`case
      when ${needsReviewCondition()} then 0
      when ${bookDockFiles.status} = 'error' then 1
      when ${bookDockFiles.status} = 'ready' then 2
      when ${bookDockFiles.status} = 'pending' then 3
      else 4 end`;
  }

  async findById(id: number): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.select().from(bookDockFiles).where(eq(bookDockFiles.id, id)).limit(1);
    return row;
  }

  async findByAbsolutePath(path: string): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.select().from(bookDockFiles).where(eq(bookDockFiles.absolutePath, path)).limit(1);
    return row;
  }

  async create(data: NewBookDockFileRow): Promise<BookDockFileRow> {
    const [row] = await this.db.insert(bookDockFiles).values(data).returning();
    return row;
  }

  /**
   * The anchor row and its children in one transaction. A unit that exists in the list without
   * knowing which files it is made of would be finalized as a single file, which is the exact
   * truncation this whole feature exists to stop.
   */
  async createUnit(data: NewBookDockFileRow, files: Array<Omit<NewBookDockUnitFileRow, 'dockFileId'>>): Promise<BookDockFileRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(bookDockFiles).values(data).returning();
      if (files.length > 0) {
        await tx.insert(bookDockUnitFiles).values(files.map((file) => ({ ...file, dockFileId: row.id })));
      }
      return row;
    });
  }

  async findUnitFiles(dockFileId: number): Promise<BookDockUnitFileRow[]> {
    return this.db
      .select()
      .from(bookDockUnitFiles)
      .where(eq(bookDockUnitFiles.dockFileId, dockFileId))
      .orderBy(...UNIT_FILE_ORDER);
  }

  /** One query for a page of rows, so rendering a list of units is not an N+1. */
  async findUnitFilesByDockFileIds(dockFileIds: number[]): Promise<Map<number, BookDockUnitFileRow[]>> {
    const byDockFile = new Map<number, BookDockUnitFileRow[]>();
    if (dockFileIds.length === 0) return byDockFile;

    const rows = await this.db
      .select()
      .from(bookDockUnitFiles)
      .where(inArray(bookDockUnitFiles.dockFileId, dockFileIds))
      .orderBy(...UNIT_FILE_ORDER);

    for (const row of rows) {
      const existing = byDockFile.get(row.dockFileId);
      if (existing) existing.push(row);
      else byDockFile.set(row.dockFileId, [row]);
    }
    return byDockFile;
  }

  async findByUnitDirectory(unitDirectory: string): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.select().from(bookDockFiles).where(eq(bookDockFiles.unitDirectory, unitDirectory)).limit(1);
    return row;
  }

  /** Indexed, bounded lookups include secondary tracks as well as primary files. */
  async findClaimedPaths(paths: string[]): Promise<Set<string>> {
    const claimed = new Set<string>();
    for (let offset = 0; offset < paths.length; offset += 500) {
      const batch = paths.slice(offset, offset + 500);
      const [anchors, members] = await Promise.all([
        this.db.select({ absolutePath: bookDockFiles.absolutePath }).from(bookDockFiles).where(inArray(bookDockFiles.absolutePath, batch)),
        this.db
          .select({ absolutePath: bookDockUnitFiles.absolutePath })
          .from(bookDockUnitFiles)
          .where(inArray(bookDockUnitFiles.absolutePath, batch)),
      ]);
      for (const row of [...anchors, ...members]) claimed.add(row.absolutePath);
    }
    return claimed;
  }

  async update(id: number, data: Partial<NewBookDockFileRow>): Promise<BookDockFileRow | undefined> {
    const [row] = await this.db.update(bookDockFiles).set(data).where(eq(bookDockFiles.id, id)).returning();
    return row;
  }

  async deleteById(id: number): Promise<void> {
    await this.db.delete(bookDockFiles).where(eq(bookDockFiles.id, id));
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(bookDockFiles).where(inArray(bookDockFiles.id, ids));
  }

  async deleteByAbsolutePath(path: string): Promise<void> {
    await this.db.delete(bookDockFiles).where(eq(bookDockFiles.absolutePath, path));
  }

  async findAllIds(
    excludedIds?: number[],
    status?: string,
    search?: string,
    userId?: number,
    canManageAll?: boolean,
    needsReview?: boolean,
    readyToFile?: boolean,
  ): Promise<number[]> {
    const conditions = this.buildSelectionConditions(status, search, userId, canManageAll ?? true, needsReview, readyToFile);
    if (excludedIds?.length) conditions.push(notInArray(bookDockFiles.id, excludedIds));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await this.db.select({ id: bookDockFiles.id }).from(bookDockFiles).where(where);
    return rows.map((r) => r.id);
  }

  async findByIds(ids: number[], userId?: number, canManageAll?: boolean): Promise<BookDockFileRow[]> {
    if (ids.length === 0) return [];
    const conditions: SQL[] = [inArray(bookDockFiles.id, ids)];
    if (userId !== undefined && !canManageAll) {
      conditions.push(eq(bookDockFiles.uploadedBy, userId));
    }
    return this.db
      .select()
      .from(bookDockFiles)
      .where(and(...conditions));
  }

  async findExistingBooksByAbsolutePaths(absolutePaths: string[]): Promise<Array<{ absolutePath: string; bookId: number; libraryId: number }>> {
    const paths = [...new Set(absolutePaths)];
    if (paths.length === 0) return [];

    return this.db
      .select({
        absolutePath: bookFiles.absolutePath,
        bookId: bookFiles.bookId,
        libraryId: books.libraryId,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(inArray(bookFiles.absolutePath, paths));
  }

  async findJoinTarget(bookId: number): Promise<BookDockJoinTargetRow | undefined> {
    const [row] = await this.db
      .select({
        bookId: books.id,
        libraryId: books.libraryId,
        libraryFolderId: books.libraryFolderId,
        folderPath: books.folderPath,
        storedAsFile: storedAsFile(),
        status: books.status,
        title: bookMetadata.title,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(eq(books.id, bookId))
      .limit(1);
    return row;
  }

  /** Present books in these libraries carrying any of these ISBNs. Served by the ISBN indexes. */
  async findJoinCandidatesByIsbn(
    libraryIds: number[],
    isbn13s: string[],
    isbn10s: string[],
    contentFilters?: ContentFilterRules,
  ): Promise<BookDockJoinCandidateRow[]> {
    const branches = [
      isbn13s.length ? inArray(bookMetadata.isbn13, isbn13s) : undefined,
      isbn10s.length ? inArray(bookMetadata.isbn10, isbn10s) : undefined,
    ];
    if (!branches.some(Boolean)) return [];
    return this.findJoinCandidates(libraryIds, or(...branches)!, contentFilters);
  }

  /**
   * Present books in these libraries carrying any of these work-level provider ids. Served by the
   * partial `bm_hardcover_id_idx` and `bm_open_library_id_idx`, so each branch keeps their predicate.
   */
  async findJoinCandidatesByWorkId(
    libraryIds: number[],
    hardcoverIds: string[],
    openLibraryIds: string[],
    contentFilters?: ContentFilterRules,
  ): Promise<BookDockJoinCandidateRow[]> {
    const branches = [
      hardcoverIds.length ? and(isNotNull(bookMetadata.hardcoverId), inArray(bookMetadata.hardcoverId, hardcoverIds)) : undefined,
      openLibraryIds.length ? and(isNotNull(bookMetadata.openLibraryId), inArray(bookMetadata.openLibraryId, openLibraryIds)) : undefined,
    ];
    if (!branches.some(Boolean)) return [];
    return this.findJoinCandidates(libraryIds, or(...branches)!, contentFilters);
  }

  /** Present books in these libraries whose `lower(title)` is one of these keys. Served by `bm_title_lower_idx`. */
  async findJoinCandidatesByTitle(
    libraryIds: number[],
    titleKeys: string[],
    contentFilters?: ContentFilterRules,
  ): Promise<BookDockJoinCandidateRow[]> {
    if (titleKeys.length === 0) return [];
    return this.findJoinCandidates(libraryIds, inArray(sql`lower(${bookMetadata.title})`, titleKeys), contentFilters);
  }

  /** Author names per book, in display order. */
  async findAuthorNamesByBookIds(bookIds: number[]): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    if (bookIds.length === 0) return result;
    const rows = await this.db
      .select({ bookId: bookAuthors.bookId, name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(inArray(bookAuthors.bookId, bookIds))
      .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder));
    for (const row of rows) result.set(row.bookId, [...(result.get(row.bookId) ?? []), row.name]);
    return result;
  }

  /** The distinct content formats each book holds, lowercased. */
  async findContentFormatsByBookIds(bookIds: number[]): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    if (bookIds.length === 0) return result;
    const rows = await this.db
      .selectDistinct({ bookId: bookFiles.bookId, format: bookFiles.format })
      .from(bookFiles)
      .where(and(inArray(bookFiles.bookId, bookIds), eq(bookFiles.role, 'content'), isNotNull(bookFiles.format)));
    for (const row of rows) {
      const format = row.format!.toLowerCase();
      const formats = result.get(row.bookId) ?? [];
      if (!formats.includes(format)) formats.push(format);
      result.set(row.bookId, formats);
    }
    return result;
  }

  private async findJoinCandidates(libraryIds: number[], match: SQL, contentFilters?: ContentFilterRules): Promise<BookDockJoinCandidateRow[]> {
    if (libraryIds.length === 0) return [];
    const visible = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    return this.db
      .select({
        bookId: books.id,
        libraryId: books.libraryId,
        folderPath: books.folderPath,
        libraryFolderPath: libraryFolders.path,
        storedAsFile: storedAsFile(),
        title: bookMetadata.title,
        titleKey: sql<string | null>`lower(${bookMetadata.title})`,
        isbn10: bookMetadata.isbn10,
        isbn13: bookMetadata.isbn13,
        hardcoverId: bookMetadata.hardcoverId,
        openLibraryId: bookMetadata.openLibraryId,
      })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, books.libraryFolderId))
      .where(and(match, inArray(books.libraryId, libraryIds), eq(books.status, 'present'), ...visible))
      .orderBy(asc(books.id))
      .limit(JOIN_CANDIDATE_LIMIT);
  }

  async findSelectionBatch(options: SelectionBatchOptions): Promise<BookDockFileRow[]> {
    const conditions = this.buildSelectionConditions(
      options.status,
      options.search,
      options.userId,
      options.canManageAll,
      options.needsReview,
      options.readyToFile,
    );
    if (options.excludedIds?.length) conditions.push(notInArray(bookDockFiles.id, options.excludedIds));
    if (options.afterId !== undefined) conditions.push(gt(bookDockFiles.id, options.afterId));
    const where = conditions.length ? and(...conditions) : undefined;
    return this.db.select().from(bookDockFiles).where(where).orderBy(asc(bookDockFiles.id)).limit(options.limit);
  }

  async setTargetsByIds(ids: number[], targetLibraryId: number | null, targetFolderId: number | null): Promise<number> {
    if (ids.length === 0) return 0;
    const updated = await this.db
      .update(bookDockFiles)
      .set({ targetLibraryId, targetFolderId })
      .where(inArray(bookDockFiles.id, ids))
      .returning({ id: bookDockFiles.id });
    return updated.length;
  }

  async countsByStatus(
    userId?: number,
    canManageAll?: boolean,
  ): Promise<{ pending: number; working: number; ready: number; error: number; needsReview: number; readyToFile: number; total: number }> {
    const visibilityCondition = userId !== undefined ? this.buildVisibilityCondition(userId, canManageAll ?? true) : undefined;

    // A filtered aggregate keeps this to one round trip: only the 'ready' group can
    // contribute, since needing review presupposes the file is otherwise done.
    const rows = await this.db
      .select({
        status: bookDockFiles.status,
        cnt: count(),
        needsReview: sql<number>`count(*) filter (where ${needsReviewCondition()})`,
        readyToFile: sql<number>`count(*) filter (where ${readyToFileCondition()})`,
      })
      .from(bookDockFiles)
      .where(visibilityCondition)
      .groupBy(bookDockFiles.status);

    // `pending` keeps its existing meaning of everything not yet settled, so clients
    // that already read it are unaffected; `working` is the in-flight subset of it.
    const result = { pending: 0, working: 0, ready: 0, error: 0, needsReview: 0, readyToFile: 0, total: 0 };
    for (const row of rows) {
      const n = Number(row.cnt);
      if (row.status === 'pending' || row.status === 'extracting' || row.status === 'fetching') {
        result.pending += n;
        if (row.status !== 'pending') result.working += n;
      } else if (row.status === 'ready') result.ready = n;
      else if (row.status === 'error') result.error = n;
      result.needsReview += Number(row.needsReview ?? 0);
      result.readyToFile += Number(row.readyToFile ?? 0);
      result.total += n;
    }
    return result;
  }

  async getStatistics(
    userId?: number,
    canManageAll?: boolean,
  ): Promise<{
    totalSizeBytes: number;
    byFormat: { format: string; count: number; sizeBytes: number }[];
  }> {
    const visibilityCondition = userId !== undefined ? this.buildVisibilityCondition(userId, canManageAll ?? true) : undefined;
    const rows = await this.db
      .select({
        format: bookDockFiles.format,
        cnt: count(),
        totalSize: sum(bookDockFiles.fileSize),
      })
      .from(bookDockFiles)
      .where(visibilityCondition)
      .groupBy(bookDockFiles.format);

    let totalSizeBytes = 0;
    const byFormat = rows.map((r) => {
      const sizeBytes = Number(r.totalSize ?? 0);
      totalSizeBytes += sizeBytes;
      return { format: r.format ?? 'unknown', count: Number(r.cnt), sizeBytes };
    });

    return { totalSizeBytes, byFormat };
  }

  private buildVisibilityCondition(userId: number, canManageAll: boolean): SQL | undefined {
    if (canManageAll) return undefined;
    return eq(bookDockFiles.uploadedBy, userId);
  }

  private buildSelectionConditions(
    status?: string,
    search?: string,
    userId?: number,
    canManageAll?: boolean,
    needsReview?: boolean,
    readyToFile?: boolean,
  ): SQL[] {
    const conditions: SQL[] = [];
    if (status === 'pending') {
      conditions.push(inArray(bookDockFiles.status, ['pending', 'extracting', 'fetching']));
    } else if (status) {
      conditions.push(eq(bookDockFiles.status, status));
    }
    if (needsReview) conditions.push(needsReviewCondition());
    if (readyToFile) conditions.push(readyToFileCondition());
    if (search) conditions.push(accentInsensitiveIlike(bookDockFiles.fileName, `%${search}%`));
    if (userId !== undefined && !canManageAll) {
      conditions.push(eq(bookDockFiles.uploadedBy, userId));
    }
    return conditions;
  }
}
