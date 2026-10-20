import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AnnotationDeviceContent, AnnotationRow, AnnotationSyncStateRow } from '../../db/schema';
import type { AnnotationPositionFormat, AnnotationStyle, AnnotationSyncSource } from './annotation.constants';
import {
  applyDeviceColor,
  applyDeviceStyle,
  applyKoboDeviceColor,
  hexFromKoboColor,
  hexFromKoreaderColor,
  styleFromDrawer,
} from './annotation-style-map';
import { AnnotationSyncRepository, type DbTx } from './annotation-sync.repository';
import { normalizeAnnotationNote } from './annotation-note.utils';
import { canonicalDeviceView, type DeviceContentField, incomingDeviceView, deviceHoldsView } from './annotation-device-view';
import {
  ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
  AchievementEventsService,
  type AnnotationCreatedPayload,
} from '../achievement/achievement-events.service';

const INGEST_EVENT = 'annotation.sync_ingest';
const INGEST_EMIT_EVENT = 'annotation.sync_event';
const LOST_COPY_MIN_APPLIED = 2;
/**
 * The clock a Kobo is served `clientLastModifiedUtc` from: 1 is the last content change as a real UTC instant. Earlier
 * acks were of a device wall time labelled UTC, which the firmware could rank below its own edit and ignore, so an
 * edited row acked before this clock is offered to the device once more.
 */
export const KOBO_SERVED_CLOCK = 1;

export interface IncomingDeviceAnnotation {
  /**
   * Device-authoritative identity (Kobo annotation UUID). When present it replaces the
   * datetime|pos0 dedup key and disables the datetime-based reconcile heuristics.
   */
  externalKey?: string;
  datetime: string;
  sourceCreatedAt?: Date | null;
  datetimeUpdated?: string | null;
  /**
   * Real time of the device's last edit, when its clock can be placed (KOReader reports its clock,
   * Kobo sends UTC). When present, edits are judged on it rather than on the device strings.
   */
  editedAt?: Date | null;
  drawer?: string;
  color?: string | null;
  /** Palette the incoming color belongs to; picks the projection mapping. */
  colorSpace?: 'koreader' | 'kobo';
  style?: AnnotationStyle;
  text?: string | null;
  note?: string | null;
  chapter?: string | null;
  pageno?: number | null;
  posFormat: 'xpointer' | 'pdf' | 'kobo_span';
  pos0: string;
  pos1?: string | null;
  posExtras?: Record<string, unknown> | null;
}

export interface IngestParams {
  userId: number;
  source: AnnotationSyncSource;
  deviceId: string;
  bookId: number;
  bookFileId: number;
  annotations: IncomingDeviceAnnotation[];
  /** Keys of everything the device still holds, when it sent its complete set. */
  presentKeys?: string[];
}

export interface IngestResult {
  created: number;
  updated: number;
  moved: number;
  unchanged: number;
  skippedDeleted: number;
}

export function buildAnnotationKey(deviceCreatedAt: string, pos0: string): string {
  return createHash('md5').update(`${deviceCreatedAt}|${pos0}`).digest('hex'); // codeql[js/weak-cryptographic-algorithm] - non-security dedup key
}

function keyOf(incoming: IncomingDeviceAnnotation): string {
  return incoming.externalKey ?? buildAnnotationKey(incoming.datetime, incoming.pos0);
}

interface ContentOutcome {
  /** Set when canonical changed; the device holds that version only when nothing it sent was refused. */
  newVersion: number | null;
  /** What the device holds now, in its own terms. */
  deviceView: AnnotationDeviceContent;
  /** A field the device changed lost to a later edit elsewhere, so canonical has to go back to it. */
  refused: boolean;
  /** The device's copy matches canonical after this upload. */
  inSync: boolean;
}

/** Other position formats that go stale when this device format moves. */
function siblingFormatsOf(posFormat: IncomingDeviceAnnotation['posFormat']): AnnotationPositionFormat[] {
  if (posFormat === 'xpointer') return ['cfi', 'kobo_span'];
  if (posFormat === 'kobo_span') return ['cfi', 'xpointer'];
  return ['cfi'];
}

@Injectable()
export class AnnotationSyncService {
  private readonly logger = new Logger(AnnotationSyncService.name);

  constructor(
    private readonly syncRepo: AnnotationSyncRepository,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  /**
   * Ingests a batch of device annotations for one book. Identity is the external key
   * md5(datetime|pos0); a known datetime with a changed position is a move, never a
   * delete or a duplicate. Tombstoned (soft-deleted) matches are never resurrected.
   */
  async ingestDeviceAnnotations(params: IngestParams): Promise<IngestResult> {
    const startedAtMs = Date.now();
    const result: IngestResult = { created: 0, updated: 0, moved: 0, unchanged: 0, skippedDeleted: 0 };
    const createdIds: number[] = [];

    try {
      await this.syncRepo.transaction(async (tx) => {
        const incomingAll = this.dedupeByKey(params.annotations);
        const present = new Set(params.presentKeys ?? incomingAll.map(keyOf));
        for (const incoming of incomingAll) {
          await this.ingestOne(params, incoming, result, createdIds, present, tx);
        }
      });
      // Emit only after the tx commits so listeners (e.g. Readwise flush that queries
      // rows with id > watermark) see the committed, visible rows.
      for (const annotationId of createdIds) {
        this.emitCreatedAnnotation(params.userId, params.bookId, annotationId);
      }
      this.logger.log(
        `[${INGEST_EVENT}] [end] userId=${params.userId} bookId=${params.bookId} deviceId=${params.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} created=${result.created} updated=${result.updated} moved=${result.moved} unchanged=${result.unchanged} skippedDeleted=${result.skippedDeleted} - device annotations ingested`,
      );
      return result;
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${INGEST_EVENT}] [fail] userId=${params.userId} bookId=${params.bookId} deviceId=${params.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - device annotations ingest failed`,
      );
      throw error;
    }
  }

  private dedupeByKey(annotations: IncomingDeviceAnnotation[]): IncomingDeviceAnnotation[] {
    const byKey = new Map<string, IncomingDeviceAnnotation>();
    for (const annotation of annotations) {
      byKey.set(keyOf(annotation), annotation);
    }
    return [...byKey.values()];
  }

  private emitCreatedAnnotation(userId: number, bookId: number, annotationId: number): void {
    const startedAtMs = Date.now();
    try {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_ANNOTATION_CREATED, {
        userId,
        bookId,
        annotationId,
      } satisfies AnnotationCreatedPayload);
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${INGEST_EMIT_EVENT}] [fail] userId=${userId} bookId=${bookId} annotationId=${annotationId} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - created annotation event dispatch failed`,
      );
    }
  }

  private async ingestOne(
    params: IngestParams,
    incoming: IncomingDeviceAnnotation,
    result: IngestResult,
    createdIds: number[],
    present: Set<string>,
    tx: DbTx,
  ): Promise<void> {
    const { userId, source, deviceId, bookId, bookFileId } = params;
    const key = keyOf(incoming);
    const incomingView = incomingDeviceView(source, incoming);

    const deviceState = await this.syncRepo.findStateByDeviceKey(userId, source, deviceId, bookId, key, tx);
    if (deviceState) {
      const annotation = await this.syncRepo.findAnnotationById(deviceState.annotationId, userId, tx);
      if (!annotation) return;
      if (annotation.deletedAt) {
        await this.syncRepo.touchState(deviceState.id, tx);
        result.skippedDeleted += 1;
        return;
      }
      await this.backfillSourceCreatedAt(annotation, incoming, source, tx);
      const outcome = await this.applyIncomingContent(annotation, incoming, bookFileId, source, deviceState.deviceContent ?? null, tx);
      const holdsNewVersion = outcome.newVersion !== null && deviceState.lastAppliedVersion !== 0 && outcome.inSync;
      await this.syncRepo.updateState(
        deviceState.id,
        { deviceContent: outcome.deviceView, ...(holdsNewVersion ? { lastAppliedVersion: outcome.newVersion! } : {}) },
        tx,
      );
      // The device counts as current and nothing moved the version, so it would keep the edit it lost.
      if (outcome.refused && outcome.newVersion === null && deviceState.lastAppliedVersion >= annotation.version) {
        await this.syncRepo.bumpVersion(annotation.id, tx);
      }
      result[outcome.newVersion !== null ? 'updated' : 'unchanged'] += 1;
      return;
    }

    const crossDevice = await this.syncRepo.findStateByKeyAnyDevice(userId, source, key, bookId, tx);
    if (crossDevice) {
      if (crossDevice.annotation.deletedAt) {
        await this.syncRepo.insertState(
          {
            annotationId: crossDevice.annotation.id,
            userId,
            source,
            deviceId,
            externalKey: key,
            externalCreatedAt: incoming.datetime,
            lastAppliedVersion: crossDevice.annotation.version,
          },
          tx,
        );
        result.skippedDeleted += 1;
        return;
      }
      await this.backfillSourceCreatedAt(crossDevice.annotation, incoming, source, tx);
      const state = await this.syncRepo.insertState(
        {
          annotationId: crossDevice.annotation.id,
          userId,
          source,
          deviceId,
          externalKey: key,
          externalCreatedAt: incoming.datetime,
          lastAppliedVersion: crossDevice.annotation.version,
          deviceContent: incomingView,
        },
        tx,
      );
      const outcome = await this.applyIncomingContent(crossDevice.annotation, incoming, bookFileId, source, null, tx);
      if (outcome.newVersion !== null) {
        await this.syncRepo.updateState(state.id, { lastAppliedVersion: outcome.newVersion }, tx);
        result.updated += 1;
      } else {
        result.unchanged += 1;
      }
      return;
    }

    // UUID-keyed sources have authoritative identity; the datetime heuristics below
    // exist only for the datetime|pos0 key scheme where a move changes the key.
    const byDatetime = incoming.externalKey
      ? []
      : await this.syncRepo.findCanonicalByDeviceDatetime(userId, bookId, incoming.datetime, incoming.posFormat, tx);
    const exact = byDatetime.find((c) => c.position?.pos0 === incoming.pos0);
    // A highlight made in the same second as another one still on the device is a new
    // highlight, not that one moved.
    const movable = byDatetime.filter((c) => !c.position?.pos0 || !present.has(buildAnnotationKey(incoming.datetime, c.position.pos0)));
    const candidate = exact ?? (byDatetime.length === 1 && movable.length === 1 ? movable[0] : undefined);
    if (candidate) {
      const { annotation, position } = candidate;
      if (annotation.deletedAt) {
        await this.syncRepo.insertState(
          {
            annotationId: annotation.id,
            userId,
            source,
            deviceId,
            externalKey: key,
            externalCreatedAt: incoming.datetime,
            lastAppliedVersion: annotation.version,
          },
          tx,
        );
        result.skippedDeleted += 1;
        return;
      }

      await this.backfillSourceCreatedAt(annotation, incoming, source, tx);

      const isMove = !exact && position != null && position.pos0 !== incoming.pos0;
      let version = annotation.version;
      if (isMove) {
        await this.syncRepo.updatePosition(
          annotation.id,
          incoming.posFormat,
          { pos0: incoming.pos0, pos1: incoming.pos1 ?? null, status: 'exact', bookFileId },
          tx,
        );
        for (const sibling of siblingFormatsOf(incoming.posFormat)) {
          await this.syncRepo.markPositionPending(annotation.id, sibling, tx);
        }
        version = await this.syncRepo.applyContentPatch(annotation.id, { deviceUpdatedAt: incoming.datetimeUpdated ?? null }, tx);
      }
      const state = await this.syncRepo.insertState(
        {
          annotationId: annotation.id,
          userId,
          source,
          deviceId,
          externalKey: key,
          externalCreatedAt: incoming.datetime,
          lastAppliedVersion: version,
          deviceContent: incomingView,
        },
        tx,
      );
      const outcome = await this.applyIncomingContent({ ...annotation, version }, incoming, bookFileId, source, null, tx);
      if (outcome.newVersion !== null) {
        await this.syncRepo.updateState(state.id, { lastAppliedVersion: outcome.newVersion }, tx);
      }
      result[isMove ? 'moved' : outcome.newVersion !== null ? 'updated' : 'unchanged'] += 1;
      return;
    }

    const createdRow = await this.syncRepo.createCanonical(
      {
        userId,
        bookId,
        text: incoming.text ?? '',
        color: incoming.colorSpace === 'kobo' ? hexFromKoboColor(incoming.color) : hexFromKoreaderColor(incoming.color),
        style: incoming.style ?? styleFromDrawer(incoming.drawer),
        note: normalizeAnnotationNote(incoming.note),
        chapterTitle: incoming.chapter ?? null,
        origin: source,
        version: 1,
        deviceCreatedAt: incoming.datetime,
        deviceUpdatedAt: incoming.datetimeUpdated ?? null,
        sourceCreatedAt: incoming.sourceCreatedAt ?? null,
      },
      {
        bookFileId,
        format: incoming.posFormat,
        pos0: incoming.pos0,
        pos1: incoming.pos1 ?? null,
        status: 'exact',
        extras: this.buildPositionExtras(incoming),
      },
      {
        source,
        deviceId,
        externalKey: key,
        externalCreatedAt: incoming.datetime,
        lastAppliedVersion: 1,
        deviceContent: incomingView,
      },
      tx,
    );
    createdIds.push(createdRow.id);
    result.created += 1;
  }

  private async backfillSourceCreatedAt(
    annotation: AnnotationRow,
    incoming: IncomingDeviceAnnotation,
    source: AnnotationSyncSource,
    tx: DbTx,
  ): Promise<void> {
    if (annotation.origin !== source || annotation.sourceCreatedAt != null || incoming.sourceCreatedAt == null) return;
    await this.syncRepo.setSourceCreatedAtSilent(annotation.id, incoming.sourceCreatedAt, tx);
  }

  /**
   * Applies a device copy field by field. With the device's last confirmed view on file, a field
   * it did not change keeps the canonical value, a field only the device changed is taken, and a
   * field both sides changed goes to the later edit. Without that view (rows synced before it was
   * kept) the whole copy is judged by edit time as before. Edit time is the real time when the
   * device reports one (Kobo UTC, KOReader through its clock); otherwise the device's own strings
   * are compared. Style and color use the projection rule: a device echo of the projected view
   * never overwrites canonical.
   */
  private async applyIncomingContent(
    annotation: AnnotationRow,
    incoming: IncomingDeviceAnnotation,
    bookFileId: number,
    source: AnnotationSyncSource,
    confirmed: AnnotationDeviceContent | null,
    tx: DbTx,
  ): Promise<ContentOutcome> {
    const storedEffective = annotation.deviceUpdatedAt ?? annotation.deviceCreatedAt ?? '';
    const incomingEffective = incoming.datetimeUpdated ?? incoming.datetime;
    const hasNewEdit = incoming.editedAt
      ? incoming.editedAt.getTime() > (annotation.contentUpdatedAt ?? annotation.createdAt).getTime()
      : incomingEffective > storedEffective;

    const deviceView = incomingDeviceView(source, incoming);
    const canonicalView = canonicalDeviceView(source, annotation);
    let refused = false;
    const takes = (field: DeviceContentField): boolean => {
      if (!confirmed) return hasNewEdit;
      if (field !== 'note' && deviceView[field] === null) return false;
      if (deviceView[field] === confirmed[field]) return false;
      if (canonicalView[field] === confirmed[field] || hasNewEdit) return true;
      refused = true;
      return false;
    };

    const patch: Partial<Pick<AnnotationRow, 'text' | 'note' | 'color' | 'style' | 'chapterTitle'>> = {};
    if (takes('note')) {
      const nextNote = normalizeAnnotationNote(incoming.note);
      if (nextNote !== annotation.note) patch.note = nextNote;
    }
    if (takes('style')) {
      const nextStyle = applyDeviceStyle(annotation.style as Parameters<typeof applyDeviceStyle>[0], incoming.drawer);
      if (nextStyle !== annotation.style) patch.style = nextStyle;
    }
    if (takes('color')) {
      const nextColor =
        incoming.colorSpace === 'kobo' ? applyKoboDeviceColor(annotation.color, incoming.color) : applyDeviceColor(annotation.color, incoming.color);
      if (nextColor !== annotation.color) patch.color = nextColor;
    }
    const position = await this.syncRepo.findDevicePosition(annotation.id, incoming.posFormat, tx);
    // pos0 can only change under UUID identity; with the datetime|pos0 key a changed
    // pos0 is a different key and lands in the move path instead.
    const pos0Changed = incoming.externalKey != null && position != null && position.pos0 !== incoming.pos0;
    const pos1Changed = position != null && (position.pos1 ?? null) !== (incoming.pos1 ?? null);
    const posChanged = pos0Changed || pos1Changed;

    // The text is what the range covers, so a moved range brings its text whatever its edit time.
    if (hasNewEdit || posChanged) {
      const nextText = incoming.text ?? '';
      if (nextText !== annotation.text) patch.text = nextText;
      if ((incoming.chapter ?? null) !== annotation.chapterTitle && incoming.chapter != null) patch.chapterTitle = incoming.chapter;
    }
    const pagenoChanged = incoming.pageno != null && (position?.extras as { pageno?: number } | null)?.pageno !== incoming.pageno && position != null;
    const hasContentChanges = Object.keys(patch).length > 0;

    if (!hasContentChanges && !posChanged && !hasNewEdit) {
      if (pagenoChanged) {
        await this.syncRepo.updatePosition(
          annotation.id,
          incoming.posFormat,
          { extras: { ...(position?.extras ?? {}), pageno: incoming.pageno } },
          tx,
        );
      }
      return { newVersion: null, deviceView, refused, inSync: deviceHoldsView(deviceView, canonicalView) };
    }

    if (posChanged || pagenoChanged) {
      await this.syncRepo.updatePosition(
        annotation.id,
        incoming.posFormat,
        {
          ...(pos0Changed ? { pos0: incoming.pos0, status: 'exact' as const } : {}),
          pos1: incoming.pos1 ?? null,
          bookFileId,
          ...(posChanged && incoming.posFormat === 'kobo_span'
            ? { extras: this.movedKoboSpanExtras(position?.extras ?? null, incoming) }
            : incoming.pageno != null
              ? { extras: { ...(position?.extras ?? {}), pageno: incoming.pageno } }
              : {}),
        },
        tx,
      );
      if (posChanged) {
        for (const sibling of siblingFormatsOf(incoming.posFormat)) {
          await this.syncRepo.markPositionPending(annotation.id, sibling, tx);
        }
      }
    }

    if (!hasContentChanges && !posChanged) {
      // A bumped device timestamp without content changes (e.g. the echo of an edit we
      // pushed down) is bookkeeping only and must not bump the version, or the same
      // no-op edit would ping-pong between server and device forever.
      if (hasNewEdit) {
        await this.syncRepo.setDeviceUpdatedAtSilent(annotation.id, incoming.datetimeUpdated ?? null, tx);
      }
      return { newVersion: null, deviceView, refused, inSync: deviceHoldsView(deviceView, canonicalView) };
    }

    // A field taken from an older edit (nothing else touched it since) must not move the
    // content time back, or a genuinely later edit would then look older than it.
    const editedAt = incoming.editedAt ?? new Date();
    const contentUpdatedAt =
      annotation.contentUpdatedAt && annotation.contentUpdatedAt.getTime() > editedAt.getTime() ? annotation.contentUpdatedAt : editedAt;
    const newVersion = await this.syncRepo.applyContentPatch(
      annotation.id,
      {
        ...patch,
        ...(hasNewEdit ? { deviceUpdatedAt: incoming.datetimeUpdated ?? null } : {}),
        ...(hasContentChanges ? { contentUpdatedAt } : {}),
      },
      tx,
    );
    return { newVersion, deviceView, refused, inSync: deviceHoldsView(deviceView, canonicalDeviceView(source, { ...annotation, ...patch })) };
  }

  /**
   * A moved Kobo span carries the device's new location, which the canonical positions are rebuilt
   * from. The served-span markers (rendition, source cfi) describe the old range, so they go until
   * that conversion stamps them again.
   */
  private movedKoboSpanExtras(previous: unknown, incoming: IncomingDeviceAnnotation): Record<string, unknown> {
    const kept = { ...((previous ?? {}) as Record<string, unknown>) };
    delete kept.renditionHash;
    delete kept.sourceCfi;
    return { ...kept, ...(this.buildPositionExtras(incoming) ?? {}) };
  }

  private buildPositionExtras(incoming: IncomingDeviceAnnotation): Record<string, unknown> | null {
    const extras: Record<string, unknown> = { ...(incoming.posExtras ?? {}) };
    if (incoming.pageno != null) extras.pageno = incoming.pageno;
    return Object.keys(extras).length > 0 ? extras : null;
  }

  /**
   * Applies explicit device delete operations (Kobo PATCH ops). Identity is the
   * device-side external key; any device's state row of the source matches, so a
   * deletion propagates even when reported by a device that did not create it.
   */
  async applyDeviceDeletes(params: {
    userId: number;
    source: AnnotationSyncSource;
    deviceId: string;
    bookId: number;
    deletes: { externalKey: string }[];
  }): Promise<number> {
    if (params.deletes.length === 0) return 0;
    let deleted = 0;

    await this.syncRepo.transaction(async (tx) => {
      for (const entry of params.deletes) {
        const match = await this.syncRepo.findStateByKeyAnyDevice(params.userId, params.source, entry.externalKey, params.bookId, tx);
        if (!match) continue;
        if (!match.annotation.deletedAt) {
          await this.syncRepo.softDeleteById(match.annotation.id, tx);
          deleted += 1;
        }
        const reporterState =
          match.state.deviceId === params.deviceId
            ? match.state
            : await this.syncRepo.findStateByAnnotationAndDevice(match.annotation.id, params.source, params.deviceId, tx);
        if (reporterState) {
          await this.syncRepo.setDeleteAcked(reporterState.id, tx);
        } else {
          const inserted = await this.syncRepo.insertState(
            {
              annotationId: match.annotation.id,
              userId: params.userId,
              source: params.source,
              deviceId: params.deviceId,
              externalKey: entry.externalKey,
              externalCreatedAt: match.state.externalCreatedAt,
              lastAppliedVersion: match.annotation.version,
            },
            tx,
          );
          await this.syncRepo.setDeleteAcked(inserted.id, tx);
        }
      }
    });

    if (deleted > 0) {
      this.logger.log(
        `[annotation.sync_delete_ops] [end] userId=${params.userId} bookId=${params.bookId} deviceId=${params.deviceId.slice(0, 8)} deleted=${deleted} - device delete operations applied`,
      );
    }
    return deleted;
  }

  /**
   * Marks annotations as applied on a device after they were served in a pull-style
   * response (Kobo GET). This is the serve-side counterpart of applyExchangeAck:
   * lastAppliedVersion advances to the served version, and deletions that propagated
   * by omission are acked for this device.
   */
  async markServedApplied(params: {
    userId: number;
    source: AnnotationSyncSource;
    deviceId: string;
    entries: { annotationId: number; version: number; externalKey: string; externalCreatedAt: string | null }[];
    tombstoneStateIds: number[];
    /** An earlier response acknowledged late: a version the device already acknowledged stays. */
    keepNewerVersion?: boolean;
  }): Promise<void> {
    if (params.entries.length === 0 && params.tombstoneStateIds.length === 0) return;
    await this.syncRepo.transaction(async (tx) => {
      const contents = await this.syncRepo.findContentByIds(
        params.userId,
        params.entries.map((entry) => entry.annotationId),
        tx,
      );
      const contentById = new Map(contents.map((row) => [row.id, row]));
      for (const entry of params.entries) {
        const content = contentById.get(entry.annotationId);
        await this.syncRepo.insertState(
          {
            annotationId: entry.annotationId,
            userId: params.userId,
            source: params.source,
            deviceId: params.deviceId,
            externalKey: entry.externalKey,
            externalCreatedAt: entry.externalCreatedAt,
            lastAppliedVersion: entry.version,
            deviceContent: content && content.version === entry.version ? canonicalDeviceView(params.source, content) : null,
            servedClock: params.source === 'kobo' ? KOBO_SERVED_CLOCK : 0,
          },
          tx,
          { keepNewerVersion: params.keepNewerVersion },
        );
      }
      for (const stateId of params.tombstoneStateIds) {
        await this.syncRepo.setDeleteAcked(stateId, tx);
      }
    });
  }

  /**
   * The stable device-side key for an annotation within a source, minting one when the
   * annotation has never been served (Kobo ids are store-global, so every device of the
   * user must see the same id).
   */
  async reserveExternalKey(params: {
    annotationId: number;
    userId: number;
    source: AnnotationSyncSource;
    deviceId: string;
    externalCreatedAt: string | null;
  }): Promise<string> {
    return this.syncRepo.transaction(async (tx) => {
      await this.syncRepo.lockAnnotationForSync(params.annotationId, tx);
      const externalKey = (await this.syncRepo.findExternalKeyForAnnotation(params.annotationId, params.source, tx)) ?? randomUUID();
      await this.syncRepo.insertStateIfMissing(
        {
          annotationId: params.annotationId,
          userId: params.userId,
          source: params.source,
          deviceId: params.deviceId,
          externalKey,
          externalCreatedAt: params.externalCreatedAt,
          lastAppliedVersion: 0,
        },
        tx,
      );
      return externalKey;
    });
  }

  async listActiveForBook(userId: number, bookId: number): Promise<AnnotationRow[]> {
    return this.syncRepo.findActiveByBook(userId, bookId);
  }

  async listStatesBySourceForBook(
    userId: number,
    source: AnnotationSyncSource,
    bookId: number,
  ): Promise<{ state: AnnotationSyncStateRow; annotation: AnnotationRow }[]> {
    return this.syncRepo.findStatesBySourceForBook(userId, source, bookId);
  }

  async listDeleteCandidates(
    userId: number,
    source: AnnotationSyncSource,
    deviceId: string,
    bookId: number,
    limit: number,
  ): Promise<{ state: AnnotationSyncStateRow; annotation: AnnotationRow }[]> {
    return this.syncRepo.findDeleteCandidates(userId, source, deviceId, bookId, limit);
  }

  async listPendingKoboChangeBookIds(userId: number, deviceId: string, opts: { includeAllOrigins: boolean; resolverVersion: number }) {
    return this.syncRepo.findBookIdsWithPendingKoboChanges(userId, deviceId, { ...opts, servedClock: KOBO_SERVED_CLOCK });
  }

  async setDeviceIdentity(annotationId: number, deviceCreatedAt: string): Promise<void> {
    await this.syncRepo.setDeviceIdentitySilent(annotationId, deviceCreatedAt);
  }

  /**
   * Soft-deletes annotations this device previously synced but no longer reports in its
   * full key set. A known datetime with a changed key is a move (already reconciled by
   * ingest), never a delete. The reporting device's state is acked immediately; other
   * devices receive the deletion through their own push-down.
   */
  async detectDeviceDeletions(params: {
    userId: number;
    source: AnnotationSyncSource;
    deviceId: string;
    bookId: number;
    presentKeys: DeviceKeyEntry[];
  }): Promise<number> {
    const present = new Set(params.presentKeys.map((entry) => entry.k));
    const presentDatetimes = new Set(params.presentKeys.map((entry) => entry.dt));
    const sourceCreatedAtByKey = new Map(
      params.presentKeys.flatMap((entry) => (entry.sourceCreatedAt ? [[entry.k, entry.sourceCreatedAt] as const] : [])),
    );
    let deletedCount = 0;

    await this.syncRepo.transaction(async (tx) => {
      const states = await this.syncRepo.findStatesForDeviceBook(params.userId, params.source, params.deviceId, params.bookId, tx);
      await this.syncRepo.setSourceCreatedAtsSilent(
        states.flatMap(({ state, annotation }) => {
          const sourceCreatedAt = sourceCreatedAtByKey.get(state.externalKey);
          return annotation.origin === params.source && annotation.sourceCreatedAt == null && sourceCreatedAt
            ? [{ annotationId: annotation.id, sourceCreatedAt }]
            : [];
        }),
        tx,
      );
      for (const { state, annotation } of states) {
        if (annotation.deletedAt) continue;
        if (state.deleteAckedAt) {
          // The device removed this row and said so, and it is live again: a restore that kept the
          // state. Its absence is that old delete, so re-offer the row as a fresh add instead.
          await this.syncRepo.deleteState(state.id, tx);
          continue;
        }
        if (state.lastAppliedVersion === 0) continue;
        if (present.has(state.externalKey)) continue;
        if (state.externalCreatedAt && presentDatetimes.has(state.externalCreatedAt)) continue;
        await this.syncRepo.softDeleteById(annotation.id, tx);
        await this.syncRepo.setDeleteAcked(state.id, tx);
        deletedCount += 1;
      }
    });

    if (deletedCount > 0) {
      this.logger.log(
        `[annotation.sync_delete_detect] [end] userId=${params.userId} bookId=${params.bookId} deviceId=${params.deviceId.slice(0, 8)} deleted=${deletedCount} - device deletions applied`,
      );
    }
    return deletedCount;
  }

  /**
   * A complete key set that keeps none of the rows this device had applied is a lost or
   * replaced copy of the book (a re-download, a deleted sidecar), not a delete of
   * everything. Devices that cannot say so themselves are judged by this rule, which
   * needs at least two applied rows so deleting a book's only highlight still works.
   */
  async isLostDeviceCopy(params: {
    userId: number;
    source: AnnotationSyncSource;
    deviceId: string;
    bookId: number;
    presentKeys: DeviceKeyEntry[];
  }): Promise<boolean> {
    const present = new Set(params.presentKeys.map((entry) => entry.k));
    const presentDatetimes = new Set(params.presentKeys.map((entry) => entry.dt));
    const states = await this.syncRepo.findStatesForDeviceBook(params.userId, params.source, params.deviceId, params.bookId);
    const applied = states.filter(({ state, annotation }) => !annotation.deletedAt && state.lastAppliedVersion > 0);
    if (applied.length < LOST_COPY_MIN_APPLIED) return false;
    return applied.every(
      ({ state }) => !present.has(state.externalKey) && !(state.externalCreatedAt && presentDatetimes.has(state.externalCreatedAt)),
    );
  }

  /**
   * Offers every live row this device had applied again, as idempotent adds, by marking
   * its states unapplied. Unapplied states are also exempt from deletion detection, so
   * nothing is deleted while the copy is being refilled.
   */
  async reofferDeviceCopy(params: { userId: number; source: AnnotationSyncSource; deviceId: string; bookId: number }): Promise<number> {
    return this.syncRepo.resetAppliedVersionsForDeviceBook(params.userId, params.source, params.deviceId, params.bookId);
  }

  /** Pending changes for a device and book, capped at limit entries across all kinds. */
  findPendingDeviceBooks(
    userId: number,
    source: AnnotationSyncSource,
    pairs: { deviceId: string; bookId: number }[],
    devicePositionFormat: AnnotationPositionFormat,
    converterVersion: number,
  ): Promise<Set<string>> {
    return this.syncRepo.findPendingDeviceBooks(userId, source, pairs, devicePositionFormat, converterVersion);
  }

  async computePushDown(userId: number, source: AnnotationSyncSource, deviceId: string, bookId: number, limit: number): Promise<PushDownSets> {
    const deletesRaw = await this.syncRepo.findDeleteCandidates(userId, source, deviceId, bookId, limit + 1);
    const deletes = deletesRaw.slice(0, limit);
    let remaining = limit - deletes.length;

    const editsRaw = remaining > 0 ? await this.syncRepo.findEditCandidates(userId, source, deviceId, bookId, remaining + 1) : [];
    const edits = editsRaw.slice(0, Math.max(remaining, 0));
    remaining -= edits.length;

    const requiredAddFormats: AnnotationPositionFormat[] | undefined = source === 'koreader' ? ['xpointer', 'cfi'] : undefined;
    const addsRaw = remaining > 0 ? await this.syncRepo.findAddCandidates(userId, source, deviceId, bookId, remaining + 1, requiredAddFormats) : [];
    const adds = addsRaw.slice(0, Math.max(remaining, 0));

    const more = deletesRaw.length > deletes.length || editsRaw.length > edits.length || addsRaw.length > adds.length;
    return { adds, edits, deletes, more };
  }

  /**
   * Returns the annotation's device identity datetime, minting a unique one per
   * (user, book) on first push (KOReader treats the datetime as identity).
   * Device datetimes are wall-clock local with no timezone; the offset shifts the
   * minted value into the device's clock frame so it never lands in its future.
   */
  async ensureDeviceCreatedAt(userId: number, bookId: number, annotation: AnnotationRow, deviceClockOffsetMs = 0): Promise<string> {
    if (annotation.deviceCreatedAt) return annotation.deviceCreatedAt;
    const existing = await this.syncRepo.listDeviceCreatedAtsForBook(userId, bookId);
    let candidate = formatDeviceDatetime(new Date(annotation.createdAt.getTime() + deviceClockOffsetMs));
    while (existing.has(candidate)) {
      candidate = addSeconds(candidate, 1);
    }
    await this.syncRepo.setDeviceIdentitySilent(annotation.id, candidate);
    return candidate;
  }

  /**
   * Batch form of ensureDeviceCreatedAt: reads the book's used device datetimes once and
   * mints for every annotation that still lacks one, in the order given so a caller
   * pushing a page of annotations gets the same values a per-annotation loop would.
   */
  async ensureDeviceCreatedAtMany(
    userId: number,
    bookId: number,
    annotationRows: AnnotationRow[],
    deviceClockOffsetMs = 0,
  ): Promise<Map<number, string>> {
    const assigned = new Map<number, string>();
    if (annotationRows.length === 0) return assigned;

    const pending: AnnotationRow[] = [];
    for (const annotation of annotationRows) {
      if (annotation.deviceCreatedAt) assigned.set(annotation.id, annotation.deviceCreatedAt);
      else pending.push(annotation);
    }
    if (pending.length === 0) return assigned;

    const used = await this.syncRepo.listDeviceCreatedAtsForBook(userId, bookId);
    const minted: { annotationId: number; deviceCreatedAt: string }[] = [];
    for (const annotation of pending) {
      let candidate = formatDeviceDatetime(new Date(annotation.createdAt.getTime() + deviceClockOffsetMs));
      while (used.has(candidate)) {
        candidate = addSeconds(candidate, 1);
      }
      used.add(candidate);
      assigned.set(annotation.id, candidate);
      minted.push({ annotationId: annotation.id, deviceCreatedAt: candidate });
    }
    await this.syncRepo.setDeviceIdentitiesSilent(minted);
    return assigned;
  }

  async findDevicePositionFor(annotationId: number, format: AnnotationPositionFormat) {
    return this.syncRepo.findDevicePosition(annotationId, format);
  }

  async findPositions(annotationIds: number[], formats: AnnotationPositionFormat[]) {
    return this.syncRepo.findPositionsByAnnotationIds(annotationIds, formats);
  }

  /**
   * Applies a device's acknowledgment of pushed changes. Only here do
   * lastAppliedVersion and deleteAckedAt advance; corrected positions are stored and
   * bump the version so other devices receive the fix.
   */
  async applyExchangeAck(params: {
    userId: number;
    source: AnnotationSyncSource;
    deviceId: string;
    bookFileId: number;
    bookId: number;
    applied: AckAppliedEntry[];
    deleted: AckDeletedEntry[];
    converterVersion: number;
  }): Promise<{ acked: number }> {
    const { userId, source, deviceId, bookFileId } = params;
    let acked = 0;

    await this.syncRepo.transaction(async (tx) => {
      for (const entry of params.applied) {
        const annotation = await this.syncRepo.findAnnotationById(entry.serverId, userId, tx);
        if (!annotation || annotation.bookId !== params.bookId) continue;
        if (entry.version !== annotation.version) continue;

        if (entry.status === 'failed') {
          acked += 1;
          continue;
        }

        let versionForState = entry.verified === false ? 0 : entry.version;
        if (entry.corrected && entry.pos0 && entry.verified !== false) {
          await this.syncRepo.upsertPosition(
            {
              annotationId: annotation.id,
              userId,
              bookFileId,
              format: 'xpointer',
              pos0: entry.pos0,
              pos1: entry.pos1 ?? null,
              status: entry.verified ? 'repaired' : 'pending',
              converterVersion: params.converterVersion,
              extras: entry.pageno != null ? { pageno: entry.pageno } : null,
            },
            tx,
          );
          versionForState = await this.syncRepo.bumpVersion(annotation.id, tx);
        } else if (entry.verified && entry.version === annotation.version) {
          await this.syncRepo.updatePosition(annotation.id, 'xpointer', { status: 'exact' }, tx);
        }

        const pos0 = entry.pos0 ?? (await this.syncRepo.findDevicePosition(annotation.id, 'xpointer', tx))?.pos0 ?? '';
        const externalKey = buildAnnotationKey(annotation.deviceCreatedAt ?? '', pos0);
        await this.syncRepo.insertState(
          {
            annotationId: annotation.id,
            userId,
            source,
            deviceId,
            externalKey,
            externalCreatedAt: annotation.deviceCreatedAt ?? null,
            lastAppliedVersion: versionForState,
            deviceContent: canonicalDeviceView(source, annotation),
          },
          tx,
        );
        if (entry.datetimeUpdated !== undefined && entry.version === annotation.version && entry.verified !== false) {
          await this.syncRepo.setDeviceUpdatedAtSilent(annotation.id, entry.datetimeUpdated, tx);
        }
        acked += 1;
      }

      for (const entry of params.deleted) {
        if (entry.status !== 'applied') continue;
        const state = await this.syncRepo.findStateByAnnotationAndDevice(entry.serverId, source, deviceId, tx);
        if (!state || state.userId !== userId) continue;
        await this.syncRepo.setDeleteAcked(state.id, tx);
        acked += 1;
      }
    });

    return { acked };
  }

  async upsertGeneratedPosition(position: {
    annotationId: number;
    userId: number;
    bookFileId: number;
    format: 'xpointer' | 'cfi' | 'kobo_span';
    pos0: string | null;
    pos1: string | null;
    status: 'exact' | 'repaired' | 'failed' | 'pending';
    converterVersion: number;
    extras?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.syncRepo.upsertPosition({ ...position, extras: position.extras ?? null });
  }
}

export interface DeviceKeyEntry {
  k: string;
  dt: string;
  sourceCreatedAt?: Date | null;
}

export interface PushDownSets {
  adds: AnnotationRow[];
  edits: { state: AnnotationSyncStateRow; annotation: AnnotationRow }[];
  deletes: { state: AnnotationSyncStateRow; annotation: AnnotationRow }[];
  more: boolean;
}

export interface AckAppliedEntry {
  serverId: number;
  version: number;
  status: 'applied' | 'failed';
  verified?: boolean;
  corrected?: boolean;
  pos0?: string | null;
  pos1?: string | null;
  pageno?: number | null;
  datetimeUpdated?: string | null;
}

export interface AckDeletedEntry {
  serverId: number;
  status: 'applied' | 'failed';
}

export function formatDeviceDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function addSeconds(deviceDatetime: string, seconds: number): string {
  const date = new Date(`${deviceDatetime.replace(' ', 'T')}Z`);
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return formatDeviceDatetime(date);
}
