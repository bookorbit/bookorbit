import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  bookCommunityRatings,
  bookProviderIds,
  metadataHttpProviderIcons,
  metadataHttpProviders,
  providerMetadataCache,
  type MetadataHttpProviderRow,
  type NewMetadataHttpProviderRow,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface PurgeCounts {
  providerIds: number;
  ratings: number;
  cacheEntries: number;
}

@Injectable()
export class MetadataHttpProviderRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll(): Promise<MetadataHttpProviderRow[]> {
    return this.db.select().from(metadataHttpProviders).orderBy(asc(metadataHttpProviders.id));
  }

  async findById(id: number): Promise<MetadataHttpProviderRow | null> {
    const [row] = await this.db.select().from(metadataHttpProviders).where(eq(metadataHttpProviders.id, id)).limit(1);
    return row ?? null;
  }

  async findByKey(key: string): Promise<MetadataHttpProviderRow | null> {
    const [row] = await this.db.select().from(metadataHttpProviders).where(eq(metadataHttpProviders.key, key)).limit(1);
    return row ?? null;
  }

  async insert(row: NewMetadataHttpProviderRow): Promise<MetadataHttpProviderRow> {
    const [created] = await this.db.insert(metadataHttpProviders).values(row).returning();
    return created;
  }

  async update(id: number, patch: Partial<NewMetadataHttpProviderRow>): Promise<MetadataHttpProviderRow | null> {
    const [updated] = await this.db.update(metadataHttpProviders).set(patch).where(eq(metadataHttpProviders.id, id)).returning();
    return updated ?? null;
  }

  /** Icon hash and source URL by provider id, without the image bytes. */
  async findIconVersions(): Promise<Map<number, { hash: string; sourceUrl: string }>> {
    const rows = await this.db
      .select({
        providerId: metadataHttpProviderIcons.providerId,
        hash: metadataHttpProviderIcons.hash,
        sourceUrl: metadataHttpProviderIcons.sourceUrl,
      })
      .from(metadataHttpProviderIcons);
    return new Map(rows.map((row) => [row.providerId, { hash: row.hash, sourceUrl: row.sourceUrl }]));
  }

  async findIconByKey(key: string): Promise<{ contentType: string; hash: string; data: Buffer } | null> {
    const [row] = await this.db
      .select({ contentType: metadataHttpProviderIcons.contentType, hash: metadataHttpProviderIcons.hash, data: metadataHttpProviderIcons.data })
      .from(metadataHttpProviderIcons)
      .innerJoin(metadataHttpProviders, eq(metadataHttpProviders.id, metadataHttpProviderIcons.providerId))
      .where(eq(metadataHttpProviders.key, key))
      .limit(1);
    return row ?? null;
  }

  async saveIcon(providerId: number, icon: { sourceUrl: string; contentType: string; hash: string; data: Buffer }): Promise<void> {
    await this.db
      .insert(metadataHttpProviderIcons)
      .values({ providerId, ...icon })
      .onConflictDoUpdate({ target: metadataHttpProviderIcons.providerId, set: { ...icon, updatedAt: new Date() } });
  }

  async deleteIcon(providerId: number): Promise<void> {
    await this.db.delete(metadataHttpProviderIcons).where(eq(metadataHttpProviderIcons.providerId, providerId));
  }

  /**
   * Writes `patch` only while the row still has the connection it was read with, so the outcome of
   * a slow check against an old address never lands on a row an admin has pointed elsewhere.
   */
  async updateIfConnectionUnchanged(row: MetadataHttpProviderRow, patch: Partial<NewMetadataHttpProviderRow>): Promise<boolean> {
    const updated = await this.db
      .update(metadataHttpProviders)
      .set(patch)
      .where(
        and(
          eq(metadataHttpProviders.id, row.id),
          eq(metadataHttpProviders.baseUrl, row.baseUrl),
          eq(metadataHttpProviders.allowPrivateAddress, row.allowPrivateAddress),
          eq(metadataHttpProviders.timeoutMs, row.timeoutMs),
          row.authorizationEnc === null
            ? isNull(metadataHttpProviders.authorizationEnc)
            : eq(metadataHttpProviders.authorizationEnc, row.authorizationEnc),
        ),
      )
      .returning({ id: metadataHttpProviders.id });
    return updated.length > 0;
  }

  /**
   * Removes a provider and, with `purgeKey`, everything BookOrbit kept under its key, in one
   * transaction, so a failed purge leaves the provider in place to try again. Without a purge the
   * data stays, so re-adding the provider restores it.
   */
  async delete(id: number, purgeKey: string | null): Promise<PurgeCounts | null> {
    return this.db.transaction(async (tx) => {
      await tx.delete(metadataHttpProviders).where(eq(metadataHttpProviders.id, id));
      if (!purgeKey) return null;
      const ids = await tx.delete(bookProviderIds).where(eq(bookProviderIds.provider, purgeKey)).returning({ bookId: bookProviderIds.bookId });
      const ratings = await tx
        .delete(bookCommunityRatings)
        .where(eq(bookCommunityRatings.provider, purgeKey))
        .returning({ bookId: bookCommunityRatings.bookId });
      const cache = await tx
        .delete(providerMetadataCache)
        .where(and(eq(providerMetadataCache.namespace, 'book'), eq(providerMetadataCache.provider, purgeKey)))
        .returning({ id: providerMetadataCache.id });
      return { providerIds: ids.length, ratings: ratings.length, cacheEntries: cache.length };
    });
  }
}
