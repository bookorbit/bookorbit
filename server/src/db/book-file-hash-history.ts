import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export async function recordBookFileHashHistory(
  db: Pick<NodePgDatabase<typeof schema>, 'execute'>,
  bookFileId: number,
  fileHash: string,
  reason: string,
): Promise<void> {
  // Registration and invalidation commit together. Duplicate deliveries do not invalidate caches.
  // Selecting the source also lets recovery discard entries for files that were deleted.
  await db.execute(sql`
    with registered as (
      insert into ${schema.bookFileHashHistory} (book_file_id, file_hash, reason)
      select ${schema.bookFiles.id}, ${fileHash}, ${reason}
      from ${schema.bookFiles} where ${schema.bookFiles.id} = ${bookFileId}
      on conflict (book_file_id, file_hash) do nothing
      returning book_file_id
    )
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where id in (
      select ${schema.books.libraryId} from registered
      join ${schema.bookFiles} on ${schema.bookFiles.id} = registered.book_file_id
      join ${schema.books} on ${schema.books.id} = ${schema.bookFiles.bookId}
    )
  `);
}

export async function deleteBookFilesWithHashInvalidation(db: Pick<NodePgDatabase<typeof schema>, 'execute'>, filter: SQL): Promise<void> {
  await db.execute(sql`
    with deleted as (
      delete from ${schema.bookFiles} where ${filter} returning book_id
    )
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where id in (
      select ${schema.books.libraryId} from ${schema.books}
      join deleted on deleted.book_id = ${schema.books.id}
    )
  `);
}

export async function deleteBooksWithHashInvalidation(db: Pick<NodePgDatabase<typeof schema>, 'execute'>, filter: SQL): Promise<void> {
  await db.execute(sql`
    with deleted as (
      delete from ${schema.books} where ${filter} returning library_id
    )
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where id in (select library_id from deleted)
  `);
}

export async function deleteLibraryFoldersWithHashInvalidation(db: Pick<NodePgDatabase<typeof schema>, 'execute'>, filter: SQL): Promise<void> {
  await db.execute(sql`
    with deleted as (
      delete from ${schema.libraryFolders} where ${filter} returning library_id
    )
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where id in (select library_id from deleted)
  `);
}
