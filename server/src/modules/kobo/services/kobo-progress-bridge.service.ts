import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { KoboSpanConverterService } from '../../position-converter/kobo-span-converter.service';
import { KoboKepubContextService } from './kobo-kepub-context.service';

const EVENT = 'kobo.progress_bridge';

export interface CanonicalProgressPoint {
  cfi: string;
  xpointer: string;
}

export interface KoboBookmarkPoint {
  source: string;
  value: string;
  contentSourceProgressPercent: number | null;
}

/**
 * Converts reading positions between Kobo KoboSpan bookmarks and canonical
 * cfi/xpointer points through the kepub span codec. Returns null instead of
 * failing so progress sync always degrades to percent.
 */
@Injectable()
export class KoboProgressBridgeService {
  private readonly logger = new Logger(KoboProgressBridgeService.name);

  constructor(
    private readonly kepubContextService: KoboKepubContextService,
    private readonly koboSpanConverter: KoboSpanConverterService,
  ) {}

  async koboBookmarkToCanonical(userId: number, bookId: number, source: string, spanValue: string): Promise<CanonicalProgressPoint | null> {
    try {
      const kepub = await this.kepubContextService.resolveForBook(userId, bookId);
      if (!kepub.ok) return null;

      const outcome = await this.koboSpanConverter.koboBookmarkToPositions({
        bookFileId: kepub.file.id,
        ctx: kepub.ctx,
        chapterFilename: source,
        spanId: spanValue,
      });
      if (outcome.status === 'failed' || !outcome.cfi || !outcome.xpointer) return null;
      return { cfi: outcome.cfi, xpointer: outcome.xpointer };
    } catch (error) {
      this.logWarn('bookmark_to_canonical', userId, bookId, error);
      return null;
    }
  }

  async cfiToKoboBookmark(userId: number, bookId: number, cfi: string): Promise<KoboBookmarkPoint | null> {
    try {
      const kepub = await this.kepubContextService.resolveForBook(userId, bookId);
      if (!kepub.ok) return null;

      const outcome = await this.koboSpanConverter.cfiPointToKoboBookmark({ bookFileId: kepub.file.id, ctx: kepub.ctx, cfi });
      if (outcome.status === 'failed' || !outcome.spanId || !outcome.chapterFilename) return null;
      return {
        source: outcome.chapterFilename,
        value: outcome.spanId,
        contentSourceProgressPercent: outcome.contentSourceProgressPercent ?? null,
      };
    } catch (error) {
      this.logWarn('cfi_to_bookmark', userId, bookId, error);
      return null;
    }
  }

  private logWarn(operation: string, userId: number, bookId: number, error: unknown): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    this.logger.warn(
      `[${EVENT}] [fail] op=${operation} userId=${userId} bookId=${bookId} errorClass=${errorClass} error="${sanitizeLogValue(
        error instanceof Error ? error.message : 'unknown error',
      )}" - kobo progress conversion failed`,
    );
  }
}
