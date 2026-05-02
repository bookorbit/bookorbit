import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookGenres, bookMetadata, books, genres, libraries, libraryFolders, scanJobs } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class ScannerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ── Scan Jobs ──────────────────────────────────────────────────────────────

  async createScanJob(libraryId: number, triggeredBy: string) {
    const [job] = await this.db.insert(scanJobs).values({ libraryId, triggeredBy }).returning();
    return job;
  }

  async completeScanJob(id: number, counts: { addedCount: number; updatedCount: number; missingCount: number }) {
    await this.db
      .update(scanJobs)
      .set({ ...counts, status: 'completed', completedAt: new Date() })
      .where(eq(scanJobs.id, id));
  }

  async failScanJob(id: number, errorMessage: string) {
    await this.db.update(scanJobs).set({ status: 'failed', errorMessage, completedAt: new Date() }).where(eq(scanJobs.id, id));
  }

  async failAllRunningJobs(errorMessage: string): Promise<void> {
    await this.db.update(scanJobs).set({ status: 'failed', errorMessage, completedAt: new Date() }).where(eq(scanJobs.status, 'running'));
  }

  // ── Library Folders ────────────────────────────────────────────────────────

  async findLibraryFolders(libraryId: number) {
    return this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
  }

  async findLibrarySettings(libraryId: number) {
    const [row] = await this.db
      .select({
        allowedFormats: libraries.allowedFormats,
        formatPriority: libraries.formatPriority,
        excludePatterns: libraries.excludePatterns,
        organizationMode: libraries.organizationMode,
      })
      .from(libraries)
      .where(eq(libraries.id, libraryId));
    return row ?? null;
  }

  async findLibraryFolderPath(libraryFolderId: number): Promise<string | null> {
    const [row] = await this.db.select({ path: libraryFolders.path }).from(libraryFolders).where(eq(libraryFolders.id, libraryFolderId)).limit(1);
    return row?.path ?? null;
  }

  async findLibraryName(libraryId: number): Promise<string | null> {
    const [row] = await this.db.select({ name: libraries.name }).from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    return row?.name ?? null;
  }

  // ── Books ──────────────────────────────────────────────────────────────────

  async findBooksByLibraryFolder(libraryFolderId: number) {
    return this.db
      .select({
        id: books.id,
        status: books.status,
        folderPath: books.folderPath,
      })
      .from(books)
      .where(eq(books.libraryFolderId, libraryFolderId));
  }

  async findPrimaryBookFilesByLibrary(libraryId: number) {
    return this.db
      .select({ bookId: books.id, absolutePath: bookFiles.absolutePath, format: bookFiles.format })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(eq(books.libraryId, libraryId), ne(books.status, 'missing')));
  }

  async findPrimaryBookFilesByBookId(bookId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        bookId: bookFiles.bookId,
        libraryFolderId: bookFiles.libraryFolderId,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        ino: bookFiles.ino,
        sizeBytes: bookFiles.sizeBytes,
        mtime: bookFiles.mtime,
        hash: bookFiles.hash,
        format: bookFiles.format,
        role: bookFiles.role,
        sortOrder: bookFiles.sortOrder,
        durationSeconds: bookFiles.durationSeconds,
        createdAt: bookFiles.createdAt,
        updatedAt: bookFiles.updatedAt,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(eq(books.id, bookId));
  }

  async createBook(data: typeof books.$inferInsert) {
    const rows = await this.db
      .insert(books)
      .values(data)
      .onConflictDoUpdate({
        target: [books.libraryId, books.folderPath],
        set: { status: 'present', updatedAt: new Date() },
      })
      .returning();
    const book = rows[0]!;
    // Always create an empty metadata row so joins never return null.
    await this.db.insert(bookMetadata).values({ bookId: book.id }).onConflictDoNothing();
    return book;
  }

  async updateBookStatus(id: number, status: 'present' | 'missing') {
    await this.db.update(books).set({ status, updatedAt: new Date() }).where(eq(books.id, id));
  }

  async updateBookPrimaryFile(bookId: number, primaryFileId: number | null) {
    const primaryScope =
      primaryFileId == null
        ? sql`TRUE`
        : sql`EXISTS (SELECT 1 FROM ${bookFiles} WHERE ${bookFiles.id} = ${primaryFileId} AND ${bookFiles.bookId} = ${bookId})`;

    await this.db
      .update(books)
      .set({ primaryFileId, updatedAt: new Date() })
      .where(and(eq(books.id, bookId), sql`${books.primaryFileId} IS DISTINCT FROM ${primaryFileId}`, primaryScope));
  }

  async markBooksAsMissing(ids: number[]) {
    if (ids.length === 0) return;
    await this.db.update(books).set({ status: 'missing', updatedAt: new Date() }).where(inArray(books.id, ids));
  }

  // ── Book Files ─────────────────────────────────────────────────────────────

  async findBookFilesByLibraryFolder(libraryFolderId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        bookId: bookFiles.bookId,
        absolutePath: bookFiles.absolutePath,
        ino: bookFiles.ino,
        sizeBytes: bookFiles.sizeBytes,
        mtime: bookFiles.mtime,
        hash: bookFiles.hash,
        sortOrder: bookFiles.sortOrder,
      })
      .from(bookFiles)
      .where(eq(bookFiles.libraryFolderId, libraryFolderId));
  }

  async findBookFileByHash(hash: string, libraryFolderId: number) {
    const [file] = await this.db
      .select()
      .from(bookFiles)
      .where(and(eq(bookFiles.hash, hash), eq(bookFiles.libraryFolderId, libraryFolderId)))
      .limit(1);
    return file ?? null;
  }

  async createBookFile(data: typeof bookFiles.$inferInsert) {
    const rows = await this.db.insert(bookFiles).values(data).returning();
    return rows[0]!;
  }

  async updateBookFile(id: number, data: Partial<typeof bookFiles.$inferInsert>) {
    const [file] = await this.db
      .update(bookFiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bookFiles.id, id))
      .returning();
    return file;
  }

  async findBookFileByAbsolutePath(absolutePath: string, libraryId?: number) {
    const whereClause =
      libraryId == null ? eq(bookFiles.absolutePath, absolutePath) : and(eq(bookFiles.absolutePath, absolutePath), eq(books.libraryId, libraryId));
    const [row] = await this.db
      .select({ file: bookFiles, libraryId: books.libraryId, primaryFileId: books.primaryFileId })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(whereClause)
      .limit(1);
    return row ?? null;
  }

  async findBooksByFolderPath(folderPath: string, libraryId?: number) {
    const folderScope = or(eq(books.folderPath, folderPath), and(gte(books.folderPath, folderPath + '/'), lt(books.folderPath, folderPath + '0')));
    const whereClause = libraryId == null ? folderScope : and(eq(books.libraryId, libraryId), folderScope);
    return this.db.select().from(books).where(whereClause);
  }

  async findMissingBookByFolderPath(folderPath: string, libraryId?: number) {
    const whereClause =
      libraryId == null
        ? and(eq(books.folderPath, folderPath), eq(books.status, 'missing'))
        : and(eq(books.libraryId, libraryId), eq(books.folderPath, folderPath), eq(books.status, 'missing'));
    const [row] = await this.db.select().from(books).where(whereClause).limit(1);
    return row ?? null;
  }

  async findMissingBooksByFolderPath(folderPath: string, libraryId?: number) {
    const folderScope = or(eq(books.folderPath, folderPath), and(gte(books.folderPath, folderPath + '/'), lt(books.folderPath, folderPath + '0')));
    const whereClause =
      libraryId == null
        ? and(folderScope, eq(books.status, 'missing'))
        : and(eq(books.libraryId, libraryId), folderScope, eq(books.status, 'missing'));
    return this.db.select().from(books).where(whereClause);
  }

  async findMissingBooksForLibraries(libraryIds: number[]) {
    if (libraryIds.length === 0) return [];
    return this.db
      .select()
      .from(books)
      .where(and(inArray(books.libraryId, libraryIds), eq(books.status, 'missing')));
  }

  async markBooksAsPresent(bookIds: number[]) {
    if (bookIds.length === 0) return;
    await this.db.update(books).set({ status: 'present', updatedAt: new Date() }).where(inArray(books.id, bookIds));
  }

  async moveBookToLibrary(bookId: number, libraryId: number, libraryFolderId: number, folderPath: string) {
    const [book] = await this.db
      .update(books)
      .set({
        libraryId,
        libraryFolderId,
        folderPath,
        status: 'present',
        updatedAt: new Date(),
      })
      .where(eq(books.id, bookId))
      .returning();
    return book ?? null;
  }

  async findBookFilesByBookId(bookId: number) {
    return this.db.select().from(bookFiles).where(eq(bookFiles.bookId, bookId));
  }

  async findBookFilesByBookIds(bookIds: number[]) {
    if (bookIds.length === 0) return [];
    return this.db.select().from(bookFiles).where(inArray(bookFiles.bookId, bookIds));
  }

  async deleteBookFile(id: number) {
    await this.db.delete(bookFiles).where(eq(bookFiles.id, id));
  }

  async findBookFileWithContextByIno(ino: number, libraryId?: number) {
    const whereClause = libraryId == null ? eq(bookFiles.ino, ino) : and(eq(bookFiles.ino, ino), eq(books.libraryId, libraryId));
    const [row] = await this.db
      .select({
        file: bookFiles,
        libraryId: books.libraryId,
        bookStatus: books.status,
        folderPath: books.folderPath,
        libraryFolderPath: libraryFolders.path,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, bookFiles.libraryFolderId))
      .where(whereClause)
      .limit(1);
    return row ?? null;
  }

  async findMissingBookFileWithContextByIno(ino: number) {
    const [row] = await this.db
      .select({
        file: bookFiles,
        libraryId: books.libraryId,
        bookStatus: books.status,
        folderPath: books.folderPath,
        libraryFolderPath: libraryFolders.path,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, bookFiles.libraryFolderId))
      .where(and(eq(bookFiles.ino, ino), eq(books.status, 'missing')))
      .limit(1);
    return row ?? null;
  }

  async findBookFileWithContextByHash(hash: string) {
    const [row] = await this.db
      .select({
        file: bookFiles,
        libraryId: books.libraryId,
        bookStatus: books.status,
        folderPath: books.folderPath,
        libraryFolderPath: libraryFolders.path,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, bookFiles.libraryFolderId))
      .where(eq(bookFiles.hash, hash))
      .limit(1);
    return row ?? null;
  }

  async findMissingBookFileWithContextByHash(hash: string) {
    const [row] = await this.db
      .select({
        file: bookFiles,
        libraryId: books.libraryId,
        bookStatus: books.status,
        folderPath: books.folderPath,
        libraryFolderPath: libraryFolders.path,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, bookFiles.libraryFolderId))
      .where(and(eq(bookFiles.hash, hash), eq(books.status, 'missing')))
      .limit(1);
    return row ?? null;
  }

  async updateBookFolderPath(bookId: number, folderPath: string) {
    await this.db.update(books).set({ folderPath, updatedAt: new Date() }).where(eq(books.id, bookId));
  }

  async findBookById(bookId: number) {
    const [row] = await this.db.select().from(books).where(eq(books.id, bookId)).limit(1);
    return row ?? null;
  }

  async findBookCardData(bookIds: number[]) {
    if (bookIds.length === 0) return { rows: [], authorRows: [], fileRows: [], genreRows: [] };

    const [rows, authorRows, fileRows, genreRows] = await Promise.all([
      this.db
        .select({
          id: books.id,
          status: books.status,
          primaryFileId: books.primaryFileId,
          folderPath: books.folderPath,
          addedAt: books.addedAt,
          title: bookMetadata.title,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          publishedYear: bookMetadata.publishedYear,
          language: bookMetadata.language,
          rating: bookMetadata.rating,
          coverSource: bookMetadata.coverSource,
          lockedFields: bookMetadata.lockedFields,
          subtitle: bookMetadata.subtitle,
          publisher: bookMetadata.publisher,
          pageCount: bookMetadata.pageCount,
          isbn13: bookMetadata.isbn13,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ bookId: bookFiles.bookId, id: bookFiles.id, format: bookFiles.format, role: bookFiles.role, sizeBytes: bookFiles.sizeBytes })
        .from(bookFiles)
        .where(inArray(bookFiles.bookId, bookIds)),
      this.db
        .select({ bookId: bookGenres.bookId, name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, eq(genres.id, bookGenres.genreId))
        .where(inArray(bookGenres.bookId, bookIds)),
    ]);

    return { rows, authorRows, fileRows, genreRows };
  }

  // ── Dir Scan State (Incremental Scan) ────────────────────────────────────

  async findDirScanState(libraryFolderId: number): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ dirPath: schema.libraryDirScanState.dirPath, lastSeenMtimeMs: schema.libraryDirScanState.lastSeenMtimeMs })
      .from(schema.libraryDirScanState)
      .where(eq(schema.libraryDirScanState.libraryFolderId, libraryFolderId));
    return new Map(rows.map((r) => [r.dirPath, r.lastSeenMtimeMs]));
  }

  async upsertDirScanState(libraryFolderId: number, entries: Array<{ dirPath: string; mtimeMs: number }>): Promise<void> {
    if (entries.length === 0) return;
    const CHUNK = 500;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      await this.db
        .insert(schema.libraryDirScanState)
        .values(chunk.map((e) => ({ libraryFolderId, dirPath: e.dirPath, lastSeenMtimeMs: Math.round(e.mtimeMs) })))
        .onConflictDoUpdate({
          target: [schema.libraryDirScanState.libraryFolderId, schema.libraryDirScanState.dirPath],
          set: { lastSeenMtimeMs: sql`excluded.last_seen_mtime_ms` },
        });
    }
  }

  async deleteStaleDirScanState(libraryFolderId: number, validPaths: Set<string>): Promise<void> {
    if (validPaths.size === 0) {
      await this.db.delete(schema.libraryDirScanState).where(eq(schema.libraryDirScanState.libraryFolderId, libraryFolderId));
      return;
    }
    const allRows = await this.db
      .select({ id: schema.libraryDirScanState.id, dirPath: schema.libraryDirScanState.dirPath })
      .from(schema.libraryDirScanState)
      .where(eq(schema.libraryDirScanState.libraryFolderId, libraryFolderId));
    const staleIds = allRows.filter((r) => !validPaths.has(r.dirPath)).map((r) => r.id);
    if (staleIds.length === 0) return;
    const CHUNK = 500;
    for (let i = 0; i < staleIds.length; i += CHUNK) {
      await this.db.delete(schema.libraryDirScanState).where(inArray(schema.libraryDirScanState.id, staleIds.slice(i, i + CHUNK)));
    }
  }

  async clearDirScanState(libraryFolderId: number): Promise<void> {
    await this.db.delete(schema.libraryDirScanState).where(eq(schema.libraryDirScanState.libraryFolderId, libraryFolderId));
  }
}
