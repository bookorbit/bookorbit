import { Injectable, Logger } from '@nestjs/common';

import { READWISE_BATCH_SIZE, READWISE_CATEGORY, READWISE_MAX, READWISE_SOURCE_TYPE } from './readwise.constants';
import { ReadwiseClientService, ReadwiseUnauthorizedError, type ReadwiseHighlight } from './readwise-client.service';
import { ReadwiseRepository, type NewHighlightRow } from './readwise.repository';

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

@Injectable()
export class ReadwiseSyncService {
  private readonly logger = new Logger(ReadwiseSyncService.name);

  constructor(
    private readonly repo: ReadwiseRepository,
    private readonly client: ReadwiseClientService,
  ) {}

  async flush(userId: number): Promise<void> {
    const settings = await this.repo.findSettings(userId);
    if (!settings?.apiToken || !settings.enabled) return;
    const hasPermission = await this.repo.userHasReadwiseSyncPermission(userId);
    if (!hasPermission) return;

    let watermark = settings.lastSyncedAnnotationId;
    for (;;) {
      const rows = await this.repo.findNewHighlights(userId, watermark, READWISE_BATCH_SIZE);
      if (rows.length === 0) break;
      const payload = rows.map((r) => this.toHighlight(r));
      try {
        await this.client.createHighlights(userId, settings.apiToken, payload);
      } catch (err) {
        if (err instanceof ReadwiseUnauthorizedError) {
          await this.repo.upsertSettings(userId, { disabledReason: 'invalid_token', enabled: false });
        }
        this.logger.warn(`[readwise.sync] userId=${userId} push failed, watermark held at ${watermark}`);
        return;
      }
      watermark = rows[rows.length - 1]!.annotationId;
      await this.repo.upsertSettings(userId, { lastSyncedAnnotationId: watermark, lastSyncedAt: new Date() });
      if (rows.length < READWISE_BATCH_SIZE) break;
    }
  }

  private toHighlight(r: NewHighlightRow): ReadwiseHighlight {
    return {
      text: truncate(r.text, READWISE_MAX.TEXT),
      ...(r.title ? { title: truncate(r.title, READWISE_MAX.TITLE) } : {}),
      ...(r.author ? { author: truncate(r.author, READWISE_MAX.AUTHOR) } : {}),
      ...(r.note ? { note: truncate(r.note, READWISE_MAX.NOTE) } : {}),
      highlighted_at: r.createdAt.toISOString(),
      source_type: READWISE_SOURCE_TYPE,
      category: READWISE_CATEGORY,
    };
  }
}
