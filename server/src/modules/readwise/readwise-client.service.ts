import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { READWISE_AUTH_URL, READWISE_HIGHLIGHTS_URL, READWISE_MAX_RETRIES, READWISE_REQUEST_TIMEOUT_MS } from './readwise.constants';
import { ReadwiseQueueService } from './readwise-queue.service';

export interface ReadwiseHighlight {
  text: string;
  title?: string;
  author?: string;
  note?: string;
  image_url?: string;
  highlighted_at?: string;
  highlight_url?: string;
  source_type: string;
  category: string;
}

@Injectable()
export class ReadwiseClientService {
  private readonly logger = new Logger(ReadwiseClientService.name);

  constructor(private readonly queue: ReadwiseQueueService) {}

  async validateToken(userId: number, token: string): Promise<boolean> {
    const startedAtMs = Date.now();
    try {
      const res = await fetch(READWISE_AUTH_URL, {
        headers: { Authorization: `Token ${token}` },
        signal: AbortSignal.timeout(READWISE_REQUEST_TIMEOUT_MS),
      });
      return res.status === 204;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      this.logger.warn(
        `[readwise.client.validate_token] [fail] userId=${userId} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - token validation failed`,
      );
      return false;
    }
  }

  async createHighlights(userId: number, token: string, highlights: ReadwiseHighlight[], attempt = 0): Promise<void> {
    if (highlights.length === 0) return;
    await this.queue.throttle(userId);

    const startedAtMs = Date.now();
    let res: Response;
    try {
      res = await fetch(READWISE_HIGHLIGHTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${token}`,
          'User-Agent': 'BookOrbit Readwise Sync',
        },
        body: JSON.stringify({ highlights }),
        signal: AbortSignal.timeout(READWISE_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      this.logger.error(
        `[readwise.client.create_highlights] [fail] userId=${userId} attempt=${attempt} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - Readwise highlights create request failed`,
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
