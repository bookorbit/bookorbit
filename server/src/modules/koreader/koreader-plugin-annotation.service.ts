import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import type { KoreaderAnnotationItem } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { NewKoreaderAnnotation } from '../../db/schema';
import type { AnnotationsUploadDto, KoreaderAnnotationDto } from './dto';
import { KoreaderAnnotationRepository } from './koreader-annotation.repository';
import { KoreaderRepository } from './koreader.repository';

const ANNOTATIONS_EVENT = 'koreader.plugin.annotations';
const MAX_ANNOTATIONS_PER_REQUEST = 50;

export interface AnnotationsUploadResult {
  results: { hash: string; upserted: number }[];
  unmatched: string[];
}

@Injectable()
export class KoreaderPluginAnnotationService {
  private readonly logger = new Logger(KoreaderPluginAnnotationService.name);

  constructor(
    private readonly koreaderRepo: KoreaderRepository,
    private readonly annotationRepo: KoreaderAnnotationRepository,
  ) {}

  async uploadAnnotations(user: RequestUser, dto: AnnotationsUploadDto): Promise<AnnotationsUploadResult> {
    const startedAtMs = Date.now();
    const totalAnnotations = dto.books.reduce((sum, book) => sum + book.annotations.length, 0);
    this.logger.log(
      `[${ANNOTATIONS_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} books=${dto.books.length} annotations=${totalAnnotations} - annotations upload started`,
    );

    try {
      if (totalAnnotations > MAX_ANNOTATIONS_PER_REQUEST) {
        throw new BadRequestException(`Too many annotations in one request (max ${MAX_ANNOTATIONS_PER_REQUEST})`);
      }

      const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
      const hashes = [...new Set(dto.books.map((book) => book.hash.toLowerCase()))];
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds);

      const results: { hash: string; upserted: number }[] = [];
      const unmatched: string[] = [];
      let upsertedTotal = 0;

      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }

        const rows = this.toRows(user.id, match.bookId, match.bookFileId, book.annotations);
        const upserted = await this.annotationRepo.upsertMany(rows);
        upsertedTotal += upserted;
        results.push({ hash, upserted });
      }

      this.logger.log(
        `[${ANNOTATIONS_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} upserted=${upsertedTotal} unmatched=${unmatched.length} - annotations upload completed`,
      );

      return { results, unmatched };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${ANNOTATIONS_EVENT}] [fail] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - annotations upload failed`,
      );
      throw error;
    }
  }

  async getBookAnnotations(userId: number, bookId: number): Promise<KoreaderAnnotationItem[]> {
    const rows = await this.annotationRepo.listByBook(userId, bookId);
    return rows.map((row) => ({
      id: row.id,
      drawer: row.drawer as KoreaderAnnotationItem['drawer'],
      color: row.color,
      text: row.text,
      note: row.note,
      chapter: row.chapter,
      pageno: row.pageno,
      posFormat: row.posFormat as KoreaderAnnotationItem['posFormat'],
      deviceCreatedAt: row.deviceCreatedAt,
      deviceUpdatedAt: row.deviceUpdatedAt,
    }));
  }

  buildAnnotationKey(deviceCreatedAt: string, pos0: string): string {
    return createHash('md5').update(`${deviceCreatedAt}|${pos0}`).digest('hex'); // codeql[js/weak-cryptographic-algorithm] - non-security dedup key
  }

  private toRows(userId: number, bookId: number, bookFileId: number, annotations: KoreaderAnnotationDto[]): NewKoreaderAnnotation[] {
    const byKey = new Map<string, NewKoreaderAnnotation>();
    for (const annotation of annotations) {
      const annotationKey = this.buildAnnotationKey(annotation.datetime, annotation.pos0);
      byKey.set(annotationKey, {
        userId,
        bookId,
        bookFileId,
        annotationKey,
        drawer: annotation.drawer,
        color: annotation.color ?? null,
        text: annotation.text ?? null,
        note: annotation.note ?? null,
        chapter: annotation.chapter ?? null,
        pageno: annotation.pageno ?? null,
        posFormat: annotation.posFormat,
        pos0: annotation.pos0,
        pos1: annotation.pos1 ?? null,
        deviceCreatedAt: annotation.datetime,
        deviceUpdatedAt: annotation.datetimeUpdated ?? null,
      });
    }
    return [...byKey.values()];
  }
}
