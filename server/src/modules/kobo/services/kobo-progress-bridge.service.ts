import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { KoboSpanConverterService } from '../../position-converter/kobo-span-converter.service';
import { PositionConverterService } from '../../position-converter/position-converter.service';
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
    private readonly positionConverter: PositionConverterService,
  ) {}

  /** Orders two canonical positions: negative when `a` comes first, null when either cannot be read. */
  comparePositions(a: string, b: string): number | null {
    return this.positionConverter.compareCfi(a, b);
  }

  /**
   * Places a narration marker on the device. A read-along save can hold the sentence being narrated
   * without a text position, and a bookmark sent as a bare percent opens the book at its start.
   */
  async narrationToKoboBookmark(
    userId: number,
    bookId: number,
    bookFileId: number,
    marker: { fragment: string; sectionIndex: number },
    deviceId?: number,
  ): Promise<KoboBookmarkPoint | null> {
    try {
      const fragment = marker.fragment.slice(marker.fragment.lastIndexOf('#') + 1);
      const outcome = await this.positionConverter.fragmentToPositions({ bookFileId, chapterIndex: marker.sectionIndex, fragment });
      if (outcome.status === 'failed' || !outcome.cfi) {
        return this.logDegraded('narration_to_bookmark', userId, bookId, outcome.reason ?? 'incomplete_outcome');
      }
      return await this.cfiToKoboBookmark(userId, bookId, outcome.cfi, deviceId);
    } catch (error) {
      this.logWarn('narration_to_bookmark', userId, bookId, error);
      return null;
    }
  }

  async koboBookmarkToCanonical(
    userId: number,
    bookId: number,
    source: string,
    spanValue: string,
    deviceId?: number,
  ): Promise<CanonicalProgressPoint | null> {
    try {
      const kepub = await this.kepubContextService.resolveForBook(userId, bookId, deviceId, { followDeliverySource: true });
      if (!kepub.ok) return this.logDegraded('bookmark_to_canonical', userId, bookId, kepub.reason);

      try {
        const outcome = await this.koboSpanConverter.koboBookmarkToPositions({
          bookFileId: kepub.file.id,
          ctx: kepub.ctx,
          chapterFilename: source,
          spanId: spanValue,
        });
        if (outcome.status === 'failed' || !outcome.cfi || !outcome.xpointer) {
          return this.logDegraded('bookmark_to_canonical', userId, bookId, outcome.reason ?? 'incomplete_outcome');
        }
        return { cfi: outcome.cfi, xpointer: outcome.xpointer };
      } finally {
        await kepub.release?.();
      }
    } catch (error) {
      this.logWarn('bookmark_to_canonical', userId, bookId, error);
      return null;
    }
  }

  async cfiToKoboBookmark(userId: number, bookId: number, cfi: string, deviceId?: number): Promise<KoboBookmarkPoint | null> {
    try {
      const kepub = await this.kepubContextService.resolveForBook(userId, bookId, deviceId, { followDeliverySource: true, outgoing: true });
      if (!kepub.ok) return this.logDegraded('cfi_to_bookmark', userId, bookId, kepub.reason);

      try {
        const outcome = await this.koboSpanConverter.cfiPointToKoboBookmark({ bookFileId: kepub.file.id, ctx: kepub.ctx, cfi });
        if (outcome.status === 'failed' || !outcome.spanId || !outcome.chapterFilename) {
          return this.logDegraded('cfi_to_bookmark', userId, bookId, outcome.reason ?? 'incomplete_outcome');
        }
        return {
          source: outcome.chapterFilename,
          value: outcome.spanId,
          contentSourceProgressPercent: outcome.contentSourceProgressPercent ?? null,
        };
      } finally {
        await kepub.release?.();
      }
    } catch (error) {
      this.logWarn('cfi_to_bookmark', userId, bookId, error);
      return null;
    }
  }

  /**
   * A conversion that gives up is not an error, but it does mean the device receives a
   * percent without a position, so it has to be visible: the resulting bookmark looks
   * healthy on the device while resuming at the wrong place.
   */
  private logDegraded(operation: string, userId: number, bookId: number, reason: string): null {
    this.logger.warn(
      `[${EVENT}] [fail] op=${operation} userId=${userId} bookId=${bookId} reason=${sanitizeLogValue(reason)} - kobo position unavailable, progress degrades to percent`,
    );
    return null;
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
