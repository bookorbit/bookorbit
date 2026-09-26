import { Injectable, Logger } from '@nestjs/common';

import type { TtsVoice, TtsWordTiming } from '@bookorbit/types';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { ITtsProvider, ProviderCaptionedSpeech } from './tts-provider.interface';

interface OpenAiSpeechRequest {
  model: string;
  input: string;
  voice: string;
  speed: number;
  response_format: string;
}

/**
 * Kokoro-FastAPI's captioned-speech request. It is not part of the OpenAI audio API, and the route
 * is mounted at the server root rather than under the `/v1` base path the rest of this provider
 * uses, so it is reached from the derived root and its availability is discovered rather than
 * assumed.
 */
interface CaptionedSpeechRequest extends OpenAiSpeechRequest {
  stream: false;
  return_timestamps: true;
}

const CAPTIONED_SPEECH_PATH = '/dev/captioned_speech';
const CAPTIONED_REQUEST_TIMEOUT_MS = 120_000;
const CAPTIONED_MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

export interface StaticVoiceConfig {
  id: string;
  name: string;
  shortName: string;
  language: string;
  locale: string;
  gender: string;
}

export interface OpenAiCompatibleConfig {
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel?: string | null;
  staticVoices?: StaticVoiceConfig[] | null;
  supportsVoiceDiscovery?: boolean;
}

interface VoiceMetadata {
  name: string;
  shortName: string;
  language: string;
  locale: string;
  gender: string;
}

const KOKORO_LANGUAGE_METADATA: Record<string, Pick<VoiceMetadata, 'language' | 'locale'>> = {
  a: { language: 'English', locale: 'en-US' },
  b: { language: 'English', locale: 'en-GB' },
  e: { language: 'Spanish', locale: 'es-ES' },
  f: { language: 'French', locale: 'fr-FR' },
  h: { language: 'Hindi', locale: 'hi-IN' },
  i: { language: 'Italian', locale: 'it-IT' },
  j: { language: 'Japanese', locale: 'ja-JP' },
  p: { language: 'Portuguese', locale: 'pt-BR' },
  z: { language: 'Chinese', locale: 'zh-CN' },
};

@Injectable()
export class OpenAiCompatibleProvider implements ITtsProvider {
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly providerId: string;
  private readonly providerName: string;
  private readonly defaultModel: string;
  private readonly staticVoices: StaticVoiceConfig[] | null;
  private readonly supportsVoiceDiscovery: boolean;
  /** Unknown until the endpoint has been tried once, then remembered for this provider instance. */
  private captionedSupported: boolean | null = null;

  constructor(config: OpenAiCompatibleConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.providerId = config.providerId;
    this.providerName = config.providerName;
    this.defaultModel = config.defaultModel || 'tts-1';
    this.staticVoices = config.staticVoices ?? null;
    this.supportsVoiceDiscovery = config.supportsVoiceDiscovery ?? true;
  }

  async synthesize(text: string, voiceId: string, speed: number, format: string): Promise<Buffer> {
    const event = 'tts.openai.synthesize';
    const startMs = Date.now();
    this.logger.log(
      `[${event}] [start] providerId=${this.providerId} voiceId=${voiceId} speed=${speed} textLen=${text.length} - openai-compatible tts synthesis started`,
    );
    try {
      const body: OpenAiSpeechRequest = {
        model: this.defaultModel,
        input: text,
        voice: voiceId,
        speed: Math.min(4.0, Math.max(0.25, speed)),
        response_format: format === 'mp3' ? 'mp3' : format,
      };
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`TTS API error ${response.status}: ${errText.slice(0, 200)}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const result = Buffer.from(arrayBuffer);
      this.logger.log(
        `[${event}] [end] providerId=${this.providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} bytes=${result.length} - openai-compatible synthesis completed`,
      );
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${this.providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - openai-compatible synthesis failed`,
      );
      throw err;
    }
  }

  async synthesizeCaptioned(text: string, voiceId: string, speed: number, format: string): Promise<ProviderCaptionedSpeech | null> {
    if (this.captionedSupported === false) return null;
    const event = 'tts.openai.synthesize_captioned';
    const startMs = Date.now();
    const url = `${this.captionedRoot()}${CAPTIONED_SPEECH_PATH}`;
    try {
      const body: CaptionedSpeechRequest = {
        model: this.defaultModel,
        input: text,
        voice: voiceId,
        speed: Math.min(4.0, Math.max(0.25, speed)),
        response_format: format,
        stream: false,
        return_timestamps: true,
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CAPTIONED_REQUEST_TIMEOUT_MS),
      });
      // A provider without the endpoint answers 404, and one that exposes the path for another verb
      // answers 405. Either way this provider has no word timings and never will, so it stops asking.
      if (response.status === 404 || response.status === 405) {
        this.captionedSupported = false;
        this.logger.log(
          `[${event}] providerId=${this.providerId} status=${response.status} - provider has no captioned speech endpoint, falling back`,
        );
        return null;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Captioned speech API error ${response.status}: ${errText.slice(0, 200)}`);
      }
      const parsed = await this.readCaptionedResponse(response);
      if (!parsed) {
        // The endpoint answered but not in the shape this expects. Treat it as unsupported rather
        // than failing the synthesis, because the caller can still produce audio without timings.
        this.captionedSupported = false;
        this.logger.warn(`[${event}] providerId=${this.providerId} - captioned response was not usable, falling back`);
        return null;
      }
      this.captionedSupported = true;
      this.logger.log(
        `[${event}] [end] providerId=${this.providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} bytes=${parsed.audio.length} words=${parsed.words.length} - captioned synthesis completed`,
      );
      return parsed;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${this.providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - captioned synthesis failed`,
      );
      throw err;
    }
  }

  /**
   * The captioned route lives beside the API base rather than under it, so a `/v1` style suffix is
   * dropped to get back to the server root.
   */
  private captionedRoot(): string {
    return this.baseUrl.replace(/\/v\d+$/, '');
  }

  private async readCaptionedResponse(response: Response): Promise<ProviderCaptionedSpeech | null> {
    const raw = await response.arrayBuffer();
    if (raw.byteLength > CAPTIONED_MAX_RESPONSE_BYTES) {
      throw new Error(`Captioned speech response exceeded ${CAPTIONED_MAX_RESPONSE_BYTES} bytes`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      return null;
    }
    if (typeof payload !== 'object' || payload === null) return null;
    const record = payload as Record<string, unknown>;
    const encodedAudio = typeof record.audio === 'string' ? record.audio : '';
    if (!encodedAudio) return null;
    const audio = Buffer.from(encodedAudio, 'base64');
    if (audio.length === 0) return null;
    return { audio, words: this.normalizeWordTimings(record.timestamps) };
  }

  private normalizeWordTimings(value: unknown): TtsWordTiming[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const word = typeof record.word === 'string' ? record.word : '';
      const startTime = typeof record.start_time === 'number' ? record.start_time : Number.NaN;
      const endTime = typeof record.end_time === 'number' ? record.end_time : Number.NaN;
      if (!word || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return [];
      return { word, startTime: Math.max(0, startTime), endTime: Math.max(0, endTime) };
    });
  }

  async listVoices(): Promise<TtsVoice[]> {
    const event = 'tts.openai.list_voices';
    const startMs = Date.now();
    // A provider that is marked as having no voice-list endpoint is not probed at listing time
    // either, so its curated voices are the whole catalogue and no request is wasted.
    if (!this.supportsVoiceDiscovery) {
      const voices = this.mapStaticVoices();
      this.logger.log(
        `[${event}] [end] providerId=${this.providerId} durationMs=${Date.now() - startMs} count=${voices.length} source=static - voice discovery disabled, using curated voices`,
      );
      return voices;
    }
    this.logger.log(`[${event}] [start] providerId=${this.providerId} - listing voices`);
    try {
      const response = await fetch(`${this.baseUrl}/audio/voices`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) {
          if (this.staticVoices && this.staticVoices.length > 0) {
            const voices = this.mapStaticVoices();
            this.logger.log(
              `[${event}] [end] providerId=${this.providerId} durationMs=${Date.now() - startMs} count=${voices.length} source=static - using configured static voices`,
            );
            return voices;
          }
          this.logger.warn(`[${event}] provider ${this.providerId} does not expose /audio/voices - returning empty list`);
          return [];
        }
        const errText = await response.text().catch(() => '');
        throw new Error(`Voice list API error ${response.status}: ${errText.slice(0, 200)}`);
      }
      const rawVoices = this.extractVoiceEntries(await response.json());
      const liveVoices = this.mapApiVoices(rawVoices);
      const voices = this.applyCuration(liveVoices);
      this.logger.log(
        `[${event}] [end] providerId=${this.providerId} durationMs=${Date.now() - startMs} count=${voices.length} liveCount=${liveVoices.length} - voices listed`,
      );
      return voices;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      if (this.staticVoices && this.staticVoices.length > 0) {
        this.logger.warn(
          `[${event}] providerId=${this.providerId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - voice list fetch failed, using static voices`,
        );
        return this.mapStaticVoices();
      }
      this.logger.error(
        `[${event}] [fail] providerId=${this.providerId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - voice list failed`,
      );
      throw err;
    }
  }

  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) {
        // The voice listing is the fallback reachability probe, so it has to hit the network here
        // even for a provider whose curated catalogue would otherwise answer without a request.
        await this.discoverVoicesLive();
      }
      return { connected: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { connected: false, error: message };
    }
  }

  async discoverVoicesLive(): Promise<TtsVoice[] | null> {
    const response = await fetch(`${this.baseUrl}/audio/voices`, {
      headers: this.buildHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Voice discovery API error ${response.status}: ${errText.slice(0, 200)}`);
    }
    const rawVoices = this.extractVoiceEntries(await response.json());
    return this.mapApiVoices(rawVoices);
  }

  private extractVoiceEntries(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    if (typeof data !== 'object' || data === null || !('voices' in data)) return [];
    return Array.isArray(data.voices) ? data.voices : [];
  }

  private mapApiVoices(rawVoices: unknown[]): TtsVoice[] {
    const staticVoicesById = new Map((this.staticVoices ?? []).map((voice) => [voice.id, voice]));
    return rawVoices.flatMap((voice) => {
      const apiVoice = this.normalizeApiVoice(voice);
      if (!apiVoice) return [];
      const id = apiVoice.id;
      if (!id) return [];
      const staticVoice = staticVoicesById.get(id);
      const derivedVoice = this.defaultModel.toLowerCase().includes('kokoro') ? this.getKokoroVoiceMetadata(id) : null;
      // Curation wins over the live listing. An admin who renamed `af_heart` to "Heart" said what
      // readers should see, and Kokoro reports every voice with its id as the name, so trusting the
      // upstream first would throw that away on every listing.
      return {
        id,
        name: staticVoice?.name || apiVoice.name || derivedVoice?.name || id,
        shortName: staticVoice?.shortName || apiVoice.shortName || derivedVoice?.shortName || id,
        language: staticVoice?.language || apiVoice.language || derivedVoice?.language || '',
        locale: staticVoice?.locale || apiVoice.locale || derivedVoice?.locale || '',
        gender: staticVoice?.gender || apiVoice.gender || derivedVoice?.gender || 'Unknown',
        providerId: this.providerId,
        providerName: this.providerName,
      };
    });
  }

  private normalizeApiVoice(voice: unknown): ({ id: string } & Partial<VoiceMetadata>) | null {
    if (typeof voice === 'string') {
      const id = voice.trim();
      return id ? { id } : null;
    }
    if (typeof voice !== 'object' || voice === null) return null;
    const id = this.readString(voice, 'voice_id') || this.readString(voice, 'id');
    if (!id) return null;
    return {
      id,
      name: this.readString(voice, 'display_name') || this.readString(voice, 'name'),
      shortName: this.readString(voice, 'short_name') || this.readString(voice, 'shortName'),
      language: this.readString(voice, 'language'),
      locale: this.readString(voice, 'locale'),
      gender: this.readString(voice, 'gender'),
    };
  }

  private readString(value: object, key: string): string {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' ? field.trim() : '';
  }

  private getKokoroVoiceMetadata(id: string): VoiceMetadata | null {
    const match = /^([abefhijpz])([fm])_/i.exec(id);
    if (!match) return null;
    const language = KOKORO_LANGUAGE_METADATA[match[1]!.toLowerCase()];
    if (!language) return null;
    const voiceName = id
      .slice(3)
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
    return {
      name: voiceName || id,
      shortName: id,
      language: language.language,
      locale: language.locale,
      gender: match[2]!.toLowerCase() === 'f' ? 'Female' : 'Male',
    };
  }

  /**
   * Curated voices are an allow-list, not a naming hint. Once an operator has curated this
   * provider, those voices are exactly what users are offered, and everything the provider happens
   * to also serve stays hidden.
   *
   * A curated voice the live endpoint does not report is still offered rather than dropped, because
   * an id can be valid for synthesis without appearing in the listing: Kokoro accepts composite ids
   * such as `af_sky+af_bella`, and a provider may serve voices it does not advertise.
   */
  private applyCuration(liveVoices: TtsVoice[]): TtsVoice[] {
    const curated = this.staticVoices ?? [];
    if (curated.length === 0) return liveVoices;
    const liveById = new Map(liveVoices.map((voice) => [voice.id, voice]));
    return curated.flatMap((voice) => {
      if (!voice.id) return [];
      return liveById.get(voice.id) ?? this.mapStaticVoice(voice);
    });
  }

  private mapStaticVoices(): TtsVoice[] {
    return (this.staticVoices ?? []).map((v) => this.mapStaticVoice(v));
  }

  private mapStaticVoice(v: StaticVoiceConfig): TtsVoice {
    return {
      id: v.id,
      name: v.name,
      shortName: v.shortName,
      language: v.language,
      locale: v.locale,
      gender: v.gender,
      providerId: this.providerId,
      providerName: this.providerName,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
}
