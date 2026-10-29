import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { dropReads, retainFinishedReads } from './reading-attempt-retention';
import * as schema from './schema';

export async function recordBookFileHashHistory(
  db: Pick<NodePgDatabase<typeof schema>, 'execute'>,
  bookFileId: number,
  fileHash: string,
  reason: string,
): Promise<void> {
  // Registration and invalidation commit together. Duplicate deliveries do not invalidate caches.
  // Selecting the source also lets recovery discard entries for files that were deleted.
  const conflict =
    reason === 'kobo_download'
      ? sql`do nothing`
      : sql`do update set reason = excluded.reason, created_at = now() where excluded.reason <> 'kobo_download'`;
  await db.execute(sql`
    with registered as (
      insert into ${schema.bookFileHashHistory} (book_file_id, file_hash, reason)
      select ${schema.bookFiles.id}, ${fileHash}, ${reason}
      from ${schema.bookFiles} where ${schema.bookFiles.id} = ${bookFileId}
      on conflict (book_file_id, file_hash) ${conflict}
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

/**
 * `keepFinishedReads` is for books leaving the library for good (a user's delete, files gone from
 * disk): their finished reads stay in each reader's history. Merges and rollbacks leave it off.
 */
export async function deleteBooksWithHashInvalidation(
  db: Pick<NodePgDatabase<typeof schema>, 'execute'>,
  filter: SQL,
  options: { keepFinishedReads?: boolean } = {},
): Promise<void> {
  await (options.keepFinishedReads ? retainFinishedReads(db, filter) : dropReads(db, filter));
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
  // The folder's books go with it by cascade; their finished reads stay in history.
  await retainFinishedReads(
    db,
    sql`${schema.books.libraryFolderId} in (select ${schema.libraryFolders.id} from ${schema.libraryFolders} where ${filter})`,
  );
  await db.execute(sql`
    with deleted as (
      delete from ${schema.libraryFolders} where ${filter} returning library_id
    )
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where id in (select library_id from deleted)
  `);
}
