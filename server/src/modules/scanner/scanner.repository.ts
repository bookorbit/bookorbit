import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books, libraryFolders, scanJobs } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class ScannerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ── Scan Jobs ──────────────────────────────────────────────────────────────

  async createScanJob(libraryId: number, triggeredBy: string) {
    const [job] = await this.db.insert(scanJobs).values({ libraryId, triggeredBy }).returning();
    return job!;
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
    await this.db
      .update(scanJobs)
      .set({ status: 'failed', errorMessage, completedAt: new Date() })
      .where(eq(scanJobs.status, 'running'));
  }

  // ── Library Folders ────────────────────────────────────────────────────────

  async findLibraryFolders(libraryId: number) {
    return this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
  }

  // ── Books ──────────────────────────────────────────────────────────────────

  async findBooksByLibraryFolder(libraryFolderId: number) {
    return this.db.select().from(books).where(eq(books.libraryFolderId, libraryFolderId));
  }

  async findBookByFolderPath(folderPath: string) {
    const [book] = await this.db.select().from(books).where(eq(books.folderPath, folderPath)).limit(1);
    return book ?? null;
  }

  async createBook(data: typeof books.$inferInsert) {
    const [book] = await this.db.insert(books).values(data).returning();
    // Always create an empty metadata row so joins never return null.
    await this.db.insert(bookMetadata).values({ bookId: book!.id });
    return book!;
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

  async findBookFileByIno(ino: number, libraryFolderId: number) {
    const [file] = await this.db
      .select()
      .from(bookFiles)
      .where(and(eq(bookFiles.ino, ino), eq(bookFiles.libraryFolderId, libraryFolderId)))
      .limit(1);
    return file ?? null;
  }

  async findBookFileByHash(hash: string) {
    const [file] = await this.db.select().from(bookFiles).where(eq(bookFiles.hash, hash)).limit(1);
    return file ?? null;
  }

  async createBookFile(data: typeof bookFiles.$inferInsert) {
    const [file] = await this.db.insert(bookFiles).values(data).returning();
    return file!;
  }

  async updateBookFile(id: number, data: Partial<typeof bookFiles.$inferInsert>) {
    const [file] = await this.db
      .update(bookFiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bookFiles.id, id))
      .returning();
    return file!;
  }
}
