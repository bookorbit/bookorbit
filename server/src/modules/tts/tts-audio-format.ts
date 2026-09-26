/**
 * The audio formats a client may request, and how each one is announced.
 *
 * The format travels from the client to the upstream provider untouched, so this list is the set
 * both ends agree on. Announcing the wrong content type is worse than refusing an unknown format:
 * a player told it has MPEG audio when it holds AAC fails somewhere far from here.
 */
export const TTS_AUDIO_FORMATS = ['mp3', 'aac', 'opus', 'flac', 'wav', 'pcm'] as const;

export type TtsAudioFormat = (typeof TTS_AUDIO_FORMATS)[number];

export const DEFAULT_TTS_AUDIO_FORMAT: TtsAudioFormat = 'mp3';

const CONTENT_TYPES: Record<TtsAudioFormat, string> = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  // Kokoro returns Opus inside an Ogg container rather than bare Opus frames.
  opus: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/L16',
};

export function ttsContentType(format: string | undefined): string {
  return CONTENT_TYPES[format as TtsAudioFormat] ?? CONTENT_TYPES[DEFAULT_TTS_AUDIO_FORMAT];
}
