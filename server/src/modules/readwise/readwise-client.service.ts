import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { READWISE_AUTH_URL, READWISE_HIGHLIGHTS_URL, READWISE_MAX_RETRIES } from './readwise.constants';
import { ReadwiseQueueService } from './readwise-queue.service';

export interface ReadwiseHighlight {
  text: string;
  title?: string;
  author?: string;
  note?: string;
  image_url?: string;
  highlighted_at?: string;
  source_type: string;
  category: string;
}

@Injectable()
export class ReadwiseClientService {
  private readonly logger = new Logger(ReadwiseClientService.name);

  constructor(private readonly queue: ReadwiseQueueService) {}

  async validateToken(token: string): Promise<boolean> {
    try {
      const res = await fetch(READWISE_AUTH_URL, { headers: { Authorization: `Token ${token}` } });
      return res.status === 204;
    } catch (err) {
      this.logger.warn(`[readwise.client] token validation failed: ${sanitizeLogValue(err instanceof Error ? err.message : String(err))}`);
      return false;
    }
  }

  async createHighlights(userId: number, token: string, highlights: ReadwiseHighlight[], attempt = 0): Promise<void> {
    if (highlights.length === 0) return;
    await this.queue.throttle(userId);

    let res: Response;
    try {
      res = await fetch(READWISE_HIGHLIGHTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${token}`,
          'User-Agent': 'BookOrbit Readwise Sync (https://bookorbit.app)',
        },
        body: JSON.stringify({ highlights }),
      });
    } catch (err) {
      this.logger.error(
        `[readwise.client] [fail] userId=${userId} attempt=${attempt} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}"`,
      );
      throw err;
    }

    if (res.status === 429) {
      if (attempt >= READWISE_MAX_RETRIES) throw new Error('Readwise rate limit exceeded');
      const backoffMs = Math.pow(2, attempt + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this.createHighlights(userId, token, highlights, attempt + 1);
    }
    if (res.status === 401) throw new ReadwiseUnauthorizedError();
    if (!res.ok) throw new Error(`Readwise API error: ${res.status}`);
  }
}

export class ReadwiseUnauthorizedError extends Error {
  constructor() {
    super('Readwise token unauthorized');
    this.name = 'ReadwiseUnauthorizedError';
  }
}
