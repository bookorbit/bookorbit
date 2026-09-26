import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, inArray, ne, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { APP_FEATURES, type MediaType } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { smartScopeKoboSubscriptions, smartScopes } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type SmartScopeDisplayOrderUpdate = { id: number; displayOrder: number };

const visibleSmartScopeCondition = APP_FEATURES.podcasts ? undefined : eq(smartScopes.mediaType, 'books');

@Injectable()
export class SmartScopeRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select()
      .from(smartScopes)
      .where(and(or(eq(smartScopes.userId, userId), eq(smartScopes.isPublic, true)), visibleSmartScopeCondition))
      .orderBy(smartScopes.displayOrder, smartScopes.name);
  }

  findById(id: number) {
    return this.db
      .select()
      .from(smartScopes)
      .where(and(eq(smartScopes.id, id), visibleSmartScopeCondition))
      .limit(1);
  }

  insert(values: typeof smartScopes.$inferInsert) {
    return this.db.insert(smartScopes).values(values).returning();
  }

  /** Only the user's own scopes count towards their cap; a public scope someone else owns is not theirs to bound. */
  async countOwnedByMediaType(userId: number, mediaType: MediaType): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(smartScopes)
      .where(and(eq(smartScopes.userId, userId), eq(smartScopes.mediaType, mediaType)));
    return Number(row?.count ?? 0);
  }

  update(id: number, userId: number, values: Partial<typeof smartScopes.$inferInsert>) {
    return this.db
      .update(smartScopes)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(smartScopes.id, id), eq(smartScopes.userId, userId), visibleSmartScopeCondition))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(smartScopes)
      .where(and(eq(smartScopes.id, id), eq(smartScopes.userId, userId), visibleSmartScopeCondition))
      .returning();
  }

  private koboSubscriptionExists(userId: number) {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(smartScopeKoboSubscriptions)
        .where(and(eq(smartScopeKoboSubscriptions.smartScopeId, smartScopes.id), eq(smartScopeKoboSubscriptions.userId, userId))),
    );
  }

  /**
   * Scopes that must reach this user's Kobo: their own scopes with the flag set,
   * plus shared scopes they opted into. A scope the owner unshares drops out even
   * if the subscription row survives.
   *
   * Book scopes only. A Kobo holds no podcasts, and a podcast scope's rules would
   * reach the book query builder, which cannot read them.
   */
  findKoboSyncScopesForUser(userId: number) {
    return this.db
      .select()
      .from(smartScopes)
      .where(
        and(
          eq(smartScopes.mediaType, 'books'),
          or(
            and(eq(smartScopes.userId, userId), eq(smartScopes.syncToKobo, true)),
            and(ne(smartScopes.userId, userId), eq(smartScopes.isPublic, true), this.koboSubscriptionExists(userId)),
          ),
        ),
      );
  }

  async findKoboSubscribedScopeIds(userId: number, smartScopeIds: number[]): Promise<number[]> {
    if (smartScopeIds.length === 0) return [];
    const rows = await this.db
      .select({ smartScopeId: smartScopeKoboSubscriptions.smartScopeId })
      .from(smartScopeKoboSubscriptions)
      .where(and(eq(smartScopeKoboSubscriptions.userId, userId), inArray(smartScopeKoboSubscriptions.smartScopeId, smartScopeIds)));
    return rows.map((row) => row.smartScopeId);
  }

  async subscribeToKobo(userId: number, smartScopeId: number): Promise<void> {
    await this.db.insert(smartScopeKoboSubscriptions).values({ userId, smartScopeId }).onConflictDoNothing();
  }

  async unsubscribeFromKobo(userId: number, smartScopeId: number): Promise<void> {
    await this.db
      .delete(smartScopeKoboSubscriptions)
      .where(and(eq(smartScopeKoboSubscriptions.userId, userId), eq(smartScopeKoboSubscriptions.smartScopeId, smartScopeId)));
  }

  updateDisplayOrders(userId: number, order: SmartScopeDisplayOrderUpdate[]): Promise<number> {
    return this.db.transaction(async (tx) => {
      let updatedCount = 0;
      for (const item of order) {
        const updatedRows = await tx
          .update(smartScopes)
          .set({ displayOrder: item.displayOrder, updatedAt: sql`now()` })
          .where(and(eq(smartScopes.id, item.id), eq(smartScopes.userId, userId), visibleSmartScopeCondition))
          .returning({ id: smartScopes.id });
        updatedCount += updatedRows.length;
      }
      return updatedCount;
    });
  }
}
