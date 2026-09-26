export interface StaticVoiceConfig {
  id: string
  name: string
  shortName: string
  language: string
  locale: string
  gender: 'Male' | 'Female' | 'Unknown' | ''
}

export type PresetKey = 'kokoro' | 'openai'

export function detectPreset(model: string | null | undefined): PresetKey | null {
  if (!model) return null
  const lower = model.toLowerCase()
  if (lower.includes('kokoro')) return 'kokoro'
  if (['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'].includes(lower)) return 'openai'
  return null
}

export const PRESET_VOICES: Record<PresetKey, StaticVoiceConfig[]> = {
  kokoro: [
    { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
    { id: 'af_bella', name: 'Bella', shortName: 'af_bella', language: 'English', locale: 'en-US', gender: 'Female' },
    { id: 'af_sarah', name: 'Sarah', shortName: 'af_sarah', language: 'English', locale: 'en-US', gender: 'Female' },
    { id: 'af_sky', name: 'Sky', shortName: 'af_sky', language: 'English', locale: 'en-US', gender: 'Female' },
    { id: 'af_nicole', name: 'Nicole', shortName: 'af_nicole', language: 'English', locale: 'en-US', gender: 'Female' },
    { id: 'am_adam', name: 'Adam', shortName: 'am_adam', language: 'English', locale: 'en-US', gender: 'Male' },
    { id: 'am_michael', name: 'Michael', shortName: 'am_michael', language: 'English', locale: 'en-US', gender: 'Male' },
    { id: 'am_liam', name: 'Liam', shortName: 'am_liam', language: 'English', locale: 'en-US', gender: 'Male' },
    { id: 'bf_emma', name: 'Emma', shortName: 'bf_emma', language: 'English', locale: 'en-GB', gender: 'Female' },
    { id: 'bf_isabella', name: 'Isabella', shortName: 'bf_isabella', language: 'English', locale: 'en-GB', gender: 'Female' },
    { id: 'bm_george', name: 'George', shortName: 'bm_george', language: 'English', locale: 'en-GB', gender: 'Male' },
    { id: 'bm_lewis', name: 'Lewis', shortName: 'bm_lewis', language: 'English', locale: 'en-GB', gender: 'Male' },
  ],
  openai: [
    { id: 'alloy', name: 'Alloy', shortName: 'alloy', language: 'English', locale: 'en-US', gender: 'Female' },
    { id: 'echo', name: 'Echo', shortName: 'echo', language: 'English', locale: 'en-US', gender: 'Male' },
    { id: 'fable', name: 'Fable', shortName: 'fable', language: 'English', locale: 'en-US', gender: 'Male' },
    { id: 'onyx', name: 'Onyx', shortName: 'onyx', language: 'English', locale: 'en-US', gender: 'Male' },
    { id: 'nova', name: 'Nova', shortName: 'nova', language: 'English', locale: 'en-US', gender: 'Female' },
    { id: 'shimmer', name: 'Shimmer', shortName: 'shimmer', language: 'English', locale: 'en-US', gender: 'Female' },
  ],
}

const ALLOWED_GENDERS: StaticVoiceConfig['gender'][] = ['Male', 'Female', 'Unknown', '']

/**
 * Narrows anything voice-shaped down to what a provider's curated list may contain.
 *
 * Discovered voices arrive as full catalog entries carrying `providerId` and `providerName`, and
 * their gender is whatever the upstream reported. The curation DTO whitelists both the fields and
 * the gender values, so a voice copied straight from discovery into the saved list is rejected
 * wholesale. Everything that reaches the save path goes through here instead.
 */
export function toStaticVoiceConfig(voice: {
  id: string
  name?: string
  shortName?: string
  language?: string
  locale?: string
  gender?: string
}): StaticVoiceConfig {
  const gender = ALLOWED_GENDERS.find((allowed) => allowed !== '' && allowed.toLowerCase() === (voice.gender ?? '').toLowerCase())
  return {
    id: voice.id,
    name: voice.name || voice.id,
    shortName: voice.shortName || voice.id,
    language: voice.language ?? '',
    locale: voice.locale ?? '',
    gender: gender ?? 'Unknown',
  }
}

export function mergeVoices(existing: StaticVoiceConfig[], incoming: StaticVoiceConfig[]): StaticVoiceConfig[] {
  const existingIds = new Set(existing.map((v) => v.id))
  const novel = incoming.filter((v) => v.id && !existingIds.has(v.id))
  return [...existing, ...novel]
}
