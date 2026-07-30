import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AnnotationPosition, AnnotationRow } from '../../db/schema';
import { drawerFromStyle, koreaderColorFromHex } from '../annotation/annotation-style-map';
import { AnnotationSyncService, formatDeviceDatetime, type IncomingDeviceAnnotation, type IngestResult } from '../annotation/annotation-sync.service';
import { PositionConverterService } from '../position-converter/position-converter.service';
import type { AnnotationExchangeAckDto, AnnotationExchangeDto, ExchangeBookDto } from './dto';
import type { KoreaderAnnotationDto } from './dto';
import { KoreaderRepository } from './koreader.repository';

const EXCHANGE_EVENT = 'koreader.annotation_exchange';
const ACK_EVENT = 'koreader.annotation_exchange_ack';
const MAX_CHANGES_PER_REQUEST = 50;
const PUSH_DOWN_PAGE = 100;
const CONVERSION_BUDGET_PER_REQUEST = 20;

type DevicePositionsByFormat = { pdf?: AnnotationPosition; xpointer?: AnnotationPosition; cfi?: AnnotationPosition };

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

      const results: ExchangeBookResult[] = [];
      const unmatched: string[] = [];
      let pushedTotal = 0;

      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }
        const result = await this.exchangeBook(user.id, dto.deviceId, hash, match.bookId, match.bookFileId, book, deviceClockOffsetMs);
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
        if (!match) {
          unmatched.push(hash);
          continue;
        }
        const { acked } = await this.annotationSync.applyExchangeAck({
          userId: user.id,
          source: 'koreader',
          deviceId: dto.deviceId,
          bookFileId: match.bookFileId,
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
  private deviceClockOffsetMs(deviceTime: string | undefined): number {
    if (!deviceTime) return 0;
    const parsed = Date.parse(`${deviceTime.replace(' ', 'T')}Z`);
    return Number.isNaN(parsed) ? 0 : parsed - Date.now();
  }

  private async exchangeBook(
    userId: number,
    deviceId: string,
    hash: string,
    bookId: number,
    bookFileId: number,
    book: ExchangeBookDto,
    deviceClockOffsetMs: number,
  ): Promise<ExchangeBookResult> {
    const ingest = await this.annotationSync.ingestDeviceAnnotations({
      userId,
      source: 'koreader',
      deviceId,
      bookId,
      bookFileId,
      annotations: book.changes.map((change) => this.toIncoming(change)),
    });

    let deviceDeleted = 0;
    if (book.keysComplete) {
      deviceDeleted = await this.annotationSync.detectDeviceDeletions({
        userId,
        source: 'koreader',
        deviceId,
        bookId,
        presentKeys: book.keys,
      });
    }

    const pushDown = await this.annotationSync.computePushDown(userId, 'koreader', deviceId, bookId, PUSH_DOWN_PAGE);

    const deleteEntries: ExchangeDeleteEntry[] = pushDown.deletes.map(({ state, annotation }) => ({
      serverId: annotation.id,
      key: state.externalKey,
      datetime: state.externalCreatedAt ?? annotation.deviceCreatedAt,
    }));

    const editEntries: ExchangeEditEntry[] = pushDown.edits.map(({ state, annotation }) => ({
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
    }));

    const { addEntries, skippedNoPosition } = await this.buildAddEntries(userId, bookId, bookFileId, pushDown.adds, deviceClockOffsetMs);

    return {
      hash,
      bookId,
      applied: { ...ingest, deviceDeleted },
      toApply: { add: addEntries, edit: editEntries, delete: deleteEntries },
      more: pushDown.more,
      skippedNoPosition,
    };
  }

  /**
   * Builds the add entries for one push-down page. Positions for the whole page are read
   * in one query, and device identity datetimes are minted in one batch, so the page
   * costs a bounded number of queries instead of several per annotation. Annotations
   * whose CFI position still needs converting produce no entry this round (bounded per
   * request); the next exchange call picks them up once the xpointer is stored.
   */
  private async buildAddEntries(
    userId: number,
    bookId: number,
    bookFileId: number,
    adds: AnnotationRow[],
    deviceClockOffsetMs: number,
  ): Promise<{ addEntries: ExchangeAddEntry[]; skippedNoPosition: number }> {
    if (adds.length === 0) return { addEntries: [], skippedNoPosition: 0 };

    const positions = await this.loadDevicePositions(adds);
    const converterVersion = this.positionConverter.version;

    const pushable: { annotation: AnnotationRow; position: AnnotationPosition }[] = [];
    const convertible: AnnotationRow[] = [];
    let conversionBudget = CONVERSION_BUDGET_PER_REQUEST;
    let skippedNoPosition = 0;

    for (const annotation of adds) {
      const formats = positions.get(annotation.id);
      const pdfPosition = formats?.pdf ?? null;
      const position = pdfPosition ?? formats?.xpointer ?? null;
      const usable =
        position?.pos0 != null &&
        position.status !== 'failed' &&
        (position.converterVersion == null || position.converterVersion >= converterVersion);
      const retryable = position == null || position.converterVersion == null || position.converterVersion < converterVersion;

      if (!usable && pdfPosition == null) {
        if (conversionBudget > 0 && retryable) {
          conversionBudget -= 1;
          convertible.push(annotation);
        } else {
          skippedNoPosition += 1;
        }
        continue;
      }
      if (!usable || !position?.pos0) {
        skippedNoPosition += 1;
        continue;
      }
      pushable.push({ annotation, position });
    }

    const converted = await this.convertCfiPositions(userId, bookFileId, convertible, positions);

    // Mint in the original push-down order so the values match what a per-annotation
    // loop would have assigned, and only for annotations that actually reached the device
    // or stored a usable converted position.
    const needsIdentity = adds.filter(
      (annotation) => converted.has(annotation.id) || pushable.some((entry) => entry.annotation.id === annotation.id),
    );
    const datetimes = await this.annotationSync.ensureDeviceCreatedAtMany(userId, bookId, needsIdentity, deviceClockOffsetMs);

    const addEntries = pushable.map(({ annotation, position }) => ({
      serverId: annotation.id,
      version: annotation.version,
      datetime: datetimes.get(annotation.id)!,
      datetimeUpdated: annotation.deviceUpdatedAt,
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

    return { addEntries, skippedNoPosition };
  }

  private async loadDevicePositions(adds: AnnotationRow[]): Promise<Map<number, DevicePositionsByFormat>> {
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
  ): Promise<Set<number>> {
    const converted = new Set<number>();
    for (const annotation of annotationRows) {
      const cfiPosition = positions.get(annotation.id)?.cfi ?? null;
      if (!cfiPosition?.pos0) {
        await this.annotationSync.upsertGeneratedPosition({
          annotationId: annotation.id,
          userId,
          bookFileId,
          format: 'xpointer',
          pos0: '',
          pos1: null,
          status: 'failed',
          converterVersion: this.positionConverter.version,
        });
        continue;
      }

      const outcome = await this.positionConverter.cfiToXpointer({
        bookFileId,
        cfi: cfiPosition.pos0,
        text: annotation.text || null,
      });
      if (outcome.status === 'failed' || !outcome.pos0 || !outcome.pos1) {
        await this.annotationSync.upsertGeneratedPosition({
          annotationId: annotation.id,
          userId,
          bookFileId,
          format: 'xpointer',
          pos0: '',
          pos1: null,
          status: 'failed',
          converterVersion: this.positionConverter.version,
          extras: outcome.reason ? { reason: outcome.reason } : null,
        });
        continue;
      }

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
      converted.add(annotation.id);
    }
    return converted;
  }

  /**
   * datetime_updated pushed to the device must be ahead of any device edit we already
   * ingested, or the device-side dedup would treat the pushed edit as stale.
   */
  private mintEditDatetime(annotation: AnnotationRow, deviceClockOffsetMs: number): string {
    const candidate = formatDeviceDatetime(new Date(annotation.updatedAt.getTime() + deviceClockOffsetMs));
    if (annotation.deviceUpdatedAt && annotation.deviceUpdatedAt >= candidate) {
      const bumped = new Date(`${annotation.deviceUpdatedAt.replace(' ', 'T')}Z`);
      bumped.setUTCSeconds(bumped.getUTCSeconds() + 1);
      return formatDeviceDatetime(bumped);
    }
    return candidate;
  }

  private toIncoming(change: KoreaderAnnotationDto): IncomingDeviceAnnotation {
    return {
      datetime: change.datetime,
      datetimeUpdated: change.datetimeUpdated ?? null,
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
