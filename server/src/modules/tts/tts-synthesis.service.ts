import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';

import type { TtsWordTiming } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { ITtsProvider, ProviderCaptionedSpeech } from './providers/tts-provider.interface';

const DEFAULT_MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const PREVIEW_TEXT = 'Hello, this is a preview of the selected voice.';

export const TTS_SYNTHESIS_MAX_ENTRIES = Symbol('TTS_SYNTHESIS_MAX_ENTRIES');

export interface CaptionedSynthesisResult {
  buffer: Buffer;
  words: TtsWordTiming[];
}

@Injectable()
export class TtsSynthesisService {
  private readonly logger = new Logger(TtsSynthesisService.name);
  private readonly cache = new Map<string, Buffer>();
  private readonly captionedCache = new Map<string, CaptionedSynthesisResult>();
  private readonly maxEntries: number;

  constructor(@Optional() @Inject(TTS_SYNTHESIS_MAX_ENTRIES) maxEntries?: number) {
    this.maxEntries = maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async synthesize(provider: ITtsProvider, providerId: string, voiceId: string, speed: number, text: string, format = 'mp3'): Promise<Buffer> {
    const event = 'tts.synthesis';
    const cacheKey = this.buildCacheKey(providerId, voiceId, speed, text, format);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug(`[${event}] cache_hit providerId=${providerId} voiceId=${voiceId} - returning cached audio`);
      return cached;
    }

    const startMs = Date.now();
    this.logger.log(`[${event}] [start] providerId=${providerId} voiceId=${voiceId} speed=${speed} textLen=${text.length} - synthesis started`);
    try {
      const buffer = await provider.synthesize(text, voiceId, speed, format);
      this.logger.log(
        `[${event}] [end] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} bytes=${buffer.length} - synthesis completed`,
      );
      if (buffer.length <= MAX_ENTRY_BYTES) {
        this.addToCache(cacheKey, buffer);
      }
      return buffer;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - synthesis failed`,
      );
      throw err;
    }
  }

  /**
   * Audio plus word timings when the provider can produce them.
   *
   * A provider without a working word-timing endpoint is not an error: the plain synthesis path
   * runs instead and the caller gets audio with an empty `words`, which readers treat as
   * block-level narration. The captioned result keeps its own cache because it holds strictly more
   * than the audio-only entry and the two must not be mistaken for each other.
   */
  async synthesizeCaptioned(
    provider: ITtsProvider,
    providerId: string,
    voiceId: string,
    speed: number,
    text: string,
    format = 'mp3',
  ): Promise<CaptionedSynthesisResult> {
    if (!provider.synthesizeCaptioned) {
      return { buffer: await this.synthesize(provider, providerId, voiceId, speed, text, format), words: [] };
    }

    const event = 'tts.synthesis_captioned';
    const cacheKey = this.buildCacheKey(providerId, voiceId, speed, text, format);
    const cached = this.captionedCache.get(cacheKey);
    if (cached) {
      this.logger.debug(`[${event}] cache_hit providerId=${providerId} voiceId=${voiceId} - returning cached synthesis result`);
      return cached;
    }

    const startMs = Date.now();
    this.logger.log(
      `[${event}] [start] providerId=${providerId} voiceId=${voiceId} speed=${speed} textLen=${text.length} - captioned synthesis started`,
    );
    let captioned: ProviderCaptionedSpeech | null;
    try {
      captioned = await provider.synthesizeCaptioned(text, voiceId, speed, format);
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.warn(
        `[${event}] [end] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} words=0 errorClass=${errorClass} error="${error}" - captioned synthesis failed, using plain synthesis`,
      );
      const result = { buffer: await this.synthesize(provider, providerId, voiceId, speed, text, format), words: [] };
      if (result.buffer.length <= MAX_ENTRY_BYTES) {
        this.addCaptionedToCache(cacheKey, result);
      }
      return result;
    }

    try {
      if (!captioned) {
        this.logger.log(
          `[${event}] [end] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} words=0 - provider has no word timings, using plain synthesis`,
        );
        return { buffer: await this.synthesize(provider, providerId, voiceId, speed, text, format), words: [] };
      }
      const result: CaptionedSynthesisResult = { buffer: captioned.audio, words: captioned.words };
      this.logger.log(
        `[${event}] [end] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} bytes=${result.buffer.length} words=${result.words.length} - captioned synthesis completed`,
      );
      if (result.buffer.length <= MAX_ENTRY_BYTES) {
        this.addCaptionedToCache(cacheKey, result);
      }
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - captioned synthesis failed`,
      );
      throw err;
    }
  }

  async previewVoice(provider: ITtsProvider, providerId: string, voiceId: string): Promise<Buffer> {
    return this.synthesize(provider, providerId, voiceId, 1.0, PREVIEW_TEXT);
  }

  private buildCacheKey(providerId: string, voiceId: string, speed: number, text: string, format: string): string {
    return createHash('sha256').update(`${providerId}|${voiceId}|${speed}|${format}|${text}`).digest('hex');
  }

  private addToCache(key: string, buffer: Buffer): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, buffer);
  }

  private addCaptionedToCache(key: string, result: CaptionedSynthesisResult): void {
    if (this.captionedCache.size >= this.maxEntries) {
      const firstKey = this.captionedCache.keys().next().value;
      if (firstKey !== undefined) this.captionedCache.delete(firstKey);
    }
    this.captionedCache.set(key, result);
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  getCaptionedCacheSize(): number {
    return this.captionedCache.size;
  }

  clearCache(): void {
    this.cache.clear();
    this.captionedCache.clear();
  }
}
