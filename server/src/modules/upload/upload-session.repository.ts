import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, libraries, libraryFolders, uploadSessions } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type UploadSessionInsert = typeof uploadSessions.$inferInsert;

@Injectable()
export class UploadSessionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(values: UploadSessionInsert) {
    const [row] = await this.db.insert(uploadSessions).values(values).returning();
    return row!;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(uploadSessions).where(eq(uploadSessions.id, id)).limit(1);
    return row ?? null;
  }

  /**
   * Finds a session that can still be resumed under this key.
   *
   * Expired sessions are excluded deliberately. Idempotency exists to deduplicate a repeated
   * `create` for work still in progress; it must not hand back a session that can no longer receive
   * bytes. The client's key is the queue record's own id and does not change when it retries, so
   * without this predicate a client that deliberately abandons an expired session gets the same
   * dead one back, and its next chunk fails `assertReceiving` with the error it was retrying to
   * escape. Retry then cannot ever succeed.
   */
  async findByIdempotencyKey(userId: number, idempotencyKey: string) {
    const [row] = await this.db
      .select()
      .from(uploadSessions)
      .where(and(eq(uploadSessions.userId, userId), eq(uploadSessions.idempotencyKey, idempotencyKey), gt(uploadSessions.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  }

  async update(id: string, values: Partial<Omit<UploadSessionInsert, 'id' | 'userId' | 'idempotencyKey'>>) {
    const [row] = await this.db
      .update(uploadSessions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(uploadSessions.id, id))
      .returning();
    return row ?? null;
  }

  findProcessing() {
    return this.db.select().from(uploadSessions).where(eq(uploadSessions.status, 'processing'));
  }

  findExpiredReceiving(now: Date) {
    return this.db
      .select()
      .from(uploadSessions)
      .where(and(inArray(uploadSessions.status, ['receiving', 'failed']), lt(uploadSessions.expiresAt, now)));
  }

  deleteTerminalBefore(cutoff: Date) {
    return this.db
      .delete(uploadSessions)
      .where(and(inArray(uploadSessions.status, ['completed', 'cancelled', 'expired']), lt(uploadSessions.updatedAt, cutoff)));
  }

  findCapabilityLibraries(libraryIds: number[]) {
    if (libraryIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({ id: libraries.id, name: libraries.name, allowedFormats: libraries.allowedFormats, organizationMode: libraries.organizationMode })
      .from(libraries)
      .where(inArray(libraries.id, libraryIds));
  }

  findCapabilityFolders(libraryIds: number[]) {
    if (libraryIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({ id: libraryFolders.id, libraryId: libraryFolders.libraryId, path: libraryFolders.path })
      .from(libraryFolders)
      .where(inArray(libraryFolders.libraryId, libraryIds));
  }

  async findLibrary(id: number) {
    const [row] = await this.db.select().from(libraries).where(eq(libraries.id, id)).limit(1);
    return row ?? null;
  }

  async folderBelongsToLibrary(folderId: number, libraryId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: libraryFolders.id })
      .from(libraryFolders)
      .where(and(eq(libraryFolders.id, folderId), eq(libraryFolders.libraryId, libraryId)))
      .limit(1);
    return row !== undefined;
  }

  async findBookTarget(bookId: number) {
    const [row] = await this.db
      .select({
        libraryId: books.libraryId,
        allowedFormats: libraries.allowedFormats,
        organizationMode: libraries.organizationMode,
        // Needed by validateTarget: a book whose folder path is a file cannot receive another file,
        // and without checking it the upload is accepted, transferred, and only fails at import.
        folderPath: books.folderPath,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }

  async findBookLibraryId(bookId: number): Promise<number | null> {
    const [row] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    return row?.libraryId ?? null;
  }

  async findLibraryAllowedFormats(libraryId: number): Promise<string[] | null> {
    const [row] = await this.db.select({ allowedFormats: libraries.allowedFormats }).from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    return row?.allowedFormats ?? null;
  }

  async findPrimaryBookFile(bookId: number) {
    const [row] = await this.db
      .select({ absolutePath: bookFiles.absolutePath, format: bookFiles.format, libraryId: books.libraryId })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }
}
