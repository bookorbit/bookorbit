import { randomUUID } from 'crypto';

import { ConflictException, Optional, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AnnotationPosition, AnnotationRow, AnnotationSyncStateRow } from '../../../db/schema';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { AnnotationSyncService, formatDeviceDatetime, type IncomingDeviceAnnotation } from '../../annotation/annotation-sync.service';
import { AnnotationConversionService } from '../../annotation/annotation-conversion.service';
import { BookmarkSyncService } from '../../bookmark/bookmark-sync.service';
import { KoboSpanConverterService, serializeKoboSpanPos } from '../../position-converter/kobo-span-converter.service';
import { parseSpanSelector } from '../../position-converter/kobo-span.core';
import { KoboDeliveryService, isUnconfirmedReplacement } from './kobo-delivery.service';
import { KoboBookIdentityService } from './kobo-book-identity.service';
import { KoboSyncService } from './kobo-sync.service';
import { KoboAnnotationMaterializerService } from './kobo-annotation-materializer.service';
import { KoboKepubContextService } from './kobo-kepub-context.service';
import { KoboSettingsService } from './kobo-settings.service';
import type { KepubContextResult } from './kobo-kepub-context.service';
import { KoboBookmarkLinkRepository } from '../kobo-bookmark-link.repository';
import {
  extractKoboAnnotationOperations,
  toKoboReadingServiceAnnotation,
  toKoboReadingServiceDogear,
  type IncomingUpsert,
  type KoboReadingServiceAnnotationsResponse,
  type ServeAnnotation,
} from './kobo-annotation-payload';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GET_EVENT = 'kobo.annotation_get';
const PATCH_EVENT = 'kobo.annotation_patch';
const BOOKMARK_TITLE_MAX_LENGTH = 500;

type ReadyKepub = Extract<KepubContextResult, { ok: true }>;

/**
 * Raised when a content id the device asks about is not a BookOrbit book. Kobo devices route every
 * annotation request through us, including their own store content, so this is expected traffic
 * rather than a sync failure. The 404 matters: the device reconciles by omission (see the deletion
 * note in getContentAnnotations), so answering with an empty set would wipe its local annotations.
 */
export class KoboContentNotFoundException extends NotFoundException {
  constructor(contentId: string) {
    super(`Kobo content ${contentId} not found`);
  }
}

export interface ServedAckPlan {
  entries: { annotationId: number; version: number; externalKey: string; externalCreatedAt: string | null }[];
  tombstoneStateIds: number[];
  /** Bookmarks deleted in BookOrbit and left out of this response, which the device deletes. */
  removedBookmarkIds?: number[];
}

export interface KoboContentAnnotationsResult {
  bookId: number;
  etag: string;
  notModified: boolean;
  servedCount: number;
  tombstoneCount: number;
  response?: KoboReadingServiceAnnotationsResponse;
  servedAck: ServedAckPlan;
}

export interface KoboPatchAnnotationsResult {
  bookId: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  kepubReady: boolean;
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
    private readonly bookmarkSync: BookmarkSyncService,
    private readonly bookmarkLinks: KoboBookmarkLinkRepository,
    private readonly syncService: KoboSyncService,
    @Optional() private readonly deliveries?: KoboDeliveryService,
    @Optional() private readonly annotationConversion?: AnnotationConversionService,
  ) {}

  async getContentAnnotations(
    userId: number,
    contentId: string,
    deviceId: number,
    ifNoneMatch: string | undefined,
  ): Promise<KoboContentAnnotationsResult> {
    const startedAtMs = Date.now();
    const bookId = await this.resolveBookIdByContentId(userId, contentId);
    if (bookId === null) throw new KoboContentNotFoundException(contentId);

    const kepub = await this.kepubContextService.resolveForBook(userId, bookId, deviceId);
    try {
      const includeAllOrigins = kepub.settings?.syncBookOrbitAnnotationsToKobo ?? false;
      if (this.deliveries && !kepub.ok) throw new ConflictException({ code: 'KOBO_PRECISE_SYNC_UNAVAILABLE' });
      if (this.deliveries && kepub.ok) await this.annotationConversion?.ensureCfiPositionsForBook(userId, bookId, 200);
      if (kepub.ok) await this.convertLegacyDogears(userId, deviceId, bookId, kepub);
      if (kepub.ok && !this.deliveries) {
        await this.materializer.ensureKoboSpanPositionsForBook(userId, bookId, kepub.file, kepub.ctx, { includeAllOrigins });
      }

      const annotations = await this.annotationSync.listActiveForBook(userId, bookId);
      const stateRows = await this.annotationSync.listStatesBySourceForBook(userId, 'kobo', bookId);
      const externalKeyByAnnotation = this.pickStableExternalKeys(stateRows);

      const positions = new Map<number, AnnotationPosition>();
      for (const row of await this.annotationSync.findPositions(
        annotations.map((annotation) => annotation.id),
        ['kobo_span', 'cfi'],
      )) {
        positions.set(row.annotationId, row);
      }

      const allPositions = this.deliveries
        ? await this.annotationSync.findPositions(
            annotations.map((annotation) => annotation.id),
            ['cfi', 'kobo_span'],
          )
        : [];
      const renditionHash = kepub.ok && this.deliveries ? await this.koboSpanConverter.computeRenditionHash(kepub.ctx) : null;
      const served: ServeAnnotation[] = [];
      const ackEntries: ServedAckPlan['entries'] = [];
      let skippedNoLocation = 0;

      for (const annotation of annotations) {
        const known = externalKeyByAnnotation.get(annotation.id);
        if (!known && !includeAllOrigins) continue;

        const position = positions.get(annotation.id);
        let location = this.usableLocation(position);
        if (this.deliveries && kepub.ok) {
          const canonical = allPositions.find(
            (candidate) => candidate.annotationId === annotation.id && candidate.format === 'cfi' && candidate.status !== 'failed',
          );
          const raw = allPositions.find((candidate) => candidate.annotationId === annotation.id && candidate.format === 'kobo_span');
          const placed = raw && (raw.extras as { renditionHash?: string } | null)?.renditionHash === renditionHash ? this.usableLocation(raw) : null;
          location = placed;
          if (canonical?.pos0 && (!location || (raw?.extras as { sourceCfi?: string } | null)?.sourceCfi !== canonical.pos0)) {
            const converted = await this.koboSpanConverter.canonicalToKoboSpan({
              bookFileId: kepub.file.id,
              ctx: kepub.ctx,
              cfi: canonical.pos0,
              text: annotation.text || null,
              chapterTitle: annotation.chapterTitle,
            });
            location = converted.status === 'failed' ? null : (converted.location ?? null);
          }
          // The device deletes what it is not served, and clears a book's annotations when its download is
          // removed, so refusing the pull would leave them gone from the device. Where this copy cannot
          // place an annotation, the location already placed in it, then the one the device reported, stand in.
          if (!location && known) location = placed ?? (raw?.extras as { koboLocation?: unknown } | null)?.koboLocation ?? null;
          if (!location && known) throw new ConflictException({ code: 'KOBO_ANNOTATION_RENDITION_UNAVAILABLE' });
        }
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
      const dogears = await this.listServedDogears(userId, deviceId, bookId);
      const servedAck: ServedAckPlan = {
        entries: ackEntries,
        tombstoneStateIds: tombstones.map((row) => row.state.id),
        removedBookmarkIds: dogears.removedBookmarkIds,
      };

      const etag = this.buildEtag(served.length, ackEntries, renditionHash, dogears.served);
      const notModified = this.etagMatches(ifNoneMatch, etag);

      this.logger.log(
        `[${GET_EVENT}] [end] userId=${userId} bookId=${bookId} deviceId=${deviceId} durationMs=${Date.now() - startedAtMs} served=${served.length} tombstones=${servedAck.tombstoneStateIds.length} skippedNoLocation=${skippedNoLocation} notModified=${notModified} - kobo annotations served`,
      );

      if (notModified) {
        return { bookId, etag, notModified: true, servedAck, servedCount: served.length, tombstoneCount: servedAck.tombstoneStateIds.length };
      }
      return {
        bookId,
        etag,
        notModified: false,
        servedAck,
        servedCount: served.length,
        tombstoneCount: servedAck.tombstoneStateIds.length,
        response: {
          annotations: [...served.map((row) => toKoboReadingServiceAnnotation(row)), ...dogears.served.map((row) => toKoboReadingServiceDogear(row))],
          nextPageOffsetToken: null,
        },
      };
    } finally {
      if (kepub.ok) await kepub.release?.();
    }
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
    // A dogear left out of the response is deleted on the device, so its link has nothing left to track.
    await this.bookmarkLinks.deleteForBookmarks(userId, deviceId, ack.removedBookmarkIds ?? []);
  }

  async patchContentAnnotations(userId: number, contentId: string, body: unknown, deviceId: number): Promise<KoboPatchAnnotationsResult> {
    const startedAtMs = Date.now();
    const bookId = await this.resolveBookIdByContentId(userId, contentId);
    if (bookId === null) throw new KoboContentNotFoundException(contentId);

    const operations = extractKoboAnnotationOperations(body);
    if (operations.length === 0) return { bookId, created: 0, updated: 0, unchanged: 0, deleted: 0, kepubReady: false };

    const upserts = operations.filter((operation): operation is IncomingUpsert => operation.kind === 'upsert');
    const deletes = operations.filter((operation) => operation.kind === 'delete');

    const file = await this.kepubContextService.resolveReaderFile(bookId);
    if (!file) throw new NotFoundException(`Kobo content ${contentId} has no reader file`);
    const kepub = await this.kepubContextService.resolveForBook(userId, bookId, deviceId);

    try {
      if (kepub.ok) await this.convertLegacyDogears(userId, deviceId, bookId, kepub);
      const dogears = kepub.ok
        ? await this.ingestDogears(
            userId,
            deviceId,
            bookId,
            kepub,
            upserts.filter((operation) => operation.type === 'dogear'),
          )
        : { created: 0, updated: 0, placed: new Set<string>() };
      const annotationUpserts = upserts.filter((operation) => !dogears.placed.has(operation.id));
      const removedBookmarks = await this.removeDeviceBookmarks(
        userId,
        deviceId,
        deletes.map((operation) => operation.id),
      );

      const delivery = await this.deliveries?.current(userId, deviceId, bookId);
      const incoming = annotationUpserts.map((operation) => {
        const annotation = this.toIncomingAnnotation(operation);
        annotation.posExtras = {
          ...(annotation.posExtras ?? {}),
          deviceId,
          deliveryId: delivery?.id ?? null,
          sourceRevision: delivery?.metadata.sourceRevision ?? null,
          artifactId: delivery?.metadata.artifactId ?? null,
          uncertainDelivery: !kepub.ok || (!!delivery && isUnconfirmedReplacement(delivery)),
        };
        return annotation;
      });
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
        deletes: deletes.filter((operation) => !removedBookmarks.keys.has(operation.id)).map((operation) => ({ externalKey: operation.id })),
      });

      if (kepub.ok && annotationUpserts.length > 0) {
        await this.materializer.convertIncomingForBook(
          userId,
          bookId,
          kepub.file,
          kepub.ctx,
          annotationUpserts.map((operation) => operation.id),
        );
      }

      this.logger.log(
        `[${PATCH_EVENT}] [end] userId=${userId} bookId=${bookId} deviceId=${deviceId} durationMs=${Date.now() - startedAtMs} created=${result.created} updated=${result.updated} unchanged=${result.unchanged} deleted=${deletedCount} kepubReady=${kepub.ok} - kobo annotation operations applied`,
      );
      return {
        bookId,
        created: result.created + dogears.created,
        updated: result.updated + dogears.updated,
        unchanged: result.unchanged,
        deleted: deletedCount + removedBookmarks.removed,
        kepubReady: kepub.ok,
      };
    } finally {
      if (kepub.ok) await kepub.release?.();
    }
  }

  async getChangedContentIds(userId: number, deviceId: number): Promise<string[]> {
    const settings = await this.settingsService.getSettings(userId);
    const annotationBookIds = await this.annotationSync.listPendingKoboChangeBookIds(userId, String(deviceId), {
      includeAllOrigins: settings.syncBookOrbitAnnotationsToKobo,
      resolverVersion: this.koboSpanConverter.version,
    });
    const changed = [...new Set([...annotationBookIds, ...(await this.bookmarkLinks.findBookIdsWithRemovedBookmarks(userId, deviceId))])];
    // A device can only fetch and acknowledge annotations for books it holds. Another device's
    // annotations on a book this one never received stay unserved, so reporting them would list the
    // book on every sync, and a device busy with those leaves the fetch for a real change detached
    // from its sync, where it is never applied.
    const bookIds = await this.syncService.findBookIdsOnDevice(userId, deviceId, changed);
    if (bookIds.length === 0) return [];
    const identities = await this.bookIdentityService.findByBookIds(userId, bookIds);
    return [...identities.values()].map((identity) => identity.entitlementId);
  }

  /**
   * Lands the device's dogears as bookmarks. One the book cannot place stays on the annotation path,
   * where it is still served back, since the device deletes whatever it is not served.
   */
  private async ingestDogears(
    userId: number,
    deviceId: number,
    bookId: number,
    kepub: ReadyKepub,
    dogears: IncomingUpsert[],
  ): Promise<{ created: number; updated: number; placed: Set<string> }> {
    const placed = new Set<string>();
    let created = 0;
    let updated = 0;
    if (dogears.length === 0) return { created, updated, placed };
    const known = new Set(
      (
        await this.bookmarkLinks.findByExternalKeys(
          userId,
          deviceId,
          dogears.map((dogear) => dogear.id),
        )
      ).map((link) => link.externalKey),
    );
    for (const dogear of dogears) {
      if (known.has(dogear.id)) {
        await this.bookmarkLinks.updateLocation(userId, deviceId, dogear.id, dogear.location);
        placed.add(dogear.id);
        updated += 1;
      } else if (
        await this.landBookmark(userId, deviceId, bookId, kepub, dogear.id, dogear.location, this.bookmarkTitle(dogear.note, dogear.chapterTitle))
      ) {
        placed.add(dogear.id);
        created += 1;
      }
    }
    return { created, updated, placed };
  }

  /**
   * Dogears uploaded before Kobo bookmarks existed were stored as empty highlights. Each one this
   * device holds moves to a bookmark under the same id, so the device keeps it as a dogear.
   */
  private async convertLegacyDogears(userId: number, deviceId: number, bookId: number, kepub: ReadyKepub): Promise<void> {
    const legacy = (await this.annotationSync.listStatesBySourceForBook(userId, 'kobo', bookId)).filter(
      ({ state, annotation }) =>
        state.deviceId === String(deviceId) && annotation.origin === 'kobo' && annotation.text === '' && annotation.deletedAt === null,
    );
    if (legacy.length === 0) return;
    const positions = await this.annotationSync.findPositions(
      legacy.map(({ annotation }) => annotation.id),
      ['kobo_span'],
    );
    const locations = new Map(
      positions.map((position) => [position.annotationId, (position.extras as { koboLocation?: unknown } | null)?.koboLocation]),
    );
    const converted: string[] = [];
    for (const { state, annotation } of legacy) {
      const location = locations.get(annotation.id);
      if (!location) continue;
      const title = this.bookmarkTitle(annotation.note, annotation.chapterTitle);
      if (await this.landBookmark(userId, deviceId, bookId, kepub, state.externalKey, location, title)) converted.push(state.externalKey);
    }
    if (converted.length === 0) return;
    await this.annotationSync.applyDeviceDeletes({
      userId,
      source: 'kobo',
      deviceId: String(deviceId),
      bookId,
      deletes: converted.map((externalKey) => ({ externalKey })),
    });
    this.logger.log(
      `[${PATCH_EVENT}] userId=${userId} bookId=${bookId} deviceId=${deviceId} converted=${converted.length} - kobo dogears moved from highlights to bookmarks`,
    );
  }

  private async landBookmark(
    userId: number,
    deviceId: number,
    bookId: number,
    kepub: ReadyKepub,
    externalKey: string,
    location: unknown,
    title: string,
  ): Promise<boolean> {
    const point = await this.dogearToCanonical(kepub, location);
    if (!point) return false;
    const landed = await this.bookmarkSync.upsertFromDevice(userId, bookId, {
      cfi: point.cfi,
      title,
      devicePos: point.xpointer,
      pageno: null,
      origin: 'kobo',
    });
    if (!landed) return false;
    await this.bookmarkLinks.link({ bookmarkId: landed.row.id, userId, deviceId, bookId, externalKey, location });
    return true;
  }

  private async dogearToCanonical(kepub: ReadyKepub, location: unknown): Promise<{ cfi: string; xpointer: string } | null> {
    const span = location && typeof location === 'object' ? (location as { span?: unknown }).span : null;
    if (!span || typeof span !== 'object') return null;
    const { chapterFilename, startPath } = span as { chapterFilename?: unknown; startPath?: unknown };
    const spanId = typeof startPath === 'string' ? parseSpanSelector(startPath) : null;
    if (typeof chapterFilename !== 'string' || !spanId) return null;
    const outcome = await this.koboSpanConverter.koboBookmarkToPositions({ bookFileId: kepub.file.id, ctx: kepub.ctx, chapterFilename, spanId });
    return outcome.status === 'failed' || !outcome.cfi || !outcome.xpointer ? null : { cfi: outcome.cfi, xpointer: outcome.xpointer };
  }

  /** A device delete of a dogear deletes its bookmark everywhere, as a device delete of a highlight does. */
  private async removeDeviceBookmarks(userId: number, deviceId: number, externalKeys: string[]): Promise<{ removed: number; keys: Set<string> }> {
    const links = await this.bookmarkLinks.findByExternalKeys(userId, deviceId, externalKeys);
    if (links.length === 0) return { removed: 0, keys: new Set() };
    const bookmarkIds = links.map((link) => link.bookmarkId);
    const removed = await this.bookmarkSync.tombstone(userId, bookmarkIds);
    await this.bookmarkLinks.deleteForBookmarks(userId, deviceId, bookmarkIds);
    return { removed, keys: new Set(links.map((link) => link.externalKey)) };
  }

  private async listServedDogears(
    userId: number,
    deviceId: number,
    bookId: number,
  ): Promise<{ served: { externalKey: string; clientLastModifiedUtc: string; location: unknown }[]; removedBookmarkIds: number[] }> {
    const served: { externalKey: string; clientLastModifiedUtc: string; location: unknown }[] = [];
    const removedBookmarkIds: number[] = [];
    for (const link of await this.bookmarkLinks.findForBook(userId, deviceId, bookId)) {
      if (link.bookmarkDeletedAt) {
        removedBookmarkIds.push(link.bookmarkId);
        continue;
      }
      served.push({
        externalKey: link.externalKey,
        clientLastModifiedUtc: link.bookmarkUpdatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        location: link.location,
      });
    }
    return { served, removedBookmarkIds };
  }

  /** A dogear has no text of its own; its note, then its chapter, names it, as KOReader's do. */
  private bookmarkTitle(note: string | null, chapterTitle: string | null): string {
    return (note?.trim() || chapterTitle?.trim() || 'Bookmark').slice(0, BOOKMARK_TITLE_MAX_LENGTH);
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

  private buildEtag(
    count: number,
    entries: ServedAckPlan['entries'],
    renditionHash?: string | null,
    dogears: { clientLastModifiedUtc: string }[] = [],
  ): string {
    const maxVersion = entries.reduce((max, entry) => Math.max(max, entry.version), 0);
    const bookmarks = dogears.length
      ? `-b${dogears.length}-${dogears.reduce((max, row) => (row.clientLastModifiedUtc > max ? row.clientLastModifiedUtc : max), '')}`
      : '';
    return `W/"${maxVersion}-${count}${renditionHash ? `-${renditionHash}` : ''}${bookmarks}"`;
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
