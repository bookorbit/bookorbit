import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AnnotationRow } from '../../db/schema';
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
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds);
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
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds);

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

    let conversionBudget = CONVERSION_BUDGET_PER_REQUEST;
    let skippedNoPosition = 0;
    const addEntries: ExchangeAddEntry[] = [];
    for (const annotation of pushDown.adds) {
      const entry = await this.buildAddEntry(userId, bookId, bookFileId, annotation, conversionBudget > 0, deviceClockOffsetMs);
      if (entry === 'converted') {
        conversionBudget -= 1;
        continue;
      }
      if (entry == null) {
        skippedNoPosition += 1;
        continue;
      }
      addEntries.push(entry);
    }

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
   * Builds an add entry for the device, converting the CFI position to an xpointer
   * when needed (bounded per request). Returns null when no usable device position
   * exists, or the literal 'converted' when a conversion was attempted this round
   * (the entry is picked up by the next exchange call once stored).
   */
  private async buildAddEntry(
    userId: number,
    bookId: number,
    bookFileId: number,
    annotation: AnnotationRow,
    mayConvert: boolean,
    deviceClockOffsetMs: number,
  ): Promise<ExchangeAddEntry | null | 'converted'> {
    const pdfPosition = await this.annotationSync.findDevicePositionFor(annotation.id, 'pdf');
    const xpointerPosition = pdfPosition ? null : await this.annotationSync.findDevicePositionFor(annotation.id, 'xpointer');
    const converterVersion = this.positionConverter.version;

    const position = pdfPosition ?? xpointerPosition;
    const usable =
      position?.pos0 != null && position.status !== 'failed' && (position.converterVersion == null || position.converterVersion >= converterVersion);
    const retryable = position == null || position.converterVersion == null || position.converterVersion < converterVersion;

    if (!usable && pdfPosition == null) {
      if (!mayConvert || !retryable) return null;
      await this.convertCfiToXpointer(userId, bookId, bookFileId, annotation, deviceClockOffsetMs);
      return 'converted';
    }
    if (!usable || !position?.pos0) return null;

    const datetime = await this.annotationSync.ensureDeviceCreatedAt(userId, bookId, annotation, deviceClockOffsetMs);
    const pageno = ((position.extras as { pageno?: number } | null)?.pageno ?? null) as number | null;
    return {
      serverId: annotation.id,
      version: annotation.version,
      datetime,
      datetimeUpdated: annotation.deviceUpdatedAt,
      drawer: drawerFromStyle(annotation.style),
      color: koreaderColorFromHex(annotation.color),
      text: annotation.text,
      note: annotation.note,
      chapter: annotation.chapterTitle,
      posFormat: position.format as 'xpointer' | 'pdf',
      pos0: position.pos0,
      pos1: position.pos1,
      pageno,
    };
  }

  private async convertCfiToXpointer(
    userId: number,
    bookId: number,
    bookFileId: number,
    annotation: AnnotationRow,
    deviceClockOffsetMs: number,
  ): Promise<void> {
    const cfiPosition = await this.annotationSync.findDevicePositionFor(annotation.id, 'cfi');
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
      return;
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
      return;
    }

    await this.annotationSync.ensureDeviceCreatedAt(userId, bookId, annotation, deviceClockOffsetMs);
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
