import type { TtsVoice, TtsWordTiming } from '@bookorbit/types';

/** Audio plus the word timings the upstream reported alongside it. */
export interface ProviderCaptionedSpeech {
  audio: Buffer;
  words: TtsWordTiming[];
}

export interface ITtsProvider {
  /** `signal` aborts the upstream request once nobody is waiting for the audio. */
  synthesize(text: string, voiceId: string, speed: number, format?: string, signal?: AbortSignal): Promise<Buffer>;
  /**
   * Synthesize with word timings when the upstream can produce them.
   *
   * Resolving to `null` means this provider has no word-timing endpoint, which is the common case:
   * the caller then falls back to plain synthesis and the reader keeps block-level highlighting.
   * Implementing it at all is optional.
   */
  synthesizeCaptioned?(text: string, voiceId: string, speed: number, format?: string): Promise<ProviderCaptionedSpeech | null>;
  listVoices(): Promise<TtsVoice[]>;
  testConnection(): Promise<{ connected: boolean; error?: string }>;
}
