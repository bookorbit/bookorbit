import { Inject, Injectable } from '@nestjs/common';
import { type SeriesUnit, seriesUnitClass } from '@bookorbit/types';
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
  seriesIndex?: string | null;
  /** Omitted keeps the unit this book already has in that series; null clears it. */
  unit?: SeriesUnit | null;
  /** Omitted keeps the stored one. Only a chapter or issue keeps a volume index. */
  volumeIndex?: string | null;
};

export type SeriesMembershipRef = {
  seriesId: number;
  seriesName: string;
  seriesIndex: string | null;
  unit: SeriesUnit | null;
  volumeIndex: string | null;
  displayOrder: number;
  expectedBookCount: number | null;
};

type CurrentUnit = { unit: SeriesUnit | null; volumeIndex: string | null };
type CurrentUnits = { bySeries: Map<number, CurrentUnit>; primary: CurrentUnit | undefined };

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
    const inputs = memberships ?? [];
    const needsCurrent = inputs.some((membership) => membership.unit === undefined || membership.volumeIndex === undefined);
    const current = needsCurrent ? await this.findCurrentUnits(bookId, executor) : undefined;
    const normalized = await this.normalizeMemberships(inputs, executor, current);

    await executor.delete(bookSeriesMemberships).where(eq(bookSeriesMemberships.bookId, bookId));

    if (normalized.length > 0) {
      await executor.insert(bookSeriesMemberships).values(
        normalized.map((membership) => ({
          bookId,
          seriesId: membership.seriesId,
          seriesIndex: membership.seriesIndex,
          seriesUnit: membership.unit,
          seriesVolumeIndex: membership.volumeIndex,
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
        seriesUnit: bookMetadata.seriesUnit,
        seriesVolumeIndex: bookMetadata.seriesVolumeIndex,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    const current = await this.findByBookId(bookId, executor);
    const rest = current
      .filter((membership) => membership.displayOrder !== 0)
      .map((membership) => ({
        seriesName: membership.seriesName,
        seriesIndex: membership.seriesIndex,
        unit: membership.unit,
        volumeIndex: membership.volumeIndex,
      }));
    const displayName = this.seriesIdentity.normalizeDisplayName(metadata?.seriesName);

    if (!displayName) return this.replaceForBook(bookId, rest, executor);

    return this.replaceForBook(
      bookId,
      [
        {
          seriesName: displayName,
          seriesIndex: metadata?.seriesIndex ?? null,
          unit: metadata?.seriesUnit ?? null,
          volumeIndex: metadata?.seriesVolumeIndex ?? null,
        },
        ...rest,
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
        unit: bookSeriesMemberships.seriesUnit,
        volumeIndex: bookSeriesMemberships.seriesVolumeIndex,
        displayOrder: bookSeriesMemberships.displayOrder,
        expectedBookCount: bookSeries.expectedBookCount,
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
        unit: row.unit ?? null,
        volumeIndex: row.volumeIndex ?? null,
        displayOrder: row.displayOrder,
        expectedBookCount: row.expectedBookCount ?? null,
      });
      result.set(row.bookId, list);
    }

    return result;
  }

  async backfillFromMetadata(executor: Pick<Db, 'execute'> = this.db): Promise<void> {
    await executor.execute(sql`
      INSERT INTO ${bookSeriesMemberships} (book_id, series_id, series_index, series_unit, series_volume_index, display_order)
      SELECT ${bookMetadata.bookId}, ${bookMetadata.seriesId}, ${bookMetadata.seriesIndex}, ${bookMetadata.seriesUnit}, ${bookMetadata.seriesVolumeIndex}, 0
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
        seriesUnit: primary?.unit ?? null,
        seriesVolumeIndex: primary?.volumeIndex ?? null,
        updatedAt: new Date(),
      })
      .where(eq(bookMetadata.bookId, bookId));
    await executor.update(books).set({ updatedAt: new Date() }).where(eq(books.id, bookId));
  }

  private async findCurrentUnits(bookId: number, executor: SeriesMembershipReadExecutor): Promise<CurrentUnits> {
    const rows = await executor
      .select({
        seriesId: bookSeriesMemberships.seriesId,
        unit: bookSeriesMemberships.seriesUnit,
        volumeIndex: bookSeriesMemberships.seriesVolumeIndex,
        displayOrder: bookSeriesMemberships.displayOrder,
      })
      .from(bookSeriesMemberships)
      .where(eq(bookSeriesMemberships.bookId, bookId));
    const units = (row: (typeof rows)[number]): CurrentUnit => ({ unit: row.unit ?? null, volumeIndex: row.volumeIndex ?? null });
    const primary = rows.find((row) => row.displayOrder === 0);
    return { bySeries: new Map(rows.map((row) => [row.seriesId, units(row)])), primary: primary ? units(primary) : undefined };
  }

  private async normalizeMemberships(
    memberships: readonly SeriesMembershipInput[],
    executor: Pick<Db, 'insert'> | DbTransaction,
    current: CurrentUnits | undefined,
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
      // The unit describes the book's file, so a renamed primary series keeps the primary's unit.
      const kept = current?.bySeries.get(seriesId) ?? (normalized.length === 0 ? current?.primary : undefined);
      const unit = membership.unit !== undefined ? membership.unit : (kept?.unit ?? null);
      const volumeIndex = membership.volumeIndex !== undefined ? membership.volumeIndex : (kept?.volumeIndex ?? null);
      normalized.push({
        seriesId,
        seriesName: displayName,
        seriesIndex: membership.seriesIndex ?? null,
        unit,
        volumeIndex: seriesUnitClass(unit) === 'chapter' ? volumeIndex : null,
        displayOrder: normalized.length,
        expectedBookCount: null,
      });
    }

    return normalized;
  }
}
