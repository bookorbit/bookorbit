import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import type { AnnotationPosition, AnnotationRow } from '../../db/schema';
import { drawerFromStyle, koreaderColorFromHex } from '../annotation/annotation-style-map';
import { AnnotationSyncService, formatDeviceDatetime, type IncomingDeviceAnnotation, type IngestResult } from '../annotation/annotation-sync.service';
import { PositionConverterService } from '../position-converter/position-converter.service';
import type { AnnotationExchangeAckDto, AnnotationExchangeDto, AnnotationPendingDto, ExchangeBookDto } from './dto';
import type { KoreaderAnnotationDto } from './dto';
import { KoreaderRepository } from './koreader.repository';
import { exchangeDeviceId } from './koreader-exchange-device';

const EXCHANGE_EVENT = 'koreader.annotation_exchange';
const ACK_EVENT = 'koreader.annotation_exchange_ack';
const RESET_EVENT = 'koreader.annotation_copy_reset';
const PENDING_EVENT = 'koreader.annotation_pending';
const MAX_CHANGES_PER_REQUEST = 50;
const PUSH_DOWN_PAGE = 100;
const CONVERSION_BUDGET_PER_REQUEST = 20;
const DEVICE_CLOCK_TOLERANCE_MS = 60_000;
const DEVICE_DATETIME_FORMAT = 'yyyy-MM-dd HH:mm:ss';

type DevicePositionsByFormat = { pdf?: AnnotationPosition; xpointer?: AnnotationPosition; cfi?: AnnotationPosition };

export function parseKoreaderSourceCreatedAt(datetime: string, timeZone: string): Date | null {
  try {
    const parsed = fromZonedTime(datetime, timeZone);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatInTimeZone(parsed, timeZone, DEVICE_DATETIME_FORMAT) === datetime ? parsed : null;
  } catch {
    return null;
  }
}

export interface ExchangeAddEntry {
  serverId: number;
  version: number;
  datetime: string;
  datetimeUpdated: string | null;
  drawer: string;
  color: string;
  text: string;
  note: string | null;
  chapter: string | null;
  posFormat: 'xpointer' | 'pdf';
  pos0: string;
  pos1: string | null;
  pageno: number | null;
}

export interface ExchangeEditEntry {
  serverId: number;
  version: number;
  key: string;
  datetime: string | null;
  datetimeUpdated: string;
  drawer: string;
  color: string;
  text: string;
  note: string | null;
  chapter: string | null;
  pos0?: string;
  pos1?: string | null;
}

export interface ExchangeDeleteEntry {
  serverId: number;
  key: string;
  datetime: string | null;
}

export interface ExchangeBookResult {
  hash: string;
  bookId: number;
  applied: IngestResult & { deviceDeleted: number };
  toApply: {
    add: ExchangeAddEntry[];
    edit: ExchangeEditEntry[];
    delete: ExchangeDeleteEntry[];
  };
  more: boolean;
  skippedNoPosition: number;
}

export interface ExchangeResponse {
  results: ExchangeBookResult[];
  unmatched: string[];
}

export interface ExchangeAckResponse {
  results: { hash: string; acked: number }[];
  unmatched: string[];
}

@Injectable()
export class KoreaderAnnotationExchangeService {
  private readonly logger = new Logger(KoreaderAnnotationExchangeService.name);

  constructor(
    private readonly koreaderRepo: KoreaderRepository,
    private readonly annotationSync: AnnotationSyncService,
    private readonly positionConverter: PositionConverterService,
  ) {}

  async exchange(user: RequestUser, dto: AnnotationExchangeDto): Promise<ExchangeResponse> {
    const startedAtMs = Date.now();
    const totalChanges = dto.books.reduce((sum, book) => sum + book.changes.length, 0);
    this.logger.log(
      `[${EXCHANGE_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} books=${dto.books.length} changes=${totalChanges} - annotation exchange started`,
    );

    try {
      if (totalChanges > MAX_CHANGES_PER_REQUEST) {
        throw new BadRequestException(`Too many annotation changes in one request (max ${MAX_CHANGES_PER_REQUEST})`);
      }

      const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
      const hashes = [...new Set(dto.books.map((book) => book.hash.toLowerCase()))];
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, user.id);
      const deviceClockOffsetMs = this.deviceClockOffsetMs(dto.deviceTime);
      const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');

      const results: ExchangeBookResult[] = [];
      const unmatched: string[] = [];
      let pushedTotal = 0;

      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match || match.progressCompatible === false) {
          unmatched.push(hash);
          continue;
        }
        const result = await this.exchangeBook(
          user.id,
          exchangeDeviceId(dto.deviceId, hash),
          hash,
          match.bookId,
          match.bookFileId,
          book,
          deviceClockOffsetMs,
          timeZone,
        );
        pushedTotal += result.toApply.add.length + result.toApply.edit.length + result.toApply.delete.length;
        results.push(result);
      }

      this.logger.log(
        `[${EXCHANGE_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} books=${results.length} pushed=${pushedTotal} unmatched=${unmatched.length} - annotation exchange completed`,
      );
      return { results, unmatched };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${EXCHANGE_EVENT}] [fail] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - annotation exchange failed`,
      );
      throw error;
    }
  }

  /**
   * The books among `hashes` with something waiting for this device. A sweep only exchanges books
   * whose sidecars changed, so without this a highlight made elsewhere never reaches a closed book.
   */
  async pendingBooks(user: RequestUser, dto: AnnotationPendingDto): Promise<{ pending: string[] }> {
    const startedAtMs = Date.now();
    const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
    const hashes = [...new Set(dto.hashes.map((hash) => hash.toLowerCase()))];
    const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, user.id);
    const pairs = hashes.flatMap((hash) => {
      const match = matches.get(hash);
      if (!match || match.progressCompatible === false) return [];
      return [{ hash, deviceId: exchangeDeviceId(dto.deviceId, hash), bookId: match.bookId }];
    });
    const pendingKeys = await this.annotationSync.findPendingDeviceBooks(
      user.id,
      'koreader',
      pairs.map(({ deviceId, bookId }) => ({ deviceId, bookId })),
      'xpointer',
      this.positionConverter.version,
    );
    const pending = pairs.filter((pair) => pendingKeys.has(`${pair.deviceId}:${pair.bookId}`)).map((pair) => pair.hash);
    this.logger.log(
      `[${PENDING_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} asked=${hashes.length} matched=${pairs.length} pending=${pending.length} - pending annotation books listed`,
    );
    return { pending };
  }

  async exchangeAck(user: RequestUser, dto: AnnotationExchangeAckDto): Promise<ExchangeAckResponse> {
    const startedAtMs = Date.now();
    try {
      const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
      const hashes = [...new Set(dto.books.map((book) => book.hash.toLowerCase()))];
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, user.id);

      const results: { hash: string; acked: number }[] = [];
      const unmatched: string[] = [];
      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match || match.progressCompatible === false) {
          unmatched.push(hash);
          continue;
        }
        const { acked } = await this.annotationSync.applyExchangeAck({
          userId: user.id,
          source: 'koreader',
          deviceId: exchangeDeviceId(dto.deviceId, hash),
          bookFileId: match.bookFileId,
          bookId: match.bookId,
          applied: book.applied.map((entry) => ({
            serverId: entry.serverId,
            version: entry.version,
            status: entry.status,
            verified: entry.verified,
            corrected: entry.corrected,
            pos0: entry.pos0 ?? null,
            pos1: entry.pos1 ?? null,
            pageno: entry.pageno ?? null,
            datetimeUpdated: entry.datetimeUpdated,
          })),
          deleted: book.deleted,
          converterVersion: this.positionConverter.version,
        });
        results.push({ hash, acked });
      }

      this.logger.log(
        `[${ACK_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} books=${results.length} unmatched=${unmatched.length} - annotation exchange ack applied`,
      );
      return { results, unmatched };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${ACK_EVENT}] [fail] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - annotation exchange ack failed`,
      );
      throw error;
    }
  }

  /**
   * KOReader datetimes are device-local wall clock with no timezone; minting them
   * from server UTC time can land in the device's future, which freezes the
   * device-side upload watermark. The offset shifts mints into the device frame.
   */
  private deviceClockOffsetMs(deviceTime: string | undefined): number | null {
    if (!deviceTime) return null;
    const parsed = Date.parse(`${deviceTime.replace(' ', 'T')}Z`);
    return Number.isNaN(parsed) ? null : parsed - Date.now();
  }

  /**
   * A device-local datetime placed on the server clock. A datetime ahead of the device's own clock
   * is not in its frame (a Kobo-made highlight carries the Kobo's UTC time), so it gives no time.
   */
  private deviceEditTime(datetime: string, deviceClockOffsetMs: number | null): Date | null {
    if (deviceClockOffsetMs === null) return null;
    const local = Date.parse(`${datetime.replace(' ', 'T')}Z`);
    if (Number.isNaN(local)) return null;
    const placed = local - deviceClockOffsetMs;
    if (placed > Date.now() + DEVICE_CLOCK_TOLERANCE_MS) return null;
    return new Date(Math.min(placed, Date.now()));
  }

  private async exchangeBook(
    userId: number,
    deviceId: string,
    hash: string,
    bookId: number,
    bookFileId: number,
    book: ExchangeBookDto,
    deviceClockOffsetMs: number | null,
    timeZone: string,
  ): Promise<ExchangeBookResult> {
    const presentKeys = book.keys.map((entry) => ({
      ...entry,
      sourceCreatedAt: parseKoreaderSourceCreatedAt(entry.dt, timeZone),
    }));
    // Judged before ingest: a highlight made in a fresh copy would otherwise be the one
    // key it shares with the server and hide that everything else is missing.
    const lostCopy =
      book.sidecarState === 'new' ||
      (book.keysComplete &&
        book.sidecarState === undefined &&
        (await this.annotationSync.isLostDeviceCopy({ userId, source: 'koreader', deviceId, bookId, presentKeys })));
    if (lostCopy) {
      const reoffered = await this.annotationSync.reofferDeviceCopy({ userId, source: 'koreader', deviceId, bookId });
      this.logger.log(
        `[${RESET_EVENT}] [end] userId=${userId} bookId=${bookId} deviceId=${deviceId.slice(0, 8)} reason=${book.sidecarState === 'new' ? 'device' : 'missing_keys'} reoffered=${reoffered} - device copy treated as new; nothing deleted`,
      );
    }

    const ingest = await this.annotationSync.ingestDeviceAnnotations({
      userId,
      source: 'koreader',
      deviceId,
      bookId,
      bookFileId,
      annotations: book.changes.map((change) => this.toIncoming(change, timeZone, deviceClockOffsetMs)),
      ...(book.keysComplete && !lostCopy ? { presentKeys: book.keys.map((entry) => entry.k) } : {}),
    });

    let deviceDeleted = 0;
    if (book.keysComplete && !lostCopy) {
      deviceDeleted = await this.annotationSync.detectDeviceDeletions({ userId, source: 'koreader', deviceId, bookId, presentKeys });
    }

    const pushDown = await this.annotationSync.computePushDown(userId, 'koreader', deviceId, bookId, PUSH_DOWN_PAGE);

    const deleteEntries: ExchangeDeleteEntry[] = pushDown.deletes.map(({ state, annotation }) => ({
      serverId: annotation.id,
      key: state.externalKey,
      datetime: state.externalCreatedAt ?? annotation.deviceCreatedAt,
    }));

    // A closed sidecar can be replaced before the reader verifies it. Retry its
    // complete range as an idempotent add so a missing local entry can recover.
    const verifiedEdits = pushDown.edits.filter(({ state }) => state.lastAppliedVersion > 0);
    const unverifiedAdds = pushDown.edits.filter(({ state }) => state.lastAppliedVersion === 0).map(({ annotation }) => annotation);
    const editPositions = await this.loadDevicePositions(verifiedEdits.map(({ annotation }) => annotation));
    const epubEdits = verifiedEdits.filter(({ annotation }) => {
      const positions = editPositions.get(annotation.id);
      return positions?.xpointer != null || positions?.cfi != null;
    });
    const projectedEditIds = new Set(epubEdits.map(({ annotation }) => annotation.id));
    const built = await this.buildAddEntries(
      userId,
      bookId,
      bookFileId,
      [...epubEdits.map(({ annotation }) => annotation), ...unverifiedAdds, ...pushDown.adds],
      deviceClockOffsetMs,
    );
    const projectedEdits = new Map(built.addEntries.filter((entry) => projectedEditIds.has(entry.serverId)).map((entry) => [entry.serverId, entry]));
    const addEntries = built.addEntries.filter((entry) => !projectedEditIds.has(entry.serverId));
    const editEntries: ExchangeEditEntry[] = verifiedEdits
      .filter(({ annotation }) => !projectedEditIds.has(annotation.id) || projectedEdits.has(annotation.id))
      .map(({ state, annotation }) => ({
        serverId: annotation.id,
        version: annotation.version,
        key: state.externalKey,
        datetime: annotation.deviceCreatedAt,
        datetimeUpdated: this.mintEditDatetime(annotation, deviceClockOffsetMs),
        drawer: drawerFromStyle(annotation.style),
        color: koreaderColorFromHex(annotation.color),
        text: annotation.text,
        note: annotation.note,
        chapter: annotation.chapterTitle,
        ...(projectedEdits.get(annotation.id)?.pos0
          ? { pos0: projectedEdits.get(annotation.id)!.pos0, pos1: projectedEdits.get(annotation.id)!.pos1 }
          : {}),
      }));

    return {
      hash,
      bookId,
      applied: { ...ingest, deviceDeleted },
      toApply: { add: addEntries, edit: editEntries, delete: deleteEntries },
      more: pushDown.more || built.conversionDeferred,
      skippedNoPosition: built.skippedNoPosition,
    };
  }

  /**
   * Builds the add entries for one push-down page. Positions for the whole page are read
   * in one query, and device identity datetimes are minted in one batch, so the page
   * costs a bounded number of queries instead of several per annotation. Annotations
   * whose CFI position needs converting share a bounded conversion budget.
   */
  private async buildAddEntries(
    userId: number,
    bookId: number,
    bookFileId: number,
    adds: AnnotationRow[],
    deviceClockOffsetMs: number | null,
  ): Promise<{ addEntries: ExchangeAddEntry[]; skippedNoPosition: number; conversionDeferred: boolean }> {
    if (adds.length === 0) return { addEntries: [], skippedNoPosition: 0, conversionDeferred: false };

    const positions = await this.loadDevicePositions(adds);
    const converterVersion = this.positionConverter.version;

    const pushable: { annotation: AnnotationRow; position: Pick<AnnotationPosition, 'format' | 'pos0' | 'pos1' | 'extras'> }[] = [];
    const convertible: AnnotationRow[] = [];
    let conversionBudget = CONVERSION_BUDGET_PER_REQUEST;
    let skippedNoPosition = 0;
    let conversionDeferred = false;

    for (const annotation of adds) {
      const formats = positions.get(annotation.id);
      // KOReader's apply path is reflowable/xpointer-only and rejects PDF adds. A PDF-only
      // annotation (a web highlight in a PDF with no EPUB anchor) has nothing to send, so skip
      // it rather than fall into the CFI->xpointer path, which would store a failed xpointer and
      // inflate the needs-review count. A mixed PDF+CFI annotation still converts its CFI below.
      const position = formats?.xpointer ?? null;
      const cfiConvertible = formats?.cfi?.pos0 != null;
      if (!position && formats?.pdf && !cfiConvertible) {
        skippedNoPosition += 1;
        continue;
      }
      const differentFile = position?.bookFileId != null && position.bookFileId !== bookFileId;
      const usable =
        position?.pos0 != null &&
        !differentFile &&
        position.status !== 'failed' &&
        (position.converterVersion == null || position.converterVersion >= converterVersion);
      const retryable = differentFile || position == null || position.converterVersion == null || position.converterVersion < converterVersion;

      if (!usable) {
        if (conversionBudget > 0 && retryable) {
          conversionBudget -= 1;
          convertible.push(annotation);
        } else {
          conversionDeferred ||= retryable;
          skippedNoPosition += 1;
        }
        continue;
      }
      pushable.push({ annotation, position });
    }

    const converted = await this.convertCfiPositions(userId, bookFileId, convertible, positions);
    skippedNoPosition += convertible.length - converted.size;
    for (const annotation of convertible) {
      const position = converted.get(annotation.id);
      if (position) pushable.push({ annotation, position });
    }

    // Mint in the original push-down order so the values match what a per-annotation
    // loop would have assigned, and only for annotations that actually reached the device
    // or stored a usable converted position.
    const needsIdentity = adds.filter(
      (annotation) => converted.has(annotation.id) || pushable.some((entry) => entry.annotation.id === annotation.id),
    );
    const datetimes = await this.annotationSync.ensureDeviceCreatedAtMany(userId, bookId, needsIdentity, deviceClockOffsetMs ?? 0);

    const addEntries = pushable.map(({ annotation, position }) => ({
      serverId: annotation.id,
      version: annotation.version,
      datetime: datetimes.get(annotation.id)!,
      datetimeUpdated: this.addDatetimeUpdated(annotation, datetimes.get(annotation.id)!, deviceClockOffsetMs),
      drawer: drawerFromStyle(annotation.style),
      color: koreaderColorFromHex(annotation.color),
      text: annotation.text,
      note: annotation.note,
      chapter: annotation.chapterTitle,
      posFormat: position.format as 'xpointer' | 'pdf',
      pos0: position.pos0!,
      pos1: position.pos1,
      pageno: ((position.extras as { pageno?: number } | null)?.pageno ?? null) as number | null,
    }));

    return { addEntries, skippedNoPosition, conversionDeferred: conversionDeferred && converted.size > 0 };
  }

  private async loadDevicePositions(adds: AnnotationRow[]): Promise<Map<number, DevicePositionsByFormat>> {
    if (adds.length === 0) return new Map();
    const rows = await this.annotationSync.findPositions(
      adds.map((annotation) => annotation.id),
      ['pdf', 'xpointer', 'cfi'],
    );
    const byAnnotation = new Map<number, DevicePositionsByFormat>();
    for (const row of rows) {
      const entry = byAnnotation.get(row.annotationId) ?? {};
      if (row.format === 'pdf' || row.format === 'xpointer' || row.format === 'cfi') entry[row.format] = row;
      byAnnotation.set(row.annotationId, entry);
    }
    return byAnnotation;
  }

  /** Returns the annotations whose conversion stored a usable xpointer position. */
  private async convertCfiPositions(
    userId: number,
    bookFileId: number,
    annotationRows: AnnotationRow[],
    positions: Map<number, DevicePositionsByFormat>,
  ): Promise<Map<number, Pick<AnnotationPosition, 'format' | 'pos0' | 'pos1' | 'extras'>>> {
    const converted = new Map<number, Pick<AnnotationPosition, 'format' | 'pos0' | 'pos1' | 'extras'>>();
    for (const annotation of annotationRows) {
      const formats = positions.get(annotation.id);
      let cfi = formats?.cfi?.pos0;
      const source = formats?.xpointer;
      if (!cfi && source?.bookFileId != null && source.pos0 && source.pos1) {
        const outcome = await this.positionConverter.xpointerToCfi({
          bookFileId: source.bookFileId,
          pos0: source.pos0,
          pos1: source.pos1,
          text: annotation.text || null,
        });
        if (outcome.status !== 'failed' && outcome.cfi) cfi = outcome.cfi;
      }
      if (!cfi) continue;

      const outcome = await this.positionConverter.cfiToXpointer({
        bookFileId,
        cfi,
        text: annotation.text || null,
      });
      if (outcome.status === 'failed' || !outcome.pos0 || !outcome.pos1) continue;

      await this.annotationSync.upsertGeneratedPosition({
        annotationId: annotation.id,
        userId,
        bookFileId,
        format: 'xpointer',
        pos0: outcome.pos0,
        pos1: outcome.pos1,
        status: 'pending',
        converterVersion: this.positionConverter.version,
        extras: outcome.chapterIndex != null ? { chapterIndex: outcome.chapterIndex, converterStatus: outcome.status } : null,
      });
      converted.set(annotation.id, {
        format: 'xpointer',
        pos0: outcome.pos0,
        pos1: outcome.pos1,
        extras: outcome.chapterIndex != null ? { chapterIndex: outcome.chapterIndex } : null,
      });
    }
    return converted;
  }

  /**
   * datetime_updated pushed to the device must be ahead of any device edit we already
   * ingested, or the device-side dedup would treat the pushed edit as stale. A stored time
   * from another device's clock is no such edit and is not compared.
   */
  private mintEditDatetime(annotation: AnnotationRow, deviceClockOffsetMs: number | null): string {
    const candidate = formatDeviceDatetime(new Date(annotation.updatedAt.getTime() + (deviceClockOffsetMs ?? 0)));
    const stored = annotation.deviceUpdatedAt;
    if (stored && stored >= candidate && !this.isAheadOfDevice(stored, deviceClockOffsetMs)) {
      const bumped = new Date(`${stored.replace(' ', 'T')}Z`);
      bumped.setUTCSeconds(bumped.getUTCSeconds() + 1);
      return formatDeviceDatetime(bumped);
    }
    return candidate;
  }

  /**
   * An add carries the row's last device edit time. A time from another device's clock
   * (a Kobo writes UTC) can sit hours ahead of this device, and KOReader then re-sends the
   * row on every exchange until its own clock catches up, so such rows get a time minted
   * in this device's frame from the last content change instead. Without a reported
   * clock there is no frame to check against.
   */
  private addDatetimeUpdated(annotation: AnnotationRow, datetime: string, deviceClockOffsetMs: number | null): string | null {
    if (deviceClockOffsetMs === null) return annotation.deviceUpdatedAt;
    const reference = annotation.deviceUpdatedAt ?? datetime;
    if (!this.isAheadOfDevice(reference, deviceClockOffsetMs)) return annotation.deviceUpdatedAt;
    const changedAt = Math.min((annotation.contentUpdatedAt ?? annotation.updatedAt).getTime(), Date.now());
    return formatDeviceDatetime(new Date(changedAt + deviceClockOffsetMs));
  }

  private isAheadOfDevice(datetime: string, deviceClockOffsetMs: number | null): boolean {
    if (deviceClockOffsetMs === null) return false;
    const local = Date.parse(`${datetime.replace(' ', 'T')}Z`);
    return !Number.isNaN(local) && local - deviceClockOffsetMs > Date.now() + DEVICE_CLOCK_TOLERANCE_MS;
  }

  private toIncoming(change: KoreaderAnnotationDto, timeZone: string, deviceClockOffsetMs: number | null): IncomingDeviceAnnotation {
    return {
      datetime: change.datetime,
      sourceCreatedAt: parseKoreaderSourceCreatedAt(change.datetime, timeZone),
      datetimeUpdated: change.datetimeUpdated ?? null,
      editedAt: this.deviceEditTime(change.datetimeUpdated ?? change.datetime, deviceClockOffsetMs),
      drawer: change.drawer,
      color: change.color ?? null,
      text: change.text ?? null,
      note: change.note ?? null,
      chapter: change.chapter ?? null,
      pageno: change.pageno ?? null,
      posFormat: change.posFormat as IncomingDeviceAnnotation['posFormat'],
      pos0: change.pos0,
      pos1: change.pos1 ?? null,
    };
  }
}
