import { Injectable } from '@nestjs/common';
import type { MetadataCacheNamespace } from '@bookorbit/types';
import { and, eq, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';

import { providerMetadataCache, type NewProviderMetadataCacheRow, type ProviderMetadataCacheRow } from '../../db/schema';
import { SWEEP_LONG_STATEMENT_TIMEOUT_MS } from './metadata-cache.constants';
import { MetadataCacheDb } from './metadata-cache.db';

export interface DeletedBatch {
  count: number;
  bytes: number;
}

export interface CacheTableStats {
  entries: number;
  payloadBytes: number;
  relationBytes: number;
  oldestFetchedAt: Date | null;
  providers: { namespace: MetadataCacheNamespace; provider: string; entries: number; emptyEntries: number; payloadBytes: number }[];
}

const t = providerMetadataCache;

@Injectable()
export class MetadataCacheRepository {
  constructor(private readonly cacheDb: MetadataCacheDb) {}

  private get db() {
    return this.cacheDb.db;
  }

  async find(keyHash: string): Promise<ProviderMetadataCacheRow | null> {
    const rows = await this.db.select().from(t).where(eq(t.keyHash, keyHash)).limit(1);
    return rows[0] ?? null;
  }

  /** Newest fetch wins; an older answer never replaces a newer one, and on a tie the later write wins. */
  /** Stores the row unless a newer answer is already there, and returns how many bytes storage grew by. */
  async upsert(row: NewProviderMetadataCacheRow): Promise<number> {
    const update: Partial<NewProviderMetadataCacheRow> = { ...row };
    delete update.keyHash;
    delete update.id;
    const written = await this.db
      .insert(t)
      .values(row)
      .onConflictDoUpdate({ target: t.keyHash, set: update, setWhere: lte(t.fetchedAt, row.fetchedAt) })
      // A subquery in RETURNING reads the statement's snapshot, so it sees the row this replaced.
      .returning({
        previousBytes: sql<number | null>`(select previous.payload_bytes from ${t} as previous where previous.key_hash = ${row.keyHash})`,
      });
    if (written.length === 0) return 0;
    return row.payloadBytes - (written[0].previousBytes ?? 0);
  }

  async delete(keyHash: string): Promise<void> {
    await this.db.delete(t).where(eq(t.keyHash, keyHash));
  }

  async touch(keyHashes: readonly string[], now: Date, staleBefore: Date): Promise<void> {
    if (keyHashes.length === 0) return;
    await this.db
      .update(t)
      .set({ lastAccessedAt: now })
      .where(and(inArray(t.keyHash, [...keyHashes]), lt(t.lastAccessedAt, staleBefore)));
  }

  async deleteBatch(where: SQL, limit: number): Promise<DeletedBatch> {
    return this.runLong(async (tx) => {
      const result = await tx.execute<{ payload_bytes: number }>(sql`
        DELETE FROM ${t} WHERE ${t.id} IN (SELECT ${t.id} FROM ${t} WHERE ${where} LIMIT ${limit})
        RETURNING ${t.payloadBytes}
      `);
      return sumDeleted(result.rows);
    });
  }

  async deleteLeastRecentlyAccessed(limit: number): Promise<DeletedBatch> {
    return this.runLong(async (tx) => {
      const result = await tx.execute<{ payload_bytes: number }>(sql`
        DELETE FROM ${t} WHERE ${t.id} IN (SELECT ${t.id} FROM ${t} ORDER BY ${t.lastAccessedAt} ASC LIMIT ${limit})
        RETURNING ${t.payloadBytes}
      `);
      return sumDeleted(result.rows);
    });
  }

  async count(where?: SQL): Promise<number> {
    return this.runLong(async (tx) => {
      const rows = await tx
        .select({ n: sql<string>`count(*)` })
        .from(t)
        .where(where);
      return Number(rows[0]?.n ?? 0);
    });
  }

  async truncate(): Promise<void> {
    await this.runLong((tx) => tx.execute(sql`TRUNCATE TABLE ${t}`));
  }

  async sumPayloadBytes(): Promise<number> {
    return this.runLong(async (tx) => {
      const rows = await tx.select({ bytes: sql<string>`coalesce(sum(${t.payloadBytes}), 0)` }).from(t);
      return Number(rows[0]?.bytes ?? 0);
    });
  }

  async stats(): Promise<CacheTableStats> {
    return this.runLong(async (tx) => {
      const providers = await tx
        .select({
          namespace: t.namespace,
          provider: t.provider,
          entries: sql<string>`count(*)`,
          emptyEntries: sql<string>`count(*) filter (where ${t.status} in ('empty', 'not_found'))`,
          payloadBytes: sql<string>`coalesce(sum(${t.payloadBytes}), 0)`,
          oldest: sql<Date | null>`min(${t.fetchedAt})`,
        })
        .from(t)
        .groupBy(t.namespace, t.provider);
      const size = await tx.execute<{ bytes: string }>(sql`select pg_total_relation_size(${'provider_metadata_cache'}::regclass) as bytes`);
      let oldest: Date | null = null;
      for (const row of providers) {
        const value = row.oldest ? new Date(row.oldest) : null;
        if (value && (!oldest || value < oldest)) oldest = value;
      }
      const mapped = providers.map((row) => ({
        namespace: row.namespace as MetadataCacheNamespace,
        provider: row.provider,
        entries: Number(row.entries),
        emptyEntries: Number(row.emptyEntries),
        payloadBytes: Number(row.payloadBytes),
      }));
      return {
        entries: mapped.reduce((sum, row) => sum + row.entries, 0),
        payloadBytes: mapped.reduce((sum, row) => sum + row.payloadBytes, 0),
        relationBytes: Number(size.rows[0]?.bytes ?? 0),
        oldestFetchedAt: oldest,
        providers: mapped,
      };
    });
  }

  /** Maintenance statements run with a longer timeout than the pool's per-read default. */
  private runLong<T>(fn: (tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${SWEEP_LONG_STATEMENT_TIMEOUT_MS}`));
      return fn(tx);
    });
  }
}

function sumDeleted(rows: readonly { payload_bytes: number }[]): DeletedBatch {
  return { count: rows.length, bytes: rows.reduce((sum, row) => sum + Number(row.payload_bytes ?? 0), 0) };
}
