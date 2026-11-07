import { inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { koboEntitlementsOfBooks, koboTombstoneCtes } from './kobo-entitlement-tombstones';
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

/**
 * Moves each library's KOReader hash revision on, so a device re-reads that library's hash list. For a
 * caller that changes which files a library holds without registering or deleting a file row, such as
 * a book moved to another library. Call it in the caller's transaction so it commits with the change.
 */
export async function bumpKoreaderHashRevisions(db: Pick<NodePgDatabase<typeof schema>, 'execute'>, libraryIds: readonly number[]): Promise<void> {
  const ids = [...new Set(libraryIds)];
  if (ids.length === 0) return;
  await db.execute(sql`
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where ${inArray(schema.libraries.id, ids)}
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
 * Kobo entitlements still pointing at the books are tombstoned in the same statement.
 */
export async function deleteBooksWithHashInvalidation(
  db: Pick<NodePgDatabase<typeof schema>, 'execute'>,
  filter: SQL,
  options: { keepFinishedReads?: boolean } = {},
): Promise<void> {
  await (options.keepFinishedReads ? retainFinishedReads(db, filter) : dropReads(db, filter));
  await db.execute(sql`
    with deleted as (
      delete from ${schema.books} where ${filter} returning id, library_id
    ),
    ${smallLinkGroupsCte(sql`select id from deleted`)}
    ${koboTombstoneCtes(koboEntitlementsOfBooks(filter))}
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where id in (select library_id from deleted)
  `);
}

/**
 * A link group left with fewer than two members means "not linked", so it goes with the books. The
 * statement still sees the links the delete cascades away, so members are counted without `deleted`.
 */
function smallLinkGroupsCte(deletedBookIds: SQL): SQL {
  return sql`
    dropped_link_groups as (
      delete from ${schema.bookLinkGroups} g
      where g.id in (select l.group_id from ${schema.bookLinks} l where l.book_id in (${deletedBookIds}))
        and (select count(*) from ${schema.bookLinks} l where l.group_id = g.id and l.book_id not in (${deletedBookIds})) < 2
    ),
  `;
}

export async function deleteLibraryFoldersWithHashInvalidation(db: Pick<NodePgDatabase<typeof schema>, 'execute'>, filter: SQL): Promise<void> {
  // The folder's books go with it by cascade; their finished reads stay in history.
  const booksFilter = sql`${schema.books.libraryFolderId} in (select ${schema.libraryFolders.id} from ${schema.libraryFolders} where ${filter})`;
  await retainFinishedReads(db, booksFilter);
  await db.execute(sql`
    with deleted as (
      delete from ${schema.libraryFolders} where ${filter} returning library_id
    ),
    ${smallLinkGroupsCte(sql`select ${schema.books.id} from ${schema.books} where ${booksFilter}`)}
    ${koboTombstoneCtes(koboEntitlementsOfBooks(booksFilter))}
    update ${schema.libraries}
    set koreader_hash_revision = koreader_hash_revision + 1
    where id in (select library_id from deleted)
  `);
}
