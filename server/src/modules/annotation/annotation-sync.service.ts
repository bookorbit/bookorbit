import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AnnotationRow, AnnotationSyncStateRow } from '../../db/schema';
import type { AnnotationPositionFormat, AnnotationSyncSource } from './annotation.constants';
import { applyDeviceColor, applyDeviceStyle, hexFromKoreaderColor, styleFromDrawer } from './annotation-style-map';
import { AnnotationSyncRepository, type DbTx } from './annotation-sync.repository';

const INGEST_EVENT = 'annotation.sync_ingest';

export interface IncomingDeviceAnnotation {
  datetime: string;
  datetimeUpdated?: string | null;
  drawer: string;
  color?: string | null;
  text?: string | null;
  note?: string | null;
  chapter?: string | null;
  pageno?: number | null;
  posFormat: 'xpointer' | 'pdf';
  pos0: string;
  pos1?: string | null;
}

export interface IngestParams {
  userId: number;
  source: AnnotationSyncSource;
  deviceId: string;
  bookId: number;
  bookFileId: number;
  annotations: IncomingDeviceAnnotation[];
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

@Injectable()
export class AnnotationSyncService {
  private readonly logger = new Logger(AnnotationSyncService.name);

  constructor(private readonly syncRepo: AnnotationSyncRepository) {}

  /**
   * Ingests a batch of device annotations for one book. Identity is the external key
   * md5(datetime|pos0); a known datetime with a changed position is a move, never a
   * delete or a duplicate. Tombstoned (soft-deleted) matches are never resurrected.
   */
  async ingestDeviceAnnotations(params: IngestParams): Promise<IngestResult> {
    const startedAtMs = Date.now();
    const result: IngestResult = { created: 0, updated: 0, moved: 0, unchanged: 0, skippedDeleted: 0 };

    try {
      await this.syncRepo.transaction(async (tx) => {
        for (const incoming of this.dedupeByKey(params.annotations)) {
          await this.ingestOne(params, incoming, result, tx);
        }
      });
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

  async listDeviceAnnotationsByBook(userId: number, bookId: number, source: AnnotationSyncSource) {
    const formats: AnnotationPositionFormat[] = ['xpointer', 'pdf'];
    return this.syncRepo.listDeviceAnnotationsByBook(userId, bookId, source, formats);
  }

  private dedupeByKey(annotations: IncomingDeviceAnnotation[]): IncomingDeviceAnnotation[] {
    const byKey = new Map<string, IncomingDeviceAnnotation>();
    for (const annotation of annotations) {
      byKey.set(buildAnnotationKey(annotation.datetime, annotation.pos0), annotation);
    }
    return [...byKey.values()];
  }

  private async ingestOne(params: IngestParams, incoming: IncomingDeviceAnnotation, result: IngestResult, tx: DbTx): Promise<void> {
    const { userId, source, deviceId, bookId, bookFileId } = params;
    const key = buildAnnotationKey(incoming.datetime, incoming.pos0);

    const deviceState = await this.syncRepo.findStateByDeviceKey(userId, source, deviceId, bookId, key, tx);
    if (deviceState) {
      const annotation = await this.syncRepo.findAnnotationById(deviceState.annotationId, userId, tx);
      if (!annotation) return;
      if (annotation.deletedAt) {
        await this.syncRepo.touchState(deviceState.id, tx);
        result.skippedDeleted += 1;
        return;
      }
      const changed = await this.applyIncomingContent(annotation, incoming, bookFileId, tx);
      if (changed) {
        await this.syncRepo.updateState(deviceState.id, { lastAppliedVersion: changed.newVersion }, tx);
        result.updated += 1;
      } else {
        await this.syncRepo.touchState(deviceState.id, tx);
        result.unchanged += 1;
      }
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
      const state = await this.syncRepo.insertState(
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
      const changed = await this.applyIncomingContent(crossDevice.annotation, incoming, bookFileId, tx);
      if (changed) {
        await this.syncRepo.updateState(state.id, { lastAppliedVersion: changed.newVersion }, tx);
        result.updated += 1;
      } else {
        result.unchanged += 1;
      }
      return;
    }

    const byDatetime = await this.syncRepo.findCanonicalByDeviceDatetime(userId, bookId, incoming.datetime, incoming.posFormat, tx);
    const exact = byDatetime.find((c) => c.position?.pos0 === incoming.pos0);
    const candidate = exact ?? (byDatetime.length === 1 ? byDatetime[0] : undefined);
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

      const isMove = !exact && position != null && position.pos0 !== incoming.pos0;
      let version = annotation.version;
      if (isMove) {
        await this.syncRepo.updatePosition(
          annotation.id,
          incoming.posFormat,
          { pos0: incoming.pos0, pos1: incoming.pos1 ?? null, status: 'exact', bookFileId },
          tx,
        );
        await this.syncRepo.markPositionPending(annotation.id, 'cfi', tx);
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
        },
        tx,
      );
      const changed = await this.applyIncomingContent({ ...annotation, version }, incoming, bookFileId, tx);
      if (changed) {
        await this.syncRepo.updateState(state.id, { lastAppliedVersion: changed.newVersion }, tx);
      }
      result[isMove ? 'moved' : changed ? 'updated' : 'unchanged'] += 1;
      return;
    }

    await this.syncRepo.createCanonical(
      {
        userId,
        bookId,
        text: incoming.text ?? '',
        color: hexFromKoreaderColor(incoming.color),
        style: styleFromDrawer(incoming.drawer),
        note: incoming.note ?? null,
        chapterTitle: incoming.chapter ?? null,
        origin: source,
        version: 1,
        deviceCreatedAt: incoming.datetime,
        deviceUpdatedAt: incoming.datetimeUpdated ?? null,
      },
      {
        bookFileId,
        format: incoming.posFormat,
        pos0: incoming.pos0,
        pos1: incoming.pos1 ?? null,
        status: 'exact',
        extras: incoming.pageno != null ? { pageno: incoming.pageno } : null,
      },
      {
        source,
        deviceId,
        externalKey: key,
        externalCreatedAt: incoming.datetime,
        lastAppliedVersion: 1,
      },
      tx,
    );
    result.created += 1;
  }

  /**
   * Applies device content only when the device actually made a new edit since the last
   * one we ingested (device-clock comparison, no cross-clock skew). Style and color use
   * the projection rule: a device echo of the projected view never overwrites canonical.
   */
  private async applyIncomingContent(
    annotation: AnnotationRow,
    incoming: IncomingDeviceAnnotation,
    bookFileId: number,
    tx: DbTx,
  ): Promise<{ newVersion: number } | null> {
    const storedEffective = annotation.deviceUpdatedAt ?? annotation.deviceCreatedAt ?? '';
    const incomingEffective = incoming.datetimeUpdated ?? incoming.datetime;
    const hasNewEdit = incomingEffective > storedEffective;

    const position = await this.syncRepo.findDevicePosition(annotation.id, incoming.posFormat, tx);
    const pos1Changed = position != null && (position.pos1 ?? null) !== (incoming.pos1 ?? null);
    const pagenoChanged = incoming.pageno != null && (position?.extras as { pageno?: number } | null)?.pageno !== incoming.pageno && position != null;

    if (!hasNewEdit && !pos1Changed) {
      if (pagenoChanged) {
        await this.syncRepo.updatePosition(
          annotation.id,
          incoming.posFormat,
          { extras: { ...(position?.extras ?? {}), pageno: incoming.pageno } },
          tx,
        );
      }
      return null;
    }

    const patch: Partial<Pick<AnnotationRow, 'text' | 'note' | 'color' | 'style' | 'chapterTitle'>> = {};
    if (hasNewEdit) {
      const nextText = incoming.text ?? '';
      const nextNote = incoming.note ?? null;
      const nextStyle = applyDeviceStyle(annotation.style as Parameters<typeof applyDeviceStyle>[0], incoming.drawer);
      const nextColor = applyDeviceColor(annotation.color, incoming.color);
      if (nextText !== annotation.text) patch.text = nextText;
      if (nextNote !== annotation.note) patch.note = nextNote;
      if (nextStyle !== annotation.style) patch.style = nextStyle;
      if (nextColor !== annotation.color) patch.color = nextColor;
      if ((incoming.chapter ?? null) !== annotation.chapterTitle && incoming.chapter != null) patch.chapterTitle = incoming.chapter;
    }

    if (pos1Changed || pagenoChanged) {
      await this.syncRepo.updatePosition(
        annotation.id,
        incoming.posFormat,
        {
          pos1: incoming.pos1 ?? null,
          bookFileId,
          ...(incoming.pageno != null ? { extras: { ...(position?.extras ?? {}), pageno: incoming.pageno } } : {}),
        },
        tx,
      );
      if (pos1Changed) {
        await this.syncRepo.markPositionPending(annotation.id, 'cfi', tx);
      }
    }

    const hasContentChanges = Object.keys(patch).length > 0;
    if (!hasContentChanges && !pos1Changed) {
      // A bumped device timestamp without content changes (e.g. the echo of an edit we
      // pushed down) is bookkeeping only and must not bump the version, or the same
      // no-op edit would ping-pong between server and device forever.
      if (hasNewEdit) {
        await this.syncRepo.setDeviceUpdatedAtSilent(annotation.id, incoming.datetimeUpdated ?? null, tx);
      }
      return null;
    }

    const newVersion = await this.syncRepo.applyContentPatch(
      annotation.id,
      { ...patch, ...(hasNewEdit ? { deviceUpdatedAt: incoming.datetimeUpdated ?? null } : {}) },
      tx,
    );
    return { newVersion };
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
    let deletedCount = 0;

    await this.syncRepo.transaction(async (tx) => {
      const states = await this.syncRepo.findStatesForDeviceBook(params.userId, params.source, params.deviceId, params.bookId, tx);
      for (const { state, annotation } of states) {
        if (annotation.deletedAt) continue;
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

  /** Pending changes for a device and book, capped at limit entries across all kinds. */
  async computePushDown(userId: number, source: AnnotationSyncSource, deviceId: string, bookId: number, limit: number): Promise<PushDownSets> {
    const deletesRaw = await this.syncRepo.findDeleteCandidates(userId, source, deviceId, bookId, limit + 1);
    const deletes = deletesRaw.slice(0, limit);
    let remaining = limit - deletes.length;

    const editsRaw = remaining > 0 ? await this.syncRepo.findEditCandidates(userId, source, deviceId, bookId, remaining + 1) : [];
    const edits = editsRaw.slice(0, Math.max(remaining, 0));
    remaining -= edits.length;

    const addsRaw = remaining > 0 ? await this.syncRepo.findAddCandidates(userId, source, deviceId, bookId, remaining + 1) : [];
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

  async findDevicePositionFor(annotationId: number, format: 'xpointer' | 'pdf' | 'cfi') {
    return this.syncRepo.findDevicePosition(annotationId, format);
  }

  async findPositions(annotationIds: number[], formats: ('xpointer' | 'pdf' | 'cfi')[]) {
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
    applied: AckAppliedEntry[];
    deleted: AckDeletedEntry[];
    converterVersion: number;
  }): Promise<{ acked: number }> {
    const { userId, source, deviceId, bookFileId } = params;
    let acked = 0;

    await this.syncRepo.transaction(async (tx) => {
      for (const entry of params.applied) {
        const annotation = await this.syncRepo.findAnnotationById(entry.serverId, userId, tx);
        if (!annotation) continue;

        if (entry.status === 'failed') {
          await this.syncRepo.updatePosition(annotation.id, 'xpointer', { status: 'failed' }, tx);
          acked += 1;
          continue;
        }

        let versionForState = entry.version;
        if (entry.corrected && entry.pos0) {
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
        } else if (entry.verified) {
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
          },
          tx,
        );
        if (entry.datetimeUpdated !== undefined) {
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
    format: 'xpointer' | 'cfi';
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
