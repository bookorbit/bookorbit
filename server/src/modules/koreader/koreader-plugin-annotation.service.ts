import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AnnotationSyncService, type IncomingDeviceAnnotation } from '../annotation/annotation-sync.service';
import type { AnnotationsUploadDto, KoreaderAnnotationDto } from './dto';
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
    private readonly annotationSync: AnnotationSyncService,
  ) {}

  /** Legacy one-way upload used by plugin 0.3.x; the 0.4+ exchange endpoint supersedes it. */
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

        const ingest = await this.annotationSync.ingestDeviceAnnotations({
          userId: user.id,
          source: 'koreader',
          deviceId: dto.deviceId,
          bookId: match.bookId,
          bookFileId: match.bookFileId,
          annotations: book.annotations.map((annotation) => this.toIncoming(annotation)),
        });
        const upserted = ingest.created + ingest.updated + ingest.moved;
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

  private toIncoming(annotation: KoreaderAnnotationDto): IncomingDeviceAnnotation {
    return {
      datetime: annotation.datetime,
      datetimeUpdated: annotation.datetimeUpdated ?? null,
      drawer: annotation.drawer,
      color: annotation.color ?? null,
      text: annotation.text ?? null,
      note: annotation.note ?? null,
      chapter: annotation.chapter ?? null,
      pageno: annotation.pageno ?? null,
      posFormat: annotation.posFormat as IncomingDeviceAnnotation['posFormat'],
      pos0: annotation.pos0,
      pos1: annotation.pos1 ?? null,
    };
  }
}
