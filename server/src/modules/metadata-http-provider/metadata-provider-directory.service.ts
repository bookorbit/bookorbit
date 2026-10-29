import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { MetadataProviderDirectory, MetadataProviderDirectoryEntry } from '@bookorbit/types';

import { appConfig } from '../../config/config';
import { safeFetch } from '../../common/utils/safe-fetch';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BUNDLED_PROVIDER_DIRECTORY, parseProviderDirectory } from './metadata-provider-directory';

const FRESH_FOR_MS = 24 * 60 * 60 * 1000;
/** After a failed read, how long to show what we have before asking again. */
const RETRY_AFTER_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

interface CachedDirectory {
  providers: MetadataProviderDirectoryEntry[];
  fetchedAt: Date;
}

/**
 * The ready-made providers an admin can install. Read from the providers repository when the
 * External tab asks for it, at most once a day, so nothing is fetched for a server nobody configures.
 */
@Injectable()
export class MetadataProviderDirectoryService {
  private readonly logger = new Logger(MetadataProviderDirectoryService.name);
  private cached: CachedDirectory | null = null;
  private lastAttemptAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>) {}

  async get(): Promise<MetadataProviderDirectory> {
    const url = this.config.metadataProviderDirectoryUrl;
    if (url && (this.inFlight || this.isDue())) await this.refresh(url);
    if (url && this.cached) {
      return { providers: this.cached.providers, source: 'remote', fetchedAt: this.cached.fetchedAt.toISOString() };
    }
    return { providers: [...BUNDLED_PROVIDER_DIRECTORY], source: 'bundled', fetchedAt: null };
  }

  private isDue(): boolean {
    const now = Date.now();
    if (this.cached && now - this.cached.fetchedAt.getTime() < FRESH_FOR_MS) return false;
    return now - this.lastAttemptAt >= RETRY_AFTER_MS;
  }

  /** Callers arriving together share one request. */
  private refresh(url: string): Promise<void> {
    this.inFlight ??= this.fetchDirectory(url).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchDirectory(url: string): Promise<void> {
    const startedAt = Date.now();
    this.lastAttemptAt = startedAt;
    this.logger.log(`[metadata_provider_directory.fetch] [start] url="${sanitizeLogValue(url)}" - reading the provider directory`);
    try {
      const body = await requestBounded(url);
      const providers = parseProviderDirectory(JSON.parse(body));
      if (!providers) throw new Error('the directory lists no usable providers');
      this.cached = { providers, fetchedAt: new Date() };
      this.logger.log(
        `[metadata_provider_directory.fetch] [end] url="${sanitizeLogValue(url)}" durationMs=${Date.now() - startedAt} providers=${providers.length} - provider directory read`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[metadata_provider_directory.fetch] [fail] url="${sanitizeLogValue(url)}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - keeping the ${this.cached ? 'last' : 'bundled'} directory`,
      );
    }
  }
}

async function requestBounded(rawUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await safeFetch(current, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (location) {
        await response.body?.cancel().catch(() => undefined);
        const next = new URL(location, current);
        if (next.protocol !== 'https:') throw new Error('the directory redirected away from https');
        current = next.href;
        continue;
      }
      if (!response.ok) throw new Error(`the directory answered ${response.status}`);
      return await readBounded(response);
    }
    throw new Error(`the directory redirected more than ${MAX_REDIRECTS} times`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error(`the directory is larger than ${MAX_BYTES} bytes`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
