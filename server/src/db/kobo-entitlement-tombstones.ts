import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

type Executor = Pick<NodePgDatabase<typeof schema>, 'execute'>;

const entitlements = schema.koboBookEntitlements;

/**
 * Selects the entitlements of the books matching `bookWhere`, a predicate over `books`, for
 * {@link koboTombstoneCtes} and {@link writeKoboEntitlementTombstones}.
 */
export function koboEntitlementsOfBooks(bookWhere: SQL): SQL {
  return sql`${entitlements.bookId} in (select ${schema.books.id} from ${schema.books} where ${bookWhere})`;
}

/**
 * The `with` entries that tombstone the entitlements matching `entitlementWhere`, a predicate over
 * `kobo_book_entitlements`, joined into the statement that deletes their books. The delete cascades
 * the entitlement and snapshot rows, and every entry of one statement reads the same snapshot, so
 * these still see them and commit or fail with the delete even when the caller has no transaction.
 *
 * A device owes the removal when its snapshot held the book (and it did not delete the book itself),
 * or when it has no snapshot yet: a first sync removes every entitlement the user had, and the
 * deleted one is no longer there to find. The numeric removal follows the same flags sync reads for
 * a pending delete.
 */
export function koboTombstoneCtes(entitlementWhere: SQL): SQL {
  return sql`
    kobo_owed_removals as (
      select ${entitlements.userId} as user_id, ${entitlements.entitlementId} as entitlement_id, ${entitlements.bookId} as book_id,
        d.id as device_id,
        case
          when s.id is null then ${entitlements.needsLegacyNumericRemoval} or exists (
            select 1
            from ${schema.koboLegacySnapshotBooks} lsb
            join ${schema.koboLegacyLibrarySnapshots} ls on ls.id = lsb.snapshot_id
            where ls.user_id = ${entitlements.userId}
              and lsb.book_id = ${entitlements.bookId}
              and d.created_at <= ls.legacy_device_cutoff_at
          )
          else sb.needs_legacy_numeric_removal
        end as legacy_numeric_removal
      from ${entitlements}
      join ${schema.koboDevices} d on d.user_id = ${entitlements.userId}
      left join ${schema.koboLibrarySnapshots} s on s.device_id = d.id
      left join ${schema.koboSnapshotBooks} sb on sb.snapshot_id = s.id and sb.book_id = ${entitlements.bookId}
      where (${entitlementWhere})
        and (s.id is null or (sb.book_id is not null and sb.removed_by_device = false))
    ),
    kobo_tombstoned as (
      insert into ${schema.koboEntitlementTombstones} (user_id, entitlement_id, legacy_book_id)
      select user_id, entitlement_id, case when bool_or(legacy_numeric_removal) then book_id end
      from kobo_owed_removals
      group by user_id, entitlement_id, book_id
      on conflict (user_id, entitlement_id) do update
      set removed_at = excluded.removed_at,
          legacy_book_id = coalesce(excluded.legacy_book_id, ${schema.koboEntitlementTombstones}.legacy_book_id)
    ),
    kobo_device_tombstoned as (
      insert into ${schema.koboDeviceEntitlementTombstones} (user_id, device_id, entitlement_id, legacy_numeric_removal)
      select user_id, device_id, entitlement_id, legacy_numeric_removal
      from kobo_owed_removals
      on conflict (device_id, entitlement_id) do nothing
    )
  `;
}

/**
 * Tombstones the Kobo entitlements of the books matching `bookWhere` (a predicate over `books`), so
 * every device that holds one is sent `IsRemoved` after the book row is gone. Call it in the
 * caller's transaction, before the delete. The shared book and folder delete helpers already do
 * this inside their delete statement.
 */
export async function writeKoboTombstones(db: Executor, bookWhere: SQL): Promise<void> {
  await writeKoboEntitlementTombstones(db, koboEntitlementsOfBooks(bookWhere));
}

/**
 * Tombstones specific entitlement rows, matched by `entitlementWhere` over `kobo_book_entitlements`,
 * for a caller that drops an entitlement while its book stays (a merge keeping the other book's).
 * Call it in the caller's transaction, before the rows are deleted.
 */
export async function writeKoboEntitlementTombstones(db: Executor, entitlementWhere: SQL): Promise<void> {
  await db.execute(sql`with ${koboTombstoneCtes(entitlementWhere)} select 1`);
}
