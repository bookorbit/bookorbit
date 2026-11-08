import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, desc, eq, gt, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

const keys = schema.apiKeys;
const creator = aliasedTable(schema.users, 'api_key_creator');

/** Library ids still attached to the key. A deleted library drops out on its own (cascade). */
const libraryIdsColumn = sql<number[]>`coalesce(
  (select array_agg(${schema.apiKeyLibraries.libraryId} order by ${schema.apiKeyLibraries.libraryId})
   from ${schema.apiKeyLibraries} where ${schema.apiKeyLibraries.apiKeyId} = ${keys.id}),
  '{}'::int[]
)`;

const recordColumns = {
  id: keys.id,
  userId: keys.userId,
  createdBy: keys.createdBy,
  createdByUsername: creator.username,
  name: keys.name,
  tokenHint: keys.tokenHint,
  audience: keys.audience,
  access: keys.access,
  permissions: keys.permissions,
  admin: keys.admin,
  libraryLimited: keys.libraryLimited,
  libraryIds: libraryIdsColumn,
  expiresAt: keys.expiresAt,
  lastUsedAt: keys.lastUsedAt,
  lastUsedIp: keys.lastUsedIp,
  createdAt: keys.createdAt,
  revokedAt: keys.revokedAt,
};

export interface ApiKeyRecord {
  id: number;
  userId: number;
  createdBy: number | null;
  createdByUsername: string | null;
  name: string;
  tokenHint: string;
  audience: string;
  access: string;
  permissions: string[];
  admin: boolean;
  libraryLimited: boolean;
  libraryIds: number[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export type NewApiKey = Omit<typeof keys.$inferInsert, 'id' | 'createdAt' | 'revokedAt' | 'lastUsedAt' | 'lastUsedIp'>;

export type InsertApiKeyResult = { status: 'created'; id: number } | { status: 'limit_reached' } | { status: 'replaced_missing' };

const LAST_USED_DEBOUNCE = sql`interval '1 minute'`;

function activeCondition(): SQL {
  return and(isNull(keys.revokedAt), or(isNull(keys.expiresAt), gt(keys.expiresAt, sql`now()`)))!;
}

@Injectable()
export class ApiKeyRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Inserts a key, optionally revoking the key it replaces, in one transaction. The owner's row is
   * locked first so two concurrent creations cannot both slip under the active-key limit.
   */
  async insert(row: NewApiKey, libraryIds: readonly number[] | null, maxActive: number, replacesId?: number): Promise<InsertApiKeyResult> {
    return this.db.transaction(async (tx) => {
      await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, row.userId)).for('update');

      const [{ active }] = await tx
        .select({ active: sql<number>`count(*)::int` })
        .from(keys)
        .where(and(eq(keys.userId, row.userId), activeCondition(), replacesId === undefined ? undefined : ne(keys.id, replacesId)));
      if (active >= maxActive) return { status: 'limit_reached' as const };

      if (replacesId !== undefined) {
        const revoked = await tx
          .update(keys)
          .set({ revokedAt: new Date() })
          .where(and(eq(keys.id, replacesId), eq(keys.userId, row.userId), isNull(keys.revokedAt)))
          .returning({ id: keys.id });
        if (revoked.length === 0) return { status: 'replaced_missing' as const };
      }

      const [created] = await tx
        .insert(keys)
        .values({ ...row, libraryLimited: libraryIds !== null })
        .returning({ id: keys.id });
      if (libraryIds?.length) {
        await tx.insert(schema.apiKeyLibraries).values(libraryIds.map((libraryId) => ({ apiKeyId: created.id, libraryId })));
      }
      return { status: 'created' as const, id: created.id };
    });
  }

  /** The key a presented token belongs to, whatever its state, so the caller can say why it is refused. */
  async findByHash(tokenHash: string): Promise<ApiKeyRecord | null> {
    const [row] = await this.db
      .select(recordColumns)
      .from(keys)
      .leftJoin(creator, eq(creator.id, keys.createdBy))
      .where(eq(keys.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async findOwned(userId: number, keyId: number): Promise<ApiKeyRecord | null> {
    const [row] = await this.db
      .select(recordColumns)
      .from(keys)
      .leftJoin(creator, eq(creator.id, keys.createdBy))
      .where(and(eq(keys.id, keyId), eq(keys.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Live keys plus those revoked since `revokedSince`, newest first. */
  listByUser(userId: number, revokedSince: Date, limit: number): Promise<ApiKeyRecord[]> {
    return this.db
      .select(recordColumns)
      .from(keys)
      .leftJoin(creator, eq(creator.id, keys.createdBy))
      .where(and(eq(keys.userId, userId), or(isNull(keys.revokedAt), gt(keys.revokedAt, revokedSince))))
      .orderBy(desc(keys.createdAt), desc(keys.id))
      .limit(limit);
  }

  async rename(userId: number, keyId: number, name: string): Promise<boolean> {
    const rows = await this.db
      .update(keys)
      .set({ name })
      .where(and(eq(keys.id, keyId), eq(keys.userId, userId), isNull(keys.revokedAt)))
      .returning({ id: keys.id });
    return rows.length > 0;
  }

  async revoke(userId: number, keyId: number): Promise<boolean> {
    const rows = await this.db
      .update(keys)
      .set({ revokedAt: new Date() })
      .where(and(eq(keys.id, keyId), eq(keys.userId, userId), isNull(keys.revokedAt)))
      .returning({ id: keys.id });
    return rows.length > 0;
  }

  async revokeAllByUser(userId: number): Promise<number> {
    const rows = await this.db
      .update(keys)
      .set({ revokedAt: new Date() })
      .where(and(eq(keys.userId, userId), isNull(keys.revokedAt)))
      .returning({ id: keys.id });
    return rows.length;
  }

  /** At most one write a minute per key, however busy it is. */
  async touchLastUsed(keyId: number, ip: string | null): Promise<void> {
    await this.db
      .update(keys)
      .set({ lastUsedAt: sql`now()`, lastUsedIp: ip })
      .where(and(eq(keys.id, keyId), or(isNull(keys.lastUsedAt), lt(keys.lastUsedAt, sql`now() - ${LAST_USED_DEBOUNCE}`))));
  }

  /** Deletes up to `batchSize` keys revoked or expired before `cutoff`. */
  async pruneBatch(cutoff: Date, batchSize: number): Promise<number> {
    const stale = this.db
      .select({ id: keys.id })
      .from(keys)
      .where(or(lt(keys.revokedAt, cutoff), lt(keys.expiresAt, cutoff)))
      .limit(batchSize);
    const rows = await this.db.delete(keys).where(inArray(keys.id, stale)).returning({ id: keys.id });
    return rows.length;
  }
}
