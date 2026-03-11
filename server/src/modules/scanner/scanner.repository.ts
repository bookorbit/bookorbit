import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, like, ne, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books, libraryFolders, libraries, scanJobs } from '../../db/schema';

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
      .select({ allowedFormats: libraries.allowedFormats, formatPriority: libraries.formatPriority })
      .from(libraries)
      .where(eq(libraries.id, libraryId));
    return row ?? null;
  }

  // ── Books ──────────────────────────────────────────────────────────────────

  async findBooksByLibraryFolder(libraryFolderId: number) {
    return this.db.select().from(books).where(eq(books.libraryFolderId, libraryFolderId));
  }

  async findPrimaryBookFilesByLibrary(libraryId: number) {
    return this.db
      .select({ bookId: books.id, absolutePath: bookFiles.absolutePath, format: bookFiles.format })
      .from(books)
      .innerJoin(bookFiles, and(eq(bookFiles.bookId, books.id), eq(bookFiles.role, 'primary')))
      .where(and(eq(books.libraryId, libraryId), ne(books.status, 'missing')));
  }

  async findPrimaryBookFilesByBookId(bookId: number) {
    return this.db
      .select()
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.role, 'primary')));
  }

  async createBook(data: typeof books.$inferInsert) {
    const [book] = await this.db
      .insert(books)
      .values(data)
      .onConflictDoUpdate({
        target: [books.libraryId, books.folderPath],
        set: { status: 'present', updatedAt: new Date() },
      })
      .returning();
    // Always create an empty metadata row so joins never return null.
    await this.db.insert(bookMetadata).values({ bookId: book.id }).onConflictDoNothing();
    return book;
  }

  async updateBookStatus(id: number, status: 'present' | 'missing') {
    await this.db.update(books).set({ status, updatedAt: new Date() }).where(eq(books.id, id));
  }

  async markBooksAsMissing(ids: number[]) {
    if (ids.length === 0) return;
    await this.db.update(books).set({ status: 'missing', updatedAt: new Date() }).where(inArray(books.id, ids));
  }

  // ── Book Files ─────────────────────────────────────────────────────────────

  async findBookFilesByLibraryFolder(libraryFolderId: number) {
    return this.db.select().from(bookFiles).where(eq(bookFiles.libraryFolderId, libraryFolderId));
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
    const [file] = await this.db.insert(bookFiles).values(data).returning();
    return file;
  }

  async updateBookFile(id: number, data: Partial<typeof bookFiles.$inferInsert>) {
    const [file] = await this.db
      .update(bookFiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bookFiles.id, id))
      .returning();
    return file;
  }

  async findBookFileByAbsolutePath(absolutePath: string) {
    const [row] = await this.db
      .select({ file: bookFiles, libraryId: books.libraryId })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.absolutePath, absolutePath))
      .limit(1);
    return row ?? null;
  }

  async findBooksByFolderPath(folderPath: string) {
    return this.db
      .select()
      .from(books)
      .where(or(eq(books.folderPath, folderPath), like(books.folderPath, folderPath + '/%')));
  }

  async findMissingBookByFolderPath(folderPath: string) {
    const [row] = await this.db
      .select()
      .from(books)
      .where(and(eq(books.folderPath, folderPath), eq(books.status, 'missing')))
      .limit(1);
    return row ?? null;
  }

  async findMissingBooksByFolderPath(folderPath: string) {
    return this.db
      .select()
      .from(books)
      .where(and(or(eq(books.folderPath, folderPath), like(books.folderPath, folderPath + '/%')), eq(books.status, 'missing')));
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

  async findBookFileWithContextByIno(ino: number) {
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
      .where(eq(bookFiles.ino, ino))
      .limit(1);
    return row ?? null;
  }

  async updateBookFolderPath(bookId: number, folderPath: string) {
    await this.db.update(books).set({ folderPath, updatedAt: new Date() }).where(eq(books.id, bookId));
  }
}
