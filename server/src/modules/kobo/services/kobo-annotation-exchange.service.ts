import { randomUUID } from 'crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AnnotationPosition, AnnotationRow, AnnotationSyncStateRow } from '../../../db/schema';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { AnnotationSyncService, formatDeviceDatetime, type IncomingDeviceAnnotation } from '../../annotation/annotation-sync.service';
import { KoboSpanConverterService, serializeKoboSpanPos } from '../../position-converter/kobo-span-converter.service';
import { parseSpanSelector } from '../../position-converter/kobo-span.core';
import { KoboBookIdentityService } from './kobo-book-identity.service';
import { KoboAnnotationMaterializerService } from './kobo-annotation-materializer.service';
import { KoboKepubContextService } from './kobo-kepub-context.service';
import { KoboSettingsService } from './kobo-settings.service';
import {
  extractKoboAnnotationOperations,
  toKoboReadingServiceAnnotation,
  type IncomingUpsert,
  type KoboReadingServiceAnnotationsResponse,
  type ServeAnnotation,
} from './kobo-annotation-payload';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GET_EVENT = 'kobo.annotation_get';
const PATCH_EVENT = 'kobo.annotation_patch';

export interface ServedAckPlan {
  entries: { annotationId: number; version: number; externalKey: string; externalCreatedAt: string | null }[];
  tombstoneStateIds: number[];
}

export interface KoboContentAnnotationsResult {
  etag: string;
  notModified: boolean;
  response?: KoboReadingServiceAnnotationsResponse;
  servedAck: ServedAckPlan;
}

@Injectable()
export class KoboAnnotationExchangeService {
  private readonly logger = new Logger(KoboAnnotationExchangeService.name);

  constructor(
    private readonly annotationSync: AnnotationSyncService,
    private readonly bookIdentityService: KoboBookIdentityService,
    private readonly kepubContextService: KoboKepubContextService,
    private readonly materializer: KoboAnnotationMaterializerService,
    private readonly koboSpanConverter: KoboSpanConverterService,
    private readonly settingsService: KoboSettingsService,
  ) {}

  async getContentAnnotations(
    userId: number,
    contentId: string,
    deviceId: number,
    ifNoneMatch: string | undefined,
  ): Promise<KoboContentAnnotationsResult> {
    const startedAtMs = Date.now();
    const bookId = await this.resolveBookIdByContentId(userId, contentId);
    if (bookId === null) throw new NotFoundException(`Kobo content ${contentId} not found`);

    const kepub = await this.kepubContextService.resolveForBook(userId, bookId);
    const includeAllOrigins = kepub.settings?.syncBookOrbitAnnotationsToKobo ?? false;
    if (kepub.ok) {
      await this.materializer.ensureKoboSpanPositionsForBook(userId, bookId, kepub.file, kepub.ctx, { includeAllOrigins });
    }

    const annotations = await this.annotationSync.listActiveForBook(userId, bookId);
    const stateRows = await this.annotationSync.listStatesBySourceForBook(userId, 'kobo', bookId);
    const externalKeyByAnnotation = this.pickStableExternalKeys(stateRows);

    const positions = new Map<number, AnnotationPosition>();
    for (const row of await this.annotationSync.findPositions(
      annotations.map((annotation) => annotation.id),
      ['kobo_span'],
    )) {
      positions.set(row.annotationId, row);
    }

    const served: ServeAnnotation[] = [];
    const ackEntries: ServedAckPlan['entries'] = [];
    let skippedNoLocation = 0;

    for (const annotation of annotations) {
      const known = externalKeyByAnnotation.get(annotation.id);
      if (!known && !includeAllOrigins) continue;

      const position = positions.get(annotation.id);
      const location = this.usableLocation(position);
      if (!location) {
        if (known || includeAllOrigins) skippedNoLocation += 1;
        continue;
      }

      const externalKey = known?.externalKey ?? (await this.annotationSync.ensureExternalKey(annotation.id, 'kobo', () => randomUUID()));
      const deviceCreatedAt = await this.annotationSync.ensureDeviceCreatedAt(userId, bookId, annotation);
      served.push({
        externalKey,
        clientLastModifiedUtc: toIsoUtc(annotation.deviceUpdatedAt ?? deviceCreatedAt),
        colorHex: annotation.color,
        text: annotation.text,
        note: annotation.note,
        hasNote: annotation.note != null && annotation.note !== '',
        location,
      });
      ackEntries.push({
        annotationId: annotation.id,
        version: annotation.version,
        externalKey,
        externalCreatedAt: known?.externalCreatedAt ?? deviceCreatedAt,
      });
    }

    // Deletions propagate by omission: the device reconciles its local annotations
    // against the active set returned here, removing anything absent. Tombstone
    // flags do not work - the device keeps any annotation still present in the
    // response and ignores deleted markers.
    const tombstones = await this.annotationSync.listDeleteCandidates(userId, 'kobo', String(deviceId), bookId, 500);
    const servedAck: ServedAckPlan = { entries: ackEntries, tombstoneStateIds: tombstones.map((row) => row.state.id) };

    const etag = this.buildEtag(served.length, ackEntries);
    const notModified = this.etagMatches(ifNoneMatch, etag);

    this.logger.log(
      `[${GET_EVENT}] [end] userId=${userId} bookId=${bookId} deviceId=${deviceId} durationMs=${Date.now() - startedAtMs} served=${served.length} tombstones=${servedAck.tombstoneStateIds.length} skippedNoLocation=${skippedNoLocation} notModified=${notModified} - kobo annotations served`,
    );

    if (notModified) return { etag, notModified: true, servedAck };
    return {
      etag,
      notModified: false,
      servedAck,
      response: {
        annotations: served.map((row) => toKoboReadingServiceAnnotation(row)),
        nextPageOffsetToken: null,
      },
    };
  }

  /** Called on response flush; the only place served versions and tombstones get acked. */
  async markServedSeen(userId: number, deviceId: number, ack: ServedAckPlan): Promise<void> {
    await this.annotationSync.markServedApplied({
      userId,
      source: 'kobo',
      deviceId: String(deviceId),
      entries: ack.entries,
      tombstoneStateIds: ack.tombstoneStateIds,
    });
  }

  async patchContentAnnotations(userId: number, contentId: string, body: unknown, deviceId: number): Promise<void> {
    const startedAtMs = Date.now();
    const bookId = await this.resolveBookIdByContentId(userId, contentId);
    if (bookId === null) throw new NotFoundException(`Kobo content ${contentId} not found`);

    const operations = extractKoboAnnotationOperations(body);
    if (operations.length === 0) return;

    const upserts = operations.filter((operation): operation is IncomingUpsert => operation.kind === 'upsert');
    const deletes = operations.filter((operation) => operation.kind === 'delete');

    const file = await this.kepubContextService.resolveReaderFile(bookId);
    if (!file) throw new NotFoundException(`Kobo content ${contentId} has no reader file`);
    const kepub = await this.kepubContextService.resolveForBook(userId, bookId);

    const incoming = upserts.map((operation) => this.toIncomingAnnotation(operation));
    const result = await this.annotationSync.ingestDeviceAnnotations({
      userId,
      source: 'kobo',
      deviceId: String(deviceId),
      bookId,
      bookFileId: file.id,
      annotations: incoming,
    });

    const deletedCount = await this.annotationSync.applyDeviceDeletes({
      userId,
      source: 'kobo',
      deviceId: String(deviceId),
      bookId,
      deletes: deletes.map((operation) => ({ externalKey: operation.id })),
    });

    if (kepub.ok && upserts.length > 0) {
      await this.materializer.convertIncomingForBook(
        userId,
        bookId,
        kepub.file,
        kepub.ctx,
        upserts.map((operation) => operation.id),
      );
    }

    this.logger.log(
      `[${PATCH_EVENT}] [end] userId=${userId} bookId=${bookId} deviceId=${deviceId} durationMs=${Date.now() - startedAtMs} created=${result.created} updated=${result.updated} unchanged=${result.unchanged} deleted=${deletedCount} kepubReady=${kepub.ok} - kobo annotation operations applied`,
    );
  }

  async getChangedContentIds(userId: number, deviceId: number): Promise<string[]> {
    const settings = await this.settingsService.getSettings(userId);
    const bookIds = await this.annotationSync.listPendingKoboChangeBookIds(userId, String(deviceId), {
      includeAllOrigins: settings.syncBookOrbitAnnotationsToKobo,
      resolverVersion: this.koboSpanConverter.version,
    });
    if (bookIds.length === 0) return [];
    const identities = await this.bookIdentityService.findByBookIds(userId, bookIds);
    return [...identities.values()].map((identity) => identity.entitlementId);
  }

  private toIncomingAnnotation(operation: IncomingUpsert): IncomingDeviceAnnotation {
    const datetime = formatDeviceDatetime(operation.clientModifiedAt);
    const span = this.parseLocationSpans(operation.location);
    return {
      externalKey: operation.id,
      datetime,
      datetimeUpdated: datetime,
      color: operation.color,
      colorSpace: 'kobo',
      style: 'highlight',
      text: operation.text,
      note: operation.note,
      chapter: operation.chapterTitle,
      posFormat: 'kobo_span',
      pos0: span?.pos0 ?? 'invalid:0',
      pos1: span?.pos1 ?? null,
      posExtras: { koboLocation: operation.location },
    };
  }

  private parseLocationSpans(location: unknown): { pos0: string; pos1: string } | null {
    if (!location || typeof location !== 'object') return null;
    const span = (location as Record<string, unknown>).span;
    if (!span || typeof span !== 'object') return null;
    const raw = span as Record<string, unknown>;
    if (typeof raw.startPath !== 'string' || typeof raw.endPath !== 'string') return null;
    const startId = parseSpanSelector(raw.startPath);
    const endId = parseSpanSelector(raw.endPath);
    const startChar = typeof raw.startChar === 'number' && Number.isInteger(raw.startChar) && raw.startChar >= 0 ? raw.startChar : null;
    const endChar = typeof raw.endChar === 'number' && Number.isInteger(raw.endChar) && raw.endChar >= 0 ? raw.endChar : null;
    if (!startId || !endId || startChar == null || endChar == null) return null;
    return { pos0: serializeKoboSpanPos(startId, startChar), pos1: serializeKoboSpanPos(endId, endChar) };
  }

  private usableLocation(position: AnnotationPosition | undefined): unknown | null {
    if (!position || position.status === 'failed' || position.status === 'pending') return null;
    const location = (position.extras as { koboLocation?: unknown } | null)?.koboLocation;
    return location ?? null;
  }

  private pickStableExternalKeys(
    stateRows: { state: AnnotationSyncStateRow; annotation: AnnotationRow }[],
  ): Map<number, { externalKey: string; externalCreatedAt: string | null }> {
    const byAnnotation = new Map<number, { stateId: number; externalKey: string; externalCreatedAt: string | null }>();
    for (const { state } of stateRows) {
      const existing = byAnnotation.get(state.annotationId);
      if (!existing || state.id < existing.stateId) {
        byAnnotation.set(state.annotationId, { stateId: state.id, externalKey: state.externalKey, externalCreatedAt: state.externalCreatedAt });
      }
    }
    return new Map([...byAnnotation.entries()].map(([annotationId, entry]) => [annotationId, entry]));
  }

  private async resolveBookIdByContentId(userId: number, contentId: string): Promise<number | null> {
    if (!UUID_RE.test(contentId)) return null;
    try {
      return await this.bookIdentityService.resolveBookIdByEntitlementId(userId, contentId);
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(`[${GET_EVENT}] [fail] contentId=${sanitizeLogValue(contentId)} errorClass=${errorClass} - kobo content resolution failed`);
      return null;
    }
  }

  private buildEtag(count: number, entries: ServedAckPlan['entries']): string {
    const maxVersion = entries.reduce((max, entry) => Math.max(max, entry.version), 0);
    return `W/"${maxVersion}-${count}"`;
  }

  private etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
    if (!ifNoneMatch) return false;
    return ifNoneMatch
      .split(',')
      .map((value) => value.trim())
      .some((value) => value === etag);
  }
}

function toIsoUtc(deviceDatetime: string): string {
  return `${deviceDatetime.replace(' ', 'T')}Z`;
}
