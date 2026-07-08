import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { appConfig } from '../../config/config';
import {
  bookOrbitReadwiseHighlightUrl,
  openLibraryCoverUrl,
  READWISE_BATCH_SIZE,
  READWISE_CATEGORY,
  READWISE_MAX,
  READWISE_SOURCE_TYPE,
} from './readwise.constants';
import { ReadwiseClientService, ReadwiseUnauthorizedError, type ReadwiseHighlight } from './readwise-client.service';
import { ReadwiseRepository, type NewHighlightRow } from './readwise.repository';

const SYNC_EVENT = 'readwise.sync';

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

@Injectable()
export class ReadwiseSyncService {
  private readonly logger = new Logger(ReadwiseSyncService.name);

  constructor(
    private readonly repo: ReadwiseRepository,
    private readonly client: ReadwiseClientService,
    @Inject(appConfig.KEY) private readonly appConfiguration: ConfigType<typeof appConfig>,
  ) {}

  async flush(userId: number): Promise<void> {
    const startedAtMs = Date.now();
    const settings = await this.repo.findSettings(userId);
    if (!settings?.apiToken || !settings.enabled) return;
    const hasPermission = await this.repo.userHasReadwiseSyncPermission(userId);
    if (!hasPermission) return;

    let watermark = settings.lastSyncedAnnotationId;
    let syncedHighlights = 0;
    let batches = 0;
    this.logger.log(
      `[${SYNC_EVENT}] [start] userId=${userId} afterAnnotationId=${watermark} batchSize=${READWISE_BATCH_SIZE} - Readwise sync started`,
    );

    for (;;) {
      const rows = await this.repo.findNewHighlights(userId, watermark, READWISE_BATCH_SIZE);
      if (rows.length === 0) break;
      const payload = rows.map((r) => this.toHighlight(userId, r));
      try {
        await this.client.createHighlights(userId, settings.apiToken, payload);
      } catch (err) {
        const durationMs = Date.now() - startedAtMs;
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        if (err instanceof ReadwiseUnauthorizedError) {
          await this.repo.upsertSettings(userId, { disabledReason: 'invalid_token', enabled: false });
          this.logger.warn(
            `[${SYNC_EVENT}] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${sanitizeLogValue(err.message)}" - Readwise sync disabled after token rejection`,
          );
          return;
        }
        this.logger.warn(
          `[${SYNC_EVENT}] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - Readwise sync push failed`,
        );
        throw err;
      }
      watermark = rows[rows.length - 1]!.annotationId;
      await this.repo.upsertSettings(userId, { lastSyncedAnnotationId: watermark, lastSyncedAt: new Date() });
      syncedHighlights += rows.length;
      batches += 1;
      if (rows.length < READWISE_BATCH_SIZE) break;
    }
    this.logger.log(
      `[${SYNC_EVENT}] [end] userId=${userId} durationMs=${Date.now() - startedAtMs} batches=${batches} syncedHighlights=${syncedHighlights} watermark=${watermark} - Readwise sync completed`,
    );
  }

  private toHighlight(userId: number, r: NewHighlightRow): ReadwiseHighlight {
    const isbn = r.isbn13 || r.isbn10;
    return {
      text: truncate(r.text, READWISE_MAX.TEXT),
      ...(r.title ? { title: truncate(r.title, READWISE_MAX.TITLE) } : {}),
      ...(r.author ? { author: truncate(r.author, READWISE_MAX.AUTHOR) } : {}),
      ...(r.note ? { note: truncate(r.note, READWISE_MAX.NOTE) } : {}),
      ...(isbn ? { image_url: openLibraryCoverUrl(isbn) } : {}),
      highlighted_at: r.createdAt.toISOString(),
      highlight_url: truncate(bookOrbitReadwiseHighlightUrl(this.appConfiguration.appUrl, r.bookId, r.annotationId), READWISE_MAX.HIGHLIGHT_URL),
      source_type: READWISE_SOURCE_TYPE,
      category: READWISE_CATEGORY,
    };
  }
}
