import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { HARDCOVER_GRAPHQL_URL, HARDCOVER_MAX_RETRIES } from './hardcover.constants';
import { HardcoverQueueService } from './hardcover-queue.service';

export interface HardcoverGraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

@Injectable()
export class HardcoverClientService {
  private readonly logger = new Logger(HardcoverClientService.name);

  constructor(private readonly queue: HardcoverQueueService) {}

  async query<T>(userId: number, token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.executeWithRetry<T>(userId, token, query, variables, 0);
  }

  private async executeWithRetry<T>(
    userId: number,
    token: string,
    query: string,
    variables: Record<string, unknown> | undefined,
    attempt: number,
  ): Promise<T> {
    await this.queue.throttle(userId);

    let response: Response;
    try {
      response = await fetch(HARDCOVER_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'BookOrbit Hardcover Sync (https://bookorbit.app)',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(`[hardcover.client] [fail] userId=${userId} attempt=${attempt} errorClass=${errorClass} error="${error}" - fetch failed`);
      throw err;
    }

    if (response.status === 429) {
      if (attempt >= HARDCOVER_MAX_RETRIES) {
        this.logger.error(
          `[hardcover.client] [fail] userId=${userId} attempt=${attempt} errorClass=RateLimitError error="rate limit exceeded after retries" - giving up`,
        );
        throw new Error('Hardcover rate limit exceeded');
      }
      const backoffMs = Math.pow(2, attempt + 1) * 1000;
      this.logger.warn(`[hardcover.client] userId=${userId} attempt=${attempt} backoffMs=${backoffMs} - rate limited, backing off`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this.executeWithRetry<T>(userId, token, query, variables, attempt + 1);
    }

    if (!response.ok) {
      const errorClass = `HttpError${response.status}`;
      this.logger.error(
        `[hardcover.client] [fail] userId=${userId} status=${response.status} errorClass=${errorClass} error="unexpected HTTP status" - request failed`,
      );
      throw new Error(`Hardcover API error: ${response.status}`);
    }

    const json = (await response.json()) as HardcoverGraphQLResponse<T>;

    if (json.errors?.length) {
      const error = sanitizeLogValue(json.errors[0].message);
      this.logger.error(`[hardcover.client] [fail] userId=${userId} errorClass=GraphQLError error="${error}" - GraphQL error`);
      throw new Error(`Hardcover GraphQL error: ${json.errors[0].message}`);
    }

    return json.data as T;
  }
}
