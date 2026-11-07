import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { BookAliasService } from '../../book-alias/book-alias.service';

type Db = NodePgDatabase<typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ENTITLEMENT_RE = /^\d+$/;
const LEGACY_COVER_RE = /^\d+(?:-\d+)?$/;

export interface KoboIdResolveOptions {
  /**
   * A legacy numeric id is the book id itself, so after a merge it names a book that is gone.
   * Progress, annotations and covers follow it to the book it was merged into; removal, metadata
   * and download must not, or a device dropping the old tile would drop the kept book with it.
   */
  followMerges?: boolean;
}

export type KoboBookIdentity = {
  bookId: number;
  entitlementId: string;
  coverImageId: string;
  needsLegacyNumericRemoval: boolean;
};

@Injectable()
export class KoboBookIdentityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly aliases?: BookAliasService,
  ) {}

  async ensureForBook(userId: number, bookId: number, needsLegacyNumericRemoval: boolean): Promise<KoboBookIdentity> {
    const identities = await this.ensureForBooks(userId, [bookId], needsLegacyNumericRemoval);
    return identities.get(bookId)!;
  }

  async ensureForBooks(userId: number, bookIds: number[], needsLegacyNumericRemoval: boolean): Promise<Map<number, KoboBookIdentity>> {
    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length === 0) return new Map();

    let identities = await this.findByBookIds(userId, uniqueBookIds);
    const missingBookIds = uniqueBookIds.filter((bookId) => !identities.has(bookId));

    if (missingBookIds.length > 0) {
      await this.db
        .insert(schema.koboBookEntitlements)
        .values(missingBookIds.map((bookId) => ({ userId, bookId, needsLegacyNumericRemoval })))
        .onConflictDoNothing();
      identities = await this.findByBookIds(userId, uniqueBookIds);
    }

    return identities;
  }

  async findByBookIds(userId: number, bookIds: number[]): Promise<Map<number, KoboBookIdentity>> {
    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        bookId: schema.koboBookEntitlements.bookId,
        entitlementId: schema.koboBookEntitlements.entitlementId,
        coverImageId: schema.koboBookEntitlements.coverImageId,
        needsLegacyNumericRemoval: schema.koboBookEntitlements.needsLegacyNumericRemoval,
      })
      .from(schema.koboBookEntitlements)
      .where(and(eq(schema.koboBookEntitlements.userId, userId), inArray(schema.koboBookEntitlements.bookId, uniqueBookIds)));

    return new Map(rows.map((row) => [row.bookId, row]));
  }

  async resolveBookIdByEntitlementId(userId: number, entitlementId: string, options: KoboIdResolveOptions = {}): Promise<number | null> {
    if (UUID_RE.test(entitlementId)) {
      const [row] = await this.db
        .select({ bookId: schema.koboBookEntitlements.bookId })
        .from(schema.koboBookEntitlements)
        .where(and(eq(schema.koboBookEntitlements.userId, userId), eq(schema.koboBookEntitlements.entitlementId, entitlementId)))
        .limit(1);
      return row?.bookId ?? null;
    }

    if (LEGACY_ENTITLEMENT_RE.test(entitlementId)) {
      return this.legacyBookId(Number(entitlementId), options);
    }

    return null;
  }

  async resolveBookIdByCoverImageId(userId: number, coverImageId: string, options: KoboIdResolveOptions = {}): Promise<number | null> {
    const baseCoverImageId = this.baseCoverImageId(coverImageId);
    if (UUID_RE.test(baseCoverImageId)) {
      const [row] = await this.db
        .select({ bookId: schema.koboBookEntitlements.bookId })
        .from(schema.koboBookEntitlements)
        .where(and(eq(schema.koboBookEntitlements.userId, userId), eq(schema.koboBookEntitlements.coverImageId, baseCoverImageId)))
        .limit(1);
      return row?.bookId ?? null;
    }

    if (LEGACY_COVER_RE.test(coverImageId)) {
      return this.legacyBookId(Number(coverImageId.split('-')[0]), options);
    }

    return null;
  }

  async markLegacyNumericRemovalComplete(userId: number, bookIds: number[]): Promise<void> {
    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length === 0) return;

    await this.db
      .update(schema.koboBookEntitlements)
      .set({ needsLegacyNumericRemoval: false })
      .where(and(eq(schema.koboBookEntitlements.userId, userId), inArray(schema.koboBookEntitlements.bookId, uniqueBookIds)));
  }

  buildVersionedCoverImageId(coverImageId: string, version: Date | null): string {
    return version ? `${coverImageId}_${version.getTime()}` : coverImageId;
  }

  private async legacyBookId(bookId: number, options: KoboIdResolveOptions): Promise<number> {
    if (!options.followMerges || !this.aliases) return bookId;
    return (await this.aliases.resolveOne(bookId)) ?? bookId;
  }

  private baseCoverImageId(coverImageId: string): string {
    return coverImageId.split('_')[0] ?? coverImageId;
  }
}
