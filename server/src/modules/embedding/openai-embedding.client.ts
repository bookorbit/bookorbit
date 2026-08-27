import { BadGatewayException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { embeddingConfig } from '../../config/config';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { EMBEDDING_DIMENSIONS } from './book-embedding-vectorizer.service';

const EVENT = 'embedding.openai';

@Injectable()
export class OpenAiEmbeddingClient {
  private readonly logger = new Logger(OpenAiEmbeddingClient.name);

  constructor(@Inject(embeddingConfig.KEY) private readonly config: ConfigType<typeof embeddingConfig>) {}

  isEnabled(): boolean {
    return Boolean(this.config.apiBaseUrl && this.config.model);
  }

  async embed(input: string): Promise<number[]> {
    const { apiBaseUrl, apiKey, model, timeoutMs } = this.config;
    const url = `${apiBaseUrl!.replace(/\/+$/, '')}/embeddings`;
    const startedAt = Date.now();
    this.logger.debug(`[${EVENT}] [start] model=${sanitizeLogValue(model)} inputChars=${input.length} - openai embedding started`);

    let res: Response;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input, dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}" - openai embedding failed`,
      );
      throw new ServiceUnavailableException(`embedding provider request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} status=${res.status} errorClass=EmbeddingHttpError error="${sanitizeLogValue(
          body,
        )}" - openai embedding failed`,
      );
      throw new BadGatewayException(`embedding request failed status=${res.status}`);
    }

    let json: { data?: Array<{ embedding?: unknown }> };
    try {
      json = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
    } catch (error) {
      this.logger.warn(
        `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} errorClass=EmbeddingParseError error="${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}" - openai embedding failed`,
      );
      throw new BadGatewayException('embedding response was not valid JSON');
    }
    const raw = json?.data?.[0]?.embedding;
    if (!Array.isArray(raw) || raw.length < EMBEDDING_DIMENSIONS || raw.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      const dims = Array.isArray(raw) ? raw.length : 'none';
      this.logger.warn(
        `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} errorClass=EmbeddingShapeError error="unexpected embedding response dims=${dims}" - openai embedding failed`,
      );
      throw new BadGatewayException(`unexpected embedding response dims=${dims}`);
    }

    const embedding = (raw as number[]).slice(0, EMBEDDING_DIMENSIONS);
    this.logger.debug(
      `[${EVENT}] [end] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} responseDims=${raw.length} usedDims=${embedding.length} - openai embedding completed`,
    );
    return embedding;
  }
}
