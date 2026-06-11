import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, getTableColumns, inArray, isNotNull, isNull, notExists, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  annotationPositions,
  annotationSyncState,
  annotations,
  koboDevices,
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

  async findActiveByBook(userId: number, bookId: number, ex: Executor = this.db): Promise<AnnotationRow[]> {
    return ex
      .select()
      .from(annotations)
      .where(and(eq(annotations.userId, userId), eq(annotations.bookId, bookId), isNull(annotations.deletedAt)))
      .orderBy(asc(annotations.id));
  }

  async findStatesByAnnotation(annotationId: number, userId: number, ex: Executor = this.db): Promise<AnnotationSyncStateRow[]> {
    return ex
      .select()
      .from(annotationSyncState)
      .where(and(eq(annotationSyncState.annotationId, annotationId), eq(annotationSyncState.userId, userId)))
      .orderBy(asc(annotationSyncState.id));
  }

  /** Display names for kobo device ids (sync-state deviceId holds the numeric id as text). */
  async findKoboDeviceNames(deviceIds: number[], ex: Executor = this.db): Promise<Map<string, string>> {
    if (deviceIds.length === 0) return new Map();
    const rows = await ex.select({ id: koboDevices.id, name: koboDevices.name }).from(koboDevices).where(inArray(koboDevices.id, deviceIds));
    return new Map(rows.map((row) => [String(row.id), row.name]));
  }

  /** Earliest external key any device of the source holds for this annotation. */
  async findExternalKeyForAnnotation(annotationId: number, source: AnnotationSyncSource, ex: Executor = this.db): Promise<string | null> {
    const [row] = await ex
      .select({ externalKey: annotationSyncState.externalKey })
      .from(annotationSyncState)
      .where(and(eq(annotationSyncState.annotationId, annotationId), eq(annotationSyncState.source, source)))
      .orderBy(asc(annotationSyncState.id))
      .limit(1);
    return row?.externalKey ?? null;
  }

  /** All sync states of a source for one book, across devices, with their annotations. */
  async findStatesBySourceForBook(
    userId: number,
    source: AnnotationSyncSource,
    bookId: number,
    ex: Executor = this.db,
  ): Promise<{ state: AnnotationSyncStateRow; annotation: AnnotationRow }[]> {
    return ex
      .select({ state: annotationSyncState, annotation: annotations })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(and(eq(annotationSyncState.userId, userId), eq(annotationSyncState.source, source), eq(annotations.bookId, bookId)));
  }

  /**
   * Book ids with annotation changes a Kobo device has not seen: unacked deletions,
   * edits past the acked version, and unserved additions. Additions exclude
   * annotations whose kobo_span conversion already failed at the current resolver
   * version, or checkforchanges would report them forever.
   */
  async findBookIdsWithPendingKoboChanges(
    userId: number,
    deviceId: string,
    opts: { includeAllOrigins: boolean; resolverVersion: number },
  ): Promise<number[]> {
    const source: AnnotationSyncSource = 'kobo';
    const bookIds = new Set<number>();

    const tombstones = await this.db
      .selectDistinct({ bookId: annotations.bookId })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(
        and(
          eq(annotationSyncState.userId, userId),
          eq(annotationSyncState.source, source),
          eq(annotationSyncState.deviceId, deviceId),
          isNotNull(annotations.deletedAt),
          isNull(annotationSyncState.deleteAckedAt),
        ),
      );
    for (const row of tombstones) bookIds.add(row.bookId);

    const edits = await this.db
      .selectDistinct({ bookId: annotations.bookId })
      .from(annotationSyncState)
      .innerJoin(annotations, eq(annotations.id, annotationSyncState.annotationId))
      .where(
        and(
          eq(annotationSyncState.userId, userId),
          eq(annotationSyncState.source, source),
          eq(annotationSyncState.deviceId, deviceId),
          isNull(annotations.deletedAt),
          sql`${annotations.version} > ${annotationSyncState.lastAppliedVersion}`,
        ),
      );
    for (const row of edits) bookIds.add(row.bookId);

    const notServedToThisDevice = notExists(
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
    );

    const addConditions = opts.includeAllOrigins
      ? and(
          eq(annotations.userId, userId),
          isNull(annotations.deletedAt),
          notServedToThisDevice,
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(annotationPositions)
              .where(
                and(
                  eq(annotationPositions.annotationId, annotations.id),
                  eq(annotationPositions.format, 'kobo_span'),
                  eq(annotationPositions.status, 'failed'),
                  eq(annotationPositions.converterVersion, opts.resolverVersion),
                ),
              ),
          ),
        )
      : and(
          eq(annotations.userId, userId),
          isNull(annotations.deletedAt),
          notServedToThisDevice,
          sql`exists (select 1 from ${annotationSyncState} other where other.annotation_id = ${annotations.id} and other.source = ${source})`,
        );

    const adds = await this.db.selectDistinct({ bookId: annotations.bookId }).from(annotations).where(addConditions);
    for (const row of adds) bookIds.add(row.bookId);

    return [...bookIds];
  }
}
