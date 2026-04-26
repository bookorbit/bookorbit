import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class MagicLinkRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async create(data: { userId: number; createdBy: number; label: string; expiresAt?: Date }) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    const [row] = await this.db
      .insert(schema.magicAccessTokens)
      .values({
        userId: data.userId,
        createdBy: data.createdBy,
        label: data.label,
        tokenHash,
        rawToken,
        expiresAt: data.expiresAt ?? null,
      })
      .returning({
        id: schema.magicAccessTokens.id,
        label: schema.magicAccessTokens.label,
        expiresAt: schema.magicAccessTokens.expiresAt,
        rawToken: schema.magicAccessTokens.rawToken,
      });

    return row;
  }

  async findByTokenHash(tokenHash: string) {
    return this.db.query.magicAccessTokens.findFirst({
      where: eq(schema.magicAccessTokens.tokenHash, tokenHash),
    });
  }

  async findAll() {
    const creator = alias(schema.users, 'creator');

    const rows = await this.db
      .select({
        id: schema.magicAccessTokens.id,
        userId: schema.magicAccessTokens.userId,
        username: schema.users.username,
        createdByUsername: creator.username,
        label: schema.magicAccessTokens.label,
        rawToken: schema.magicAccessTokens.rawToken,
        isActive: schema.magicAccessTokens.isActive,
        expiresAt: schema.magicAccessTokens.expiresAt,
        lastUsedAt: schema.magicAccessTokens.lastUsedAt,
        useCount: schema.magicAccessTokens.useCount,
        createdAt: schema.magicAccessTokens.createdAt,
        revokedAt: schema.magicAccessTokens.revokedAt,
      })
      .from(schema.magicAccessTokens)
      .innerJoin(schema.users, eq(schema.users.id, schema.magicAccessTokens.userId))
      .leftJoin(creator, eq(creator.id, schema.magicAccessTokens.createdBy))
      .orderBy(schema.magicAccessTokens.createdAt);

    return rows;
  }

  private activeCondition(userId: number) {
    return and(
      eq(schema.magicAccessTokens.userId, userId),
      isNull(schema.magicAccessTokens.revokedAt),
      eq(schema.magicAccessTokens.isActive, true),
      or(isNull(schema.magicAccessTokens.expiresAt), gt(schema.magicAccessTokens.expiresAt, sql`now()`)),
    );
  }

  async countActiveByUserId(userId: number): Promise<number> {
    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.magicAccessTokens)
      .where(this.activeCondition(userId));
    return total;
  }

  async hasActiveByUserId(userId: number): Promise<boolean> {
    const count = await this.countActiveByUserId(userId);
    return count > 0;
  }

  async setActive(id: number, isActive: boolean) {
    const [row] = await this.db.update(schema.magicAccessTokens).set({ isActive }).where(eq(schema.magicAccessTokens.id, id)).returning({
      id: schema.magicAccessTokens.id,
      userId: schema.magicAccessTokens.userId,
      isActive: schema.magicAccessTokens.isActive,
    });
    return row ?? null;
  }

  async revoke(id: number) {
    const [row] = await this.db.update(schema.magicAccessTokens).set({ revokedAt: new Date() }).where(eq(schema.magicAccessTokens.id, id)).returning({
      id: schema.magicAccessTokens.id,
      userId: schema.magicAccessTokens.userId,
    });
    return row ?? null;
  }

  async updateUsage(id: number) {
    await this.db
      .update(schema.magicAccessTokens)
      .set({
        lastUsedAt: new Date(),
        useCount: sql`${schema.magicAccessTokens.useCount} + 1`,
      })
      .where(eq(schema.magicAccessTokens.id, id));
  }

  async findById(id: number) {
    return this.db.query.magicAccessTokens.findFirst({
      where: eq(schema.magicAccessTokens.id, id),
    });
  }
}
