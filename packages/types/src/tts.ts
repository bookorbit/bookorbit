// Admin provider configuration

export interface TtsOpenAiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TtsProviderConfiguration {
  providers: TtsOpenAiProvider[];
}

// Voice representation

export interface TtsVoice {
  id: string;
  name: string;
  shortName: string;
  language: string;
  locale: string;
  gender: string;
  providerId: string;
  providerName: string;
}

// User preferences

export interface TtsUserPreferences {
  providerId: string | null;
  voiceId: string | null;
  speed: number;
}

export interface TtsBookPreferences {
  providerId: string | null;
  voiceId: string | null;
  speed: number | null;
  bookId: number;
}

export interface TtsEffectivePreferences {
  providerId: string | null;
  voiceId: string | null;
  speed: number;
  isBookOverride: boolean;
}

// Playback state

export type TtsPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

// Position persistence

export interface TtsPosition {
  cfi: string;
  chapterIndex: number | null;
}

// Synthesis

export interface TtsSynthesisRequest {
  text: string;
  voiceId: string;
  providerId: string;
  speed: number;
  format?: string;
}

// Provider status (for admin UI)

export interface TtsProviderStatus {
  id: string;
  name: string;
  connected: boolean;
  voiceCount: number;
  error?: string;
}

// Server-side chapter text extraction

export interface TtsChapterSentence {
  text: string;
  index: number;
}

export interface TtsChapterText {
  chapterIndex: number;
  sentences: TtsChapterSentence[];
}

// Provider info exposed to users (no secrets)

export interface TtsProviderInfo {
  id: string;
  name: string;
  type: 'openai-compatible';
}

// Captioned synthesis: audio plus the timing of each spoken word, for readers that
// highlight along with narration. Only providers whose upstream reports word boundaries
// can produce it, so the words array is allowed to be empty.

export interface TtsWordTiming {
  /** The spoken token. Punctuation can arrive as its own entry. */
  word: string;
  /** Seconds into the returned audio, not into the request text. */
  startTime: number;
  endTime: number;
}

export interface TtsCaptionedSpeech {
  /** Base64 audio in the requested format. */
  audio: string;
  format: string;
  words: TtsWordTiming[];
}
