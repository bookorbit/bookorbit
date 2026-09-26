import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { podcastConfig } from '../../config/config';
import { PodcastFeedParserService } from './podcast-feed-parser.service';
import type { PodcastFeedFetchResult } from './podcast.types';
import { parsePodcastUrl, PodcastUrlSecurityService } from './podcast-url-security.service';

@Injectable()
export class PodcastFeedClientService {
  private readonly logger = new Logger(PodcastFeedClientService.name);
  private readonly maxFeedBytes: number;
  private readonly timeoutMs: number;

  constructor(
    @Inject(podcastConfig.KEY) config: ConfigType<typeof podcastConfig>,
    private readonly parser: PodcastFeedParserService,
    private readonly urlSecurity: PodcastUrlSecurityService,
  ) {
    this.maxFeedBytes = config.maxFeedBytes;
    this.timeoutMs = config.requestTimeoutMs;
  }

  async fetchFeed(urlValue: string, cache?: { etag?: string | null; lastModified?: string | null }): Promise<PodcastFeedFetchResult> {
    const url = parsePodcastUrl(urlValue);
    const event = 'podcast.fetch_feed';
    const startedAt = Date.now();
    const redactedUrl = url.origin;
    this.logger.log(
      `[${event}] [start] url="${sanitizeLogValue(redactedUrl)}" cached=${Boolean(cache?.etag || cache?.lastModified)} - feed fetch started`,
    );
    const headers = new Headers({
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      'User-Agent': 'BookOrbit Podcast/1.0',
    });
    if (cache?.etag) headers.set('If-None-Match', cache.etag);
    if (cache?.lastModified) headers.set('If-Modified-Since', cache.lastModified);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const { response, finalUrl } = await this.urlSecurity.fetch(url, { headers, signal: controller.signal });
      if (response.status === 304) {
        this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} status=304 notModified=true bytes=0 - feed fetch completed`);
        return {
          feed: null,
          xml: null,
          finalUrl: finalUrl.toString(),
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          notModified: true,
          status: response.status,
        };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new BadGatewayException(`Podcast feed returned HTTP ${response.status}`);
      }
      const xml = await readBoundedText(response, this.maxFeedBytes);
      this.logger.log(
        `[${event}] [end] durationMs=${Date.now() - startedAt} status=${response.status} notModified=false bytes=${Buffer.byteLength(xml)} - feed fetch completed`,
      );
      return {
        feed: this.parser.parse(xml),
        xml,
        finalUrl: finalUrl.toString(),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        notModified: false,
        status: response.status,
      };
    } catch (error) {
      const mappedError =
        error instanceof BadRequestException || error instanceof BadGatewayException || error instanceof PayloadTooLargeException
          ? error
          : error instanceof Error && error.name === 'AbortError'
            ? new BadGatewayException('Podcast feed request timed out')
            : new BadGatewayException('Podcast feed request failed');
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${mappedError.constructor.name} error="${sanitizeLogValue(mappedError.message)}" - feed fetch failed`,
      );
      throw mappedError;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new PayloadTooLargeException('Podcast feed exceeds the configured size limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new PayloadTooLargeException('Podcast feed exceeds the configured size limit');
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeFeedText(data, response.headers.get('content-type'));
}

function decodeFeedText(data: Uint8Array, contentType: string | null): string {
  const headerEncoding = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType ?? '')?.[1];
  const bomEncoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : null;
  const declaration = new TextDecoder('latin1').decode(data.subarray(0, Math.min(data.length, 256))).replaceAll('\0', '');
  const xmlEncoding = /<\?xml[^>]+encoding\s*=\s*["']([^"']+)["']/i.exec(declaration)?.[1];
  const encoding = bomEncoding ?? headerEncoding ?? xmlEncoding ?? 'utf-8';
  try {
    return new TextDecoder(encoding).decode(data);
  } catch {
    return new TextDecoder().decode(data);
  }
}
