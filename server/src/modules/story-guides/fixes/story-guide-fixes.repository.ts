import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { StoryGuideFixTarget } from '@bookorbit/types';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { storyGuideFixes, type StoryGuideFixRow } from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * An arbitrary but stable namespace for the per-text advisory lock every write takes, so it cannot
 * collide with a lock any other feature takes.
 */
export const STORY_GUIDE_FIXES_WRITE_LOCK_NAMESPACE = 248_018;

const NEXT_REVISION = sql`nextval(pg_get_serial_sequence('story_guide_fixes', 'revision'))`;

export interface StoryGuideFixWrite {
  textKey: string;
  id: string;
  kind: string;
  target: StoryGuideFixTarget;
  data: Record<string, unknown>;
  from: { s: number; o: number } | null;
  clientUpdatedAt: Date;
  deleted: boolean;
  userId: number;
}

/** `kept` when the stored row is newer than the write, `refused` when a new live row would pass the cap. */
export type StoryGuideFixWriteOutcome = { outcome: 'written' | 'kept'; row: StoryGuideFixRow } | { outcome: 'refused' };

/** A text's fixes as a whole: the newest revision, tombstones included, and how many are live. */
export interface StoryGuideFixesState {
  revision: number;
  live: number;
}

/**
 * Every write to one text runs behind one advisory lock and draws its revision inside it. A
 * sequence alone hands out numbers in call order, not commit order: a reader could see revision 11
 * committed, move its cursor past it, and never see 10 once it commits.
 */
@Injectable()
export class StoryGuideFixesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  listSince(textKey: string, sinceRevision: number, limit: number): Promise<StoryGuideFixRow[]> {
    return this.db
      .select()
      .from(storyGuideFixes)
      .where(and(eq(storyGuideFixes.textKey, textKey), gt(storyGuideFixes.revision, sinceRevision)))
      .orderBy(asc(storyGuideFixes.revision))
      .limit(limit);
  }

  /** Live fixes in the order they were made, which is the order they are applied in. */
  listLive(textKey: string): Promise<StoryGuideFixRow[]> {
    return this.db
      .select()
      .from(storyGuideFixes)
      .where(and(eq(storyGuideFixes.textKey, textKey), eq(storyGuideFixes.deleted, false)))
      .orderBy(asc(storyGuideFixes.madeAt), asc(storyGuideFixes.createdAt), asc(storyGuideFixes.id));
  }

  async state(textKey: string): Promise<StoryGuideFixesState> {
    const [row] = await this.db
      .select({
        revision: sql<string | null>`max(${storyGuideFixes.revision})`,
        live: sql<number>`count(*) filter (where not ${storyGuideFixes.deleted})`.mapWith(Number),
      })
      .from(storyGuideFixes)
      .where(eq(storyGuideFixes.textKey, textKey));
    return { revision: Number(row?.revision ?? 0), live: row?.live ?? 0 };
  }

  async countLive(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(storyGuideFixes).where(eq(storyGuideFixes.deleted, false));
    return row?.value ?? 0;
  }

  /** Upsert on (text, id), last writer winning on the client's time. */
  async write(values: StoryGuideFixWrite, perTextMax: number): Promise<StoryGuideFixWriteOutcome> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, values.textKey);
      const identity = and(eq(storyGuideFixes.textKey, values.textKey), eq(storyGuideFixes.id, values.id));
      const [existing] = await tx.select().from(storyGuideFixes).where(identity).limit(1);
      if (existing && existing.clientUpdatedAt.getTime() > values.clientUpdatedAt.getTime()) return { outcome: 'kept', row: existing };

      const fields = {
        kind: values.kind,
        target: values.target,
        data: values.data,
        fromSection: values.from?.s ?? null,
        fromOffset: values.from?.o ?? null,
        clientUpdatedAt: values.clientUpdatedAt,
        deleted: values.deleted,
        updatedBy: values.userId,
      };

      if (existing) {
        const [row] = await tx
          .update(storyGuideFixes)
          .set({ ...fields, revision: NEXT_REVISION })
          .where(identity)
          .returning();
        return { outcome: 'written', row: row! };
      }

      if (!values.deleted) {
        const [live] = await tx
          .select({ value: count() })
          .from(storyGuideFixes)
          .where(and(eq(storyGuideFixes.textKey, values.textKey), eq(storyGuideFixes.deleted, false)));
        if ((live?.value ?? 0) >= perTextMax) return { outcome: 'refused' };
      }

      const [row] = await tx
        .insert(storyGuideFixes)
        .values({ textKey: values.textKey, id: values.id, madeAt: values.clientUpdatedAt, ...fields })
        .returning();
      return { outcome: 'written', row: row! };
    });
  }

  /** Turns a text's live fixes into tombstones, so every device learns of the delete. */
  async removeForText(textKey: string, userId: number | null): Promise<number> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, textKey);
      const rows = await tx
        .update(storyGuideFixes)
        .set({ deleted: true, revision: NEXT_REVISION, updatedBy: userId })
        .where(and(eq(storyGuideFixes.textKey, textKey), eq(storyGuideFixes.deleted, false)))
        .returning({ id: storyGuideFixes.id });
      return rows.length;
    });
  }

  /** Texts that have a live fix. */
  async textsWithLiveFixes(): Promise<string[]> {
    const rows = await this.db.selectDistinct({ textKey: storyGuideFixes.textKey }).from(storyGuideFixes).where(eq(storyGuideFixes.deleted, false));
    return rows.map((row) => row.textKey);
  }

  /**
   * Moves a text's fixes to the key its content has now, as when the text rules change. A fix whose
   * id the new key already holds stays behind.
   */
  async move(fromKey: string, toKey: string): Promise<number> {
    if (fromKey === toKey) return 0;
    return this.db.transaction(async (tx) => {
      // Both locks, always in the same order, so two moves cannot wait on each other.
      for (const key of [fromKey, toKey].sort()) await this.lock(tx, key);
      const taken = tx.select({ id: storyGuideFixes.id }).from(storyGuideFixes).where(eq(storyGuideFixes.textKey, toKey));
      const rows = await tx
        .update(storyGuideFixes)
        .set({ textKey: toKey, revision: NEXT_REVISION })
        .where(and(eq(storyGuideFixes.textKey, fromKey), notInArray(storyGuideFixes.id, taken)))
        .returning({ id: storyGuideFixes.id });
      return rows.length;
    });
  }

  /**
   * Removes tombstones last written before `before`, except each text's newest row, so a text's
   * revision never moves back and a tag it was served under never comes back meaning less.
   */
  async purgeTombstones(before: Date, limit: number): Promise<number> {
    const result = await this.db.execute(sql`
      delete from story_guide_fixes
      where (text_key, id) in (
        select stale.text_key, stale.id from story_guide_fixes stale
        where stale.deleted
          and stale.updated_at < ${before.toISOString()}
          and stale.revision < (select max(newest.revision) from story_guide_fixes newest where newest.text_key = stale.text_key)
        limit ${limit}
      )`);
    return result.rowCount ?? 0;
  }

  private async lock(tx: Tx, textKey: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${STORY_GUIDE_FIXES_WRITE_LOCK_NAMESPACE}, hashtext(${textKey}))`);
  }
}
