import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, bookSeries } from '../../db/schema';
import { sanitizeLogValue } from '../utils/log-sanitize.utils';

type Db = NodePgDatabase<typeof schema>;
type SeriesWriteExecutor = Pick<Db, 'insert'>;

@Injectable()
export class SeriesIdentityService implements OnModuleInit {
  private readonly logger = new Logger(SeriesIdentityService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    const start = Date.now();
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = 0`);
        await this.backfillMissingSeriesIds(tx);
      });
      this.logger.log(`[series.backfill] [end] durationMs=${Date.now() - start} - series id backfill completed`);
    } catch (err) {
      const e = err as Error & { cause?: unknown };
      const cause = e.cause instanceof Error ? e.cause.message : e.message;
      this.logger.error(
        `[series.backfill] [fail] durationMs=${Date.now() - start} errorClass=${e.name} error="${sanitizeLogValue(cause)}" - series id backfill failed; continuing startup`,
      );
    }
  }

  normalizeName(name: string | null | undefined): string | null {
    const trimmed = name?.trim();
    return trimmed ? trimmed.toLowerCase() : null;
  }

  normalizeDisplayName(name: string | null | undefined): string | null {
    const trimmed = name?.trim();
    return trimmed || null;
  }

  async resolveSeriesId(name: string | null | undefined, executor: SeriesWriteExecutor = this.db): Promise<number | null> {
    const displayName = this.normalizeDisplayName(name);
    const normalizedName = this.normalizeName(displayName);
    if (!displayName || !normalizedName) return null;

    const [row] = await executor
      .insert(bookSeries)
      .values({ name: displayName, normalizedName })
      .onConflictDoUpdate({
        target: bookSeries.normalizedName,
        set: { updatedAt: new Date() },
      })
      .returning({ id: bookSeries.id });

    return row?.id ?? null;
  }

  async resolveMetadataPatch<T extends Partial<typeof bookMetadata.$inferInsert>>(fields: T, executor: SeriesWriteExecutor = this.db): Promise<T> {
    if (!Object.prototype.hasOwnProperty.call(fields, 'seriesName') || fields.seriesName === undefined) {
      return fields;
    }

    const displayName = this.normalizeDisplayName(fields.seriesName);
    const seriesId = await this.resolveSeriesId(displayName, executor);
    return { ...fields, seriesName: displayName, seriesId };
  }

  async backfillMissingSeriesIds(executor: Pick<Db, 'execute'> = this.db): Promise<void> {
    await executor.execute(sql`
      INSERT INTO book_series (name, normalized_name)
      SELECT min(btrim(${bookMetadata.seriesName})), lower(btrim(${bookMetadata.seriesName}))
      FROM ${bookMetadata}
      WHERE ${bookMetadata.seriesName} IS NOT NULL
        AND btrim(${bookMetadata.seriesName}) != ''
      GROUP BY lower(btrim(${bookMetadata.seriesName}))
      ON CONFLICT (normalized_name)
      DO NOTHING
    `);

    await executor.execute(sql`
      UPDATE ${bookMetadata}
      SET series_id = ${bookSeries.id}
      FROM ${bookSeries}
      WHERE ${bookMetadata.seriesName} IS NOT NULL
        AND btrim(${bookMetadata.seriesName}) != ''
        AND lower(btrim(${bookMetadata.seriesName})) = ${bookSeries.normalizedName}
        AND (${bookMetadata.seriesId} IS NULL OR ${bookMetadata.seriesId} != ${bookSeries.id})
    `);

    await executor.execute(sql`
      UPDATE ${bookMetadata}
      SET series_id = NULL
      WHERE (${bookMetadata.seriesName} IS NULL OR btrim(${bookMetadata.seriesName}) = '')
        AND ${bookMetadata.seriesId} IS NOT NULL
    `);
  }

  async findIdByName(name: string, executor: Pick<Db, 'select'> = this.db): Promise<number | null> {
    const normalizedName = this.normalizeName(name);
    if (!normalizedName) return null;
    const [row] = await executor.select({ id: bookSeries.id }).from(bookSeries).where(eq(bookSeries.normalizedName, normalizedName)).limit(1);
    return row?.id ?? null;
  }
}
