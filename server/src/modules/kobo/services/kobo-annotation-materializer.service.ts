import { Injectable, Logger } from '@nestjs/common';

import type { AnnotationPosition, AnnotationRow } from '../../../db/schema';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { AnnotationSyncService } from '../../annotation/annotation-sync.service';
import { KepubContext, KoboSpanConverterService } from '../../position-converter/kobo-span-converter.service';
import { PositionConverterService } from '../../position-converter/position-converter.service';
import type { KepubReaderFile } from './kobo-kepub-context.service';

const MATERIALIZE_EVENT = 'kobo.annotation_materialize';
const CONVERT_EVENT = 'kobo.annotation_convert_incoming';
const DEFAULT_LIMIT = 200;

interface PositionsByFormat {
  koboSpan?: AnnotationPosition;
  cfi?: AnnotationPosition;
  xpointer?: AnnotationPosition;
}

/**
 * Lazily materializes kobo_span positions for hub annotations when a Kobo device
 * syncs a book (the kepub artifact exists by then), and conversely converts freshly
 * uploaded Kobo positions to canonical cfi+xpointer. Mirrors the cfi backfill
 * pattern of AnnotationConversionService.
 */
@Injectable()
export class KoboAnnotationMaterializerService {
  private readonly logger = new Logger(KoboAnnotationMaterializerService.name);

  constructor(
    private readonly annotationSync: AnnotationSyncService,
    private readonly koboSpanConverter: KoboSpanConverterService,
    private readonly positionConverter: PositionConverterService,
  ) {}

  /** Computes kobo_span positions for serve-scope annotations that lack a current one. */
  async ensureKoboSpanPositionsForBook(
    userId: number,
    bookId: number,
    file: KepubReaderFile,
    ctx: KepubContext,
    opts: { includeAllOrigins: boolean; limit?: number },
  ): Promise<{ generated: number; failed: number }> {
    const startedAtMs = Date.now();
    const result = { generated: 0, failed: 0 };
    try {
      const renditionHash = await this.koboSpanConverter.computeRenditionHash(ctx);
      const annotations = await this.annotationSync.listActiveForBook(userId, bookId);
      if (annotations.length === 0) return result;

      const koboKnownIds = new Set(
        (await this.annotationSync.listStatesBySourceForBook(userId, 'kobo', bookId)).map((row) => row.state.annotationId),
      );
      const scope = opts.includeAllOrigins ? annotations : annotations.filter((annotation) => koboKnownIds.has(annotation.id));
      if (scope.length === 0) return result;

      const positions = this.groupPositions(
        await this.annotationSync.findPositions(
          scope.map((annotation) => annotation.id),
          ['kobo_span', 'cfi', 'xpointer'],
        ),
      );

      const candidates = scope.filter((annotation) => this.needsMaterialization(positions.get(annotation.id)?.koboSpan, renditionHash));
      const limit = opts.limit ?? DEFAULT_LIMIT;
      for (const annotation of candidates.slice(0, limit)) {
        const outcome = await this.materializeOne(userId, annotation, positions.get(annotation.id) ?? {}, file, ctx);
        result[outcome ? 'generated' : 'failed'] += 1;
      }

      if (result.generated > 0 || result.failed > 0) {
        this.logger.log(
          `[${MATERIALIZE_EVENT}] [end] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAtMs} generated=${result.generated} failed=${result.failed} candidates=${candidates.length} - kobo span positions materialized`,
        );
      }
      return result;
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${MATERIALIZE_EVENT}] [fail] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - kobo span materialization failed`,
      );
      return result;
    }
  }

  /** Converts freshly ingested Kobo positions (by external key) to cfi + xpointer. */
  async convertIncomingForBook(userId: number, bookId: number, file: KepubReaderFile, ctx: KepubContext, externalKeys: string[]): Promise<void> {
    if (externalKeys.length === 0) return;
    const startedAtMs = Date.now();
    try {
      const wanted = new Set(externalKeys);
      const states = (await this.annotationSync.listStatesBySourceForBook(userId, 'kobo', bookId)).filter(
        (row) => wanted.has(row.state.externalKey) && row.annotation.deletedAt === null,
      );
      if (states.length === 0) return;

      const positions = this.groupPositions(
        await this.annotationSync.findPositions(
          states.map((row) => row.annotation.id),
          ['kobo_span', 'cfi', 'xpointer'],
        ),
      );

      let converted = 0;
      let failed = 0;
      for (const { annotation } of states) {
        const formats = positions.get(annotation.id);
        const koboSpan = formats?.koboSpan;
        if (!koboSpan?.pos0) continue;
        if (!this.needsCanonical(formats?.cfi) && !this.needsCanonical(formats?.xpointer)) continue;

        const location = (koboSpan.extras as { koboLocation?: unknown } | null)?.koboLocation;
        const outcome = await this.koboSpanConverter.koboSpanToCanonical({
          bookFileId: file.id,
          ctx,
          location,
          text: annotation.text || null,
        });

        // The device's own position belongs to the current rendition by definition;
        // stamping the hash keeps the materializer from re-synthesizing the verbatim
        // location the device uploaded.
        if (outcome.renditionHash) {
          await this.annotationSync.upsertGeneratedPosition({
            annotationId: annotation.id,
            userId,
            bookFileId: file.id,
            format: 'kobo_span',
            pos0: koboSpan.pos0,
            pos1: koboSpan.pos1,
            status: koboSpan.status as 'exact' | 'repaired' | 'failed' | 'pending',
            converterVersion: this.koboSpanConverter.version,
            extras: { ...(koboSpan.extras ?? {}), chapterIndex: outcome.chapterIndex, renditionHash: outcome.renditionHash },
          });
        }

        if (outcome.status === 'failed' || !outcome.cfi || !outcome.xpointerPos0) {
          failed += 1;
          await this.storeFailure(userId, annotation.id, file.id, 'cfi', outcome.chapterIndex ?? null, outcome.reason ?? 'conversion_failed');
          await this.storeFailure(userId, annotation.id, file.id, 'xpointer', outcome.chapterIndex ?? null, outcome.reason ?? 'conversion_failed');
          continue;
        }

        converted += 1;
        await this.annotationSync.upsertGeneratedPosition({
          annotationId: annotation.id,
          userId,
          bookFileId: file.id,
          format: 'cfi',
          pos0: outcome.cfi,
          pos1: null,
          status: outcome.status,
          converterVersion: this.positionConverter.version,
          extras: { chapterIndex: outcome.chapterIndex },
        });
        await this.annotationSync.upsertGeneratedPosition({
          annotationId: annotation.id,
          userId,
          bookFileId: file.id,
          format: 'xpointer',
          pos0: outcome.xpointerPos0,
          pos1: outcome.xpointerPos1 ?? null,
          status: outcome.status,
          converterVersion: this.positionConverter.version,
          extras: { chapterIndex: outcome.chapterIndex },
        });
      }

      if (converted > 0 || failed > 0) {
        this.logger.log(
          `[${CONVERT_EVENT}] [end] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAtMs} converted=${converted} failed=${failed} - incoming kobo positions converted`,
        );
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${CONVERT_EVENT}] [fail] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - incoming kobo position conversion failed`,
      );
    }
  }

  private async materializeOne(
    userId: number,
    annotation: AnnotationRow,
    formats: PositionsByFormat,
    file: KepubReaderFile,
    ctx: KepubContext,
  ): Promise<boolean> {
    const cfi = await this.resolveSourceCfi(userId, annotation, formats, file);
    if (!cfi) {
      await this.storeKoboSpanFailure(userId, annotation.id, file.id, ctx, 'no_source_position');
      return false;
    }

    const outcome = await this.koboSpanConverter.canonicalToKoboSpan({
      bookFileId: file.id,
      ctx,
      cfi,
      text: annotation.text || null,
      chapterTitle: annotation.chapterTitle,
    });

    if (outcome.status === 'failed' || !outcome.pos0 || !outcome.pos1 || !outcome.location) {
      await this.storeKoboSpanFailure(userId, annotation.id, file.id, ctx, outcome.reason ?? 'conversion_failed', outcome.chapterIndex ?? null);
      return false;
    }

    await this.annotationSync.upsertGeneratedPosition({
      annotationId: annotation.id,
      userId,
      bookFileId: file.id,
      format: 'kobo_span',
      pos0: outcome.pos0,
      pos1: outcome.pos1,
      status: outcome.status,
      converterVersion: this.koboSpanConverter.version,
      extras: {
        chapterIndex: outcome.chapterIndex,
        chapterFilename: outcome.location.span.chapterFilename,
        chapterProgress: outcome.location.span.chapterProgress,
        renditionHash: outcome.renditionHash,
        koboLocation: outcome.location,
      },
    });
    return true;
  }

  /** Source CFI for projection: the stored cfi row, else a fresh xpointer conversion. */
  private async resolveSourceCfi(
    userId: number,
    annotation: AnnotationRow,
    formats: PositionsByFormat,
    file: KepubReaderFile,
  ): Promise<string | null> {
    const cfiRow = formats.cfi;
    if (cfiRow?.pos0 && cfiRow.status !== 'failed' && cfiRow.status !== 'pending') return cfiRow.pos0;

    const xpointer = formats.xpointer;
    if (!xpointer?.pos0 || xpointer.status === 'failed') return null;

    const outcome = await this.positionConverter.xpointerToCfi({
      bookFileId: xpointer.bookFileId ?? file.id,
      pos0: xpointer.pos0,
      pos1: xpointer.pos1,
      text: annotation.text || null,
    });
    if (outcome.status === 'failed' || !outcome.cfi) return null;

    await this.annotationSync.upsertGeneratedPosition({
      annotationId: annotation.id,
      userId,
      bookFileId: xpointer.bookFileId ?? file.id,
      format: 'cfi',
      pos0: outcome.cfi,
      pos1: null,
      status: outcome.status,
      converterVersion: this.positionConverter.version,
      extras: { chapterIndex: outcome.chapterIndex },
    });
    return outcome.cfi;
  }

  private needsMaterialization(koboSpan: AnnotationPosition | undefined, renditionHash: string | null): boolean {
    if (!koboSpan) return true;
    if (koboSpan.status === 'pending') return true;
    const extras = koboSpan.extras as { renditionHash?: string } | null;
    if (renditionHash && extras?.renditionHash !== renditionHash) return true;
    if (koboSpan.converterVersion != null && koboSpan.converterVersion < this.koboSpanConverter.version) return true;
    return false;
  }

  private needsCanonical(position: AnnotationPosition | undefined): boolean {
    if (!position) return true;
    if (position.status === 'pending') return true;
    return position.converterVersion != null && position.converterVersion < this.positionConverter.version;
  }

  private async storeKoboSpanFailure(
    userId: number,
    annotationId: number,
    bookFileId: number,
    ctx: KepubContext,
    reason: string,
    chapterIndex: number | null = null,
  ): Promise<void> {
    const renditionHash = await this.koboSpanConverter.computeRenditionHash(ctx);
    await this.annotationSync.upsertGeneratedPosition({
      annotationId,
      userId,
      bookFileId,
      format: 'kobo_span',
      pos0: null,
      pos1: null,
      status: 'failed',
      converterVersion: this.koboSpanConverter.version,
      extras: { reason, chapterIndex, renditionHash },
    });
  }

  private async storeFailure(
    userId: number,
    annotationId: number,
    bookFileId: number,
    format: 'cfi' | 'xpointer',
    chapterIndex: number | null,
    reason: string,
  ): Promise<void> {
    await this.annotationSync.upsertGeneratedPosition({
      annotationId,
      userId,
      bookFileId,
      format,
      pos0: null,
      pos1: null,
      status: 'failed',
      converterVersion: this.positionConverter.version,
      extras: { reason, chapterIndex },
    });
  }

  private groupPositions(rows: AnnotationPosition[]): Map<number, PositionsByFormat> {
    const byAnnotation = new Map<number, PositionsByFormat>();
    for (const row of rows) {
      const group = byAnnotation.get(row.annotationId) ?? {};
      if (row.format === 'kobo_span') group.koboSpan = row;
      else if (row.format === 'cfi') group.cfi = row;
      else if (row.format === 'xpointer') group.xpointer = row;
      byAnnotation.set(row.annotationId, group);
    }
    return byAnnotation;
  }
}
