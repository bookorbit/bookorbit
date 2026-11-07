import { eq, inArray } from 'drizzle-orm';
import { createCapturingDb } from '../common/test-utils/capture-sql-db';
import { writeKoboEntitlementTombstones, writeKoboTombstones } from './kobo-entitlement-tombstones';
import * as schema from './schema';

function normalize(sqlText: string): string {
  return sqlText.replace(/\s+/g, ' ').trim();
}

describe('Kobo entitlement tombstones', () => {
  it('tombstones the entitlements of the matching books in one set-based statement', async () => {
    const { db, queries } = createCapturingDb();

    await writeKoboTombstones(db, eq(schema.books.libraryId, 3));

    expect(queries).toHaveLength(1);
    const statement = normalize(queries[0]!.sql);
    expect(statement).toMatch(/^with kobo_owed_removals as \(/);
    expect(statement).toContain('where ("kobo_book_entitlements"."book_id" in (select "books"."id" from "books" where "books"."library_id" = $1))');
    expect(statement).toContain('insert into "kobo_entitlement_tombstones" (user_id, entitlement_id, legacy_book_id)');
    expect(statement).toContain('insert into "kobo_device_entitlement_tombstones" (user_id, device_id, entitlement_id, legacy_numeric_removal)');
    expect(statement).toMatch(/select 1$/);
    expect(queries[0]!.params).toEqual([3]);
  });

  it('owes the removal to devices whose snapshot held the book and to devices with no snapshot yet', async () => {
    const { db, queries } = createCapturingDb();

    await writeKoboTombstones(db, eq(schema.books.id, 9));

    const statement = normalize(queries[0]!.sql);
    expect(statement).toContain('join "kobo_devices" d on d.user_id = "kobo_book_entitlements"."user_id"');
    expect(statement).toContain('and (s.id is null or (sb.book_id is not null and sb.removed_by_device = false))');
  });

  it('records the numeric id only when a device may still know the book by it', async () => {
    const { db, queries } = createCapturingDb();

    await writeKoboTombstones(db, eq(schema.books.id, 9));

    const statement = normalize(queries[0]!.sql);
    expect(statement).toContain('else sb.needs_legacy_numeric_removal end as legacy_numeric_removal');
    expect(statement).toContain('when s.id is null then "kobo_book_entitlements"."needs_legacy_numeric_removal" or exists');
    expect(statement).toContain('and d.created_at <= ls.legacy_device_cutoff_at');
    expect(statement).toContain('case when bool_or(legacy_numeric_removal) then book_id end');
  });

  it('does not fail when an entitlement is tombstoned twice, and keeps the numeric id it already had', async () => {
    const { db, queries } = createCapturingDb();

    await writeKoboTombstones(db, eq(schema.books.id, 9));

    const statement = normalize(queries[0]!.sql);
    expect(statement).toContain(
      'on conflict (user_id, entitlement_id) do update set removed_at = excluded.removed_at, legacy_book_id = coalesce(excluded.legacy_book_id, "kobo_entitlement_tombstones".legacy_book_id)',
    );
    expect(statement).toContain('on conflict (device_id, entitlement_id) do nothing');
  });

  it('tombstones specific entitlement rows for a caller that keeps the book', async () => {
    const { db, queries } = createCapturingDb();

    await writeKoboEntitlementTombstones(db, inArray(schema.koboBookEntitlements.id, [4, 5]));

    const statement = normalize(queries[0]!.sql);
    expect(statement).toContain('where ("kobo_book_entitlements"."id" in ($1, $2))');
    expect(statement).not.toContain('from "books"');
    expect(queries[0]!.params).toEqual([4, 5]);
  });

  it('propagates a database failure so the caller rolls the delete back with it', async () => {
    const failure = new Error('Database unavailable');
    const db = { execute: vi.fn().mockRejectedValue(failure) };

    await expect(writeKoboTombstones(db as never, eq(schema.books.id, 9))).rejects.toBe(failure);
  });
});
