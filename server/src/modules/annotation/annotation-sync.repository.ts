import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, getTableColumns, inArray, isNotNull, isNull, notExists, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  annotationPositions,
  annotationSyncState,
  annotations,
  AnnotationPosition,
  AnnotationRow,
  AnnotationSyncStateRow,
  NewAnnotation,
  NewAnnotationPosition,
  NewAnnotationSyncState,
} from '../../db/schema';
import type { AnnotationPositionFormat, AnnotationSyncSource } from './annotation.constants';

type Db = NodePgDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Executor = Db | DbTx;

export interface CanonicalWithPosition {
  annotation: AnnotationRow;
  position: AnnotationPosition | null;
}

@Injectable()
export class AnnotationSyncRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async findStateByDeviceKey(
    userId: number,
    source: AnnotationSyncSource,
    deviceId: string,
    bookId: number,
    externalKey: string,
    ex: Executor = this.db,
  ): Promise<AnnotationSyncStateRow | null> {
    const [row] = await ex
      .select({ state: annotationSyncState })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(
        and(
          eq(annotationSyncState.userId, userId),
          eq(annotationSyncState.source, source),
          eq(annotationSyncState.deviceId, deviceId),
          eq(annotationSyncState.externalKey, externalKey),
          eq(annotations.bookId, bookId),
        ),
      )
      .limit(1);
    return row?.state ?? null;
  }

  async findStateByKeyAnyDevice(
    userId: number,
    source: AnnotationSyncSource,
    externalKey: string,
    bookId: number,
    ex: Executor = this.db,
  ): Promise<{ state: AnnotationSyncStateRow; annotation: AnnotationRow } | null> {
    const [row] = await ex
      .select({ state: annotationSyncState, annotation: annotations })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(
        and(
          eq(annotationSyncState.userId, userId),
          eq(annotationSyncState.source, source),
          eq(annotationSyncState.externalKey, externalKey),
          eq(annotations.bookId, bookId),
        ),
      )
      .orderBy(asc(annotationSyncState.id))
      .limit(1);
    return row ?? null;
  }

  async findAnnotationById(annotationId: number, userId: number, ex: Executor = this.db): Promise<AnnotationRow | null> {
    const [row] = await ex
      .select()
      .from(annotations)
      .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findDevicePosition(annotationId: number, format: AnnotationPositionFormat, ex: Executor = this.db): Promise<AnnotationPosition | null> {
    const [row] = await ex
      .select()
      .from(annotationPositions)
      .where(and(eq(annotationPositions.annotationId, annotationId), eq(annotationPositions.format, format)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Canonical annotations carrying the given device-creation datetime, with their
   * device-format position. Matches both koreader-origin rows (datetime from the device)
   * and web-origin rows whose datetime was minted for device push.
   */
  async findCanonicalByDeviceDatetime(
    userId: number,
    bookId: number,
    datetime: string,
    format: AnnotationPositionFormat,
    ex: Executor = this.db,
  ): Promise<CanonicalWithPosition[]> {
    const rows = await ex
      .select({ annotation: annotations, position: annotationPositions })
      .from(annotations)
      .leftJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, format)))
      .where(and(eq(annotations.userId, userId), eq(annotations.bookId, bookId), eq(annotations.deviceCreatedAt, datetime)));
    return rows;
  }

  async insertState(state: NewAnnotationSyncState, ex: Executor = this.db): Promise<AnnotationSyncStateRow> {
    const [row] = await ex
      .insert(annotationSyncState)
      .values(state)
      .onConflictDoUpdate({
        target: [annotationSyncState.annotationId, annotationSyncState.source, annotationSyncState.deviceId],
        set: {
          externalKey: sql`excluded.external_key`,
          externalCreatedAt: sql`excluded.external_created_at`,
          lastAppliedVersion: sql`excluded.last_applied_version`,
          deleteAckedAt: sql`excluded.delete_acked_at`,
          lastSyncedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async updateState(
    stateId: number,
    patch: Partial<Pick<AnnotationSyncStateRow, 'externalKey' | 'externalCreatedAt' | 'lastAppliedVersion' | 'deleteAckedAt'>>,
    ex: Executor = this.db,
  ): Promise<void> {
    await ex
      .update(annotationSyncState)
      .set({ ...patch, lastSyncedAt: sql`now()` })
      .where(eq(annotationSyncState.id, stateId));
  }

  async touchState(stateId: number, ex: Executor = this.db): Promise<void> {
    await ex
      .update(annotationSyncState)
      .set({ lastSyncedAt: sql`now()` })
      .where(eq(annotationSyncState.id, stateId));
  }

  async createCanonical(
    annotation: NewAnnotation,
    position: Omit<NewAnnotationPosition, 'annotationId' | 'userId'>,
    state: Omit<NewAnnotationSyncState, 'annotationId' | 'userId'>,
    ex: Executor = this.db,
  ): Promise<AnnotationRow> {
    const [row] = await ex.insert(annotations).values(annotation).returning();
    await ex.insert(annotationPositions).values({ ...position, annotationId: row.id, userId: row.userId });
    await ex.insert(annotationSyncState).values({ ...state, annotationId: row.id, userId: row.userId });
    return row;
  }

  /** Applies a content patch and bumps the version; returns the new version. */
  async applyContentPatch(
    annotationId: number,
    patch: Partial<Pick<AnnotationRow, 'text' | 'note' | 'color' | 'style' | 'chapterTitle' | 'deviceUpdatedAt' | 'deviceCreatedAt'>>,
    ex: Executor = this.db,
  ): Promise<number> {
    const [row] = await ex
      .update(annotations)
      .set({ ...patch, version: sql`${annotations.version} + 1`, updatedAt: sql`now()` })
      .where(eq(annotations.id, annotationId))
      .returning({ version: annotations.version });
    return row.version;
  }

  async updatePosition(
    annotationId: number,
    format: AnnotationPositionFormat,
    patch: Partial<Pick<AnnotationPosition, 'pos0' | 'pos1' | 'status' | 'converterVersion' | 'extras' | 'bookFileId'>>,
    ex: Executor = this.db,
  ): Promise<void> {
    await ex
      .update(annotationPositions)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(and(eq(annotationPositions.annotationId, annotationId), eq(annotationPositions.format, format)));
  }

  async markPositionPending(annotationId: number, format: AnnotationPositionFormat, ex: Executor = this.db): Promise<void> {
    await ex
      .update(annotationPositions)
      .set({ status: 'pending', updatedAt: sql`now()` })
      .where(and(eq(annotationPositions.annotationId, annotationId), eq(annotationPositions.format, format)));
  }

  /** Unacked sync states for one device and book, used for device-deletion detection. */
  async findStatesForDeviceBook(
    userId: number,
    source: AnnotationSyncSource,
    deviceId: string,
    bookId: number,
    ex: Executor = this.db,
  ): Promise<{ state: AnnotationSyncStateRow; annotation: AnnotationRow }[]> {
    return ex
      .select({ state: annotationSyncState, annotation: annotations })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(
        and(
          eq(annotationSyncState.userId, userId),
          eq(annotationSyncState.source, source),
          eq(annotationSyncState.deviceId, deviceId),
          eq(annotations.bookId, bookId),
        ),
      );
  }

  /** Active annotations of the book with no sync state for this device (push-down adds). */
  async findAddCandidates(userId: number, source: AnnotationSyncSource, deviceId: string, bookId: number, limit: number): Promise<AnnotationRow[]> {
    return this.db
      .select(getTableColumns(annotations))
      .from(annotations)
      .where(
        and(
          eq(annotations.userId, userId),
          eq(annotations.bookId, bookId),
          isNull(annotations.deletedAt),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(annotationSyncState)
              .where(
                and(
                  eq(annotationSyncState.annotationId, annotations.id),
                  eq(annotationSyncState.source, source),
                  eq(annotationSyncState.deviceId, deviceId),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(annotations.id))
      .limit(limit);
  }

  /** Active annotations whose version is ahead of what this device acknowledged (edits). */
  async findEditCandidates(
    userId: number,
    source: AnnotationSyncSource,
    deviceId: string,
    bookId: number,
    limit: number,
  ): Promise<{ state: AnnotationSyncStateRow; annotation: AnnotationRow }[]> {
    return this.db
      .select({ state: annotationSyncState, annotation: annotations })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(
        and(
          eq(annotationSyncState.userId, userId),
          eq(annotationSyncState.source, source),
          eq(annotationSyncState.deviceId, deviceId),
          eq(annotations.bookId, bookId),
          isNull(annotations.deletedAt),
          sql`${annotations.version} > ${annotationSyncState.lastAppliedVersion}`,
        ),
      )
      .orderBy(asc(annotations.id))
      .limit(limit);
  }

  /** Soft-deleted annotations this device has not acknowledged deleting yet. */
  async findDeleteCandidates(
    userId: number,
    source: AnnotationSyncSource,
    deviceId: string,
    bookId: number,
    limit: number,
  ): Promise<{ state: AnnotationSyncStateRow; annotation: AnnotationRow }[]> {
    return this.db
      .select({ state: annotationSyncState, annotation: annotations })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(
        and(
          eq(annotationSyncState.userId, userId),
          eq(annotationSyncState.source, source),
          eq(annotationSyncState.deviceId, deviceId),
          eq(annotations.bookId, bookId),
          isNotNull(annotations.deletedAt),
          isNull(annotationSyncState.deleteAckedAt),
        ),
      )
      .orderBy(asc(annotations.id))
      .limit(limit);
  }

  async listDeviceCreatedAtsForBook(userId: number, bookId: number, ex: Executor = this.db): Promise<Set<string>> {
    const rows = await ex
      .select({ deviceCreatedAt: annotations.deviceCreatedAt })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), eq(annotations.bookId, bookId), isNotNull(annotations.deviceCreatedAt)));
    return new Set(rows.map((row) => row.deviceCreatedAt).filter((value): value is string => value != null));
  }

  /** Bookkeeping writes that must NOT bump the version (no device-visible change). */
  async setDeviceIdentitySilent(annotationId: number, deviceCreatedAt: string, ex: Executor = this.db): Promise<void> {
    await ex.update(annotations).set({ deviceCreatedAt }).where(eq(annotations.id, annotationId));
  }

  async setDeviceUpdatedAtSilent(annotationId: number, deviceUpdatedAt: string | null, ex: Executor = this.db): Promise<void> {
    await ex.update(annotations).set({ deviceUpdatedAt }).where(eq(annotations.id, annotationId));
  }

  async bumpVersion(annotationId: number, ex: Executor = this.db): Promise<number> {
    const [row] = await ex
      .update(annotations)
      .set({ version: sql`${annotations.version} + 1`, updatedAt: sql`now()` })
      .where(eq(annotations.id, annotationId))
      .returning({ version: annotations.version });
    return row.version;
  }

  async softDeleteById(annotationId: number, ex: Executor = this.db): Promise<void> {
    await ex
      .update(annotations)
      .set({ deletedAt: sql`now()`, version: sql`${annotations.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(annotations.id, annotationId), isNull(annotations.deletedAt)));
  }

  async setDeleteAcked(stateId: number, ex: Executor = this.db): Promise<void> {
    await ex
      .update(annotationSyncState)
      .set({ deleteAckedAt: sql`now()`, lastSyncedAt: sql`now()` })
      .where(eq(annotationSyncState.id, stateId));
  }

  async findStateByAnnotationAndDevice(
    annotationId: number,
    source: AnnotationSyncSource,
    deviceId: string,
    ex: Executor = this.db,
  ): Promise<AnnotationSyncStateRow | null> {
    const [row] = await ex
      .select()
      .from(annotationSyncState)
      .where(
        and(eq(annotationSyncState.annotationId, annotationId), eq(annotationSyncState.source, source), eq(annotationSyncState.deviceId, deviceId)),
      )
      .limit(1);
    return row ?? null;
  }

  async upsertPosition(position: NewAnnotationPosition, ex: Executor = this.db): Promise<void> {
    await ex
      .insert(annotationPositions)
      .values(position)
      .onConflictDoUpdate({
        target: [annotationPositions.annotationId, annotationPositions.format],
        set: {
          pos0: sql`excluded.pos0`,
          pos1: sql`excluded.pos1`,
          status: sql`excluded.status`,
          converterVersion: sql`excluded.converter_version`,
          extras: sql`excluded.extras`,
          bookFileId: sql`excluded.book_file_id`,
          updatedAt: new Date(),
        },
      });
  }

  async findPositionsByAnnotationIds(
    annotationIds: number[],
    formats: AnnotationPositionFormat[],
    ex: Executor = this.db,
  ): Promise<AnnotationPosition[]> {
    if (annotationIds.length === 0) return [];
    return ex
      .select()
      .from(annotationPositions)
      .where(and(inArray(annotationPositions.annotationId, annotationIds), inArray(annotationPositions.format, formats)));
  }

  async listDeviceAnnotationsByBook(
    userId: number,
    bookId: number,
    origin: AnnotationSyncSource,
    formats: AnnotationPositionFormat[],
    limit = 1000,
  ): Promise<{ annotation: AnnotationRow; position: AnnotationPosition }[]> {
    return this.db
      .select({ annotation: annotations, position: annotationPositions })
      .from(annotations)
      .innerJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), inArray(annotationPositions.format, formats)))
      .where(
        and(eq(annotations.userId, userId), eq(annotations.bookId, bookId), eq(annotations.origin, origin), sql`${annotations.deletedAt} is null`),
      )
      .orderBy(sql`(${annotationPositions.extras} ->> 'pageno')::int asc nulls last`, asc(annotations.deviceCreatedAt), asc(annotations.id))
      .limit(limit);
  }
}
