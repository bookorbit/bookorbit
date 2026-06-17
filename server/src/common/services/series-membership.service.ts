import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, bookSeries, bookSeriesMemberships, books } from '../../db/schema';
import { SeriesIdentityService } from './series-identity.service';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type SeriesMembershipExecutor = Pick<Db, 'delete' | 'insert' | 'select' | 'update'> | DbTransaction;
type SeriesMembershipReadExecutor = Pick<Db, 'select'> | DbTransaction;

export type SeriesMembershipInput = {
  seriesName: string | null;
  seriesIndex?: number | null;
};

export type SeriesMembershipRef = {
  seriesId: number;
  seriesName: string;
  seriesIndex: number | null;
  displayOrder: number;
};

@Injectable()
export class SeriesMembershipService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly seriesIdentity: SeriesIdentityService,
  ) {}

  async replaceForBook(
    bookId: number,
    memberships: readonly SeriesMembershipInput[] | null | undefined,
    executor: SeriesMembershipExecutor = this.db,
  ): Promise<SeriesMembershipRef[]> {
    const normalized = await this.normalizeMemberships(memberships ?? [], executor);

    await executor.delete(bookSeriesMemberships).where(eq(bookSeriesMemberships.bookId, bookId));

    if (normalized.length > 0) {
      await executor.insert(bookSeriesMemberships).values(
        normalized.map((membership) => ({
          bookId,
          seriesId: membership.seriesId,
          seriesIndex: membership.seriesIndex,
          displayOrder: membership.displayOrder,
        })),
      );
    }

    await this.syncPrimaryMetadata(bookId, normalized, executor);
    return normalized;
  }

  async syncPrimaryFromMetadata(bookId: number, executor: SeriesMembershipExecutor = this.db): Promise<SeriesMembershipRef[]> {
    const [metadata] = await executor
      .select({
        seriesId: bookMetadata.seriesId,
        seriesName: bookMetadata.seriesName,
        seriesIndex: bookMetadata.seriesIndex,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    const current = await this.findByBookId(bookId, executor);
    const rest = current.filter((membership) => membership.displayOrder !== 0);
    const displayName = this.seriesIdentity.normalizeDisplayName(metadata?.seriesName);

    if (!displayName) {
      return this.replaceForBook(
        bookId,
        rest.map((membership) => ({ seriesName: membership.seriesName, seriesIndex: membership.seriesIndex })),
        executor,
      );
    }

    return this.replaceForBook(
      bookId,
      [
        { seriesName: displayName, seriesIndex: metadata?.seriesIndex ?? null },
        ...rest.map((membership) => ({ seriesName: membership.seriesName, seriesIndex: membership.seriesIndex })),
      ],
      executor,
    );
  }

  async syncPrimaryFromMetadataForBooks(bookIds: number[], executor: SeriesMembershipExecutor = this.db): Promise<void> {
    for (const bookId of bookIds) {
      await this.syncPrimaryFromMetadata(bookId, executor);
    }
  }

  async findByBookId(bookId: number, executor: SeriesMembershipReadExecutor = this.db): Promise<SeriesMembershipRef[]> {
    const map = await this.findByBookIds([bookId], executor);
    return map.get(bookId) ?? [];
  }

  async findByBookIds(bookIds: number[], executor: SeriesMembershipReadExecutor = this.db): Promise<Map<number, SeriesMembershipRef[]>> {
    const result = new Map<number, SeriesMembershipRef[]>();
    if (bookIds.length === 0) return result;

    const rows = await executor
      .select({
        bookId: bookSeriesMemberships.bookId,
        seriesId: bookSeriesMemberships.seriesId,
        seriesName: bookSeries.name,
        seriesIndex: bookSeriesMemberships.seriesIndex,
        displayOrder: bookSeriesMemberships.displayOrder,
      })
      .from(bookSeriesMemberships)
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .where(inArray(bookSeriesMemberships.bookId, bookIds))
      .orderBy(asc(bookSeriesMemberships.bookId), asc(bookSeriesMemberships.displayOrder), asc(bookSeriesMemberships.seriesId));

    for (const row of rows) {
      const list = result.get(row.bookId) ?? [];
      list.push({
        seriesId: row.seriesId,
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        displayOrder: row.displayOrder,
      });
      result.set(row.bookId, list);
    }

    return result;
  }

  async backfillFromMetadata(executor: Pick<Db, 'execute'> = this.db): Promise<void> {
    await executor.execute(sql`
      INSERT INTO ${bookSeriesMemberships} (book_id, series_id, series_index, display_order)
      SELECT ${bookMetadata.bookId}, ${bookMetadata.seriesId}, ${bookMetadata.seriesIndex}, 0
      FROM ${bookMetadata}
      WHERE ${bookMetadata.seriesId} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ${bookSeriesMemberships}
          WHERE ${bookSeriesMemberships.bookId} = ${bookMetadata.bookId}
        )
      ON CONFLICT DO NOTHING
    `);
  }

  async syncPrimaryMetadata(
    bookId: number,
    memberships: readonly SeriesMembershipRef[],
    executor: SeriesMembershipExecutor = this.db,
  ): Promise<void> {
    const primary = memberships[0] ?? null;
    await executor
      .update(bookMetadata)
      .set({
        seriesId: primary?.seriesId ?? null,
        seriesName: primary?.seriesName ?? null,
        seriesIndex: primary?.seriesIndex ?? null,
        updatedAt: new Date(),
      })
      .where(eq(bookMetadata.bookId, bookId));
    await executor.update(books).set({ updatedAt: new Date() }).where(eq(books.id, bookId));
  }

  private async normalizeMemberships(
    memberships: readonly SeriesMembershipInput[],
    executor: Pick<Db, 'insert'> | DbTransaction,
  ): Promise<SeriesMembershipRef[]> {
    const normalized: SeriesMembershipRef[] = [];
    const seen = new Set<string>();

    for (const membership of memberships) {
      const displayName = this.seriesIdentity.normalizeDisplayName(membership.seriesName);
      const normalizedName = this.seriesIdentity.normalizeName(displayName);
      if (!displayName || !normalizedName || seen.has(normalizedName)) continue;

      const seriesId = await this.seriesIdentity.resolveSeriesId(displayName, executor);
      if (seriesId == null) continue;

      seen.add(normalizedName);
      normalized.push({
        seriesId,
        seriesName: displayName,
        seriesIndex: membership.seriesIndex ?? null,
        displayOrder: normalized.length,
      });
    }

    return normalized;
  }
}
