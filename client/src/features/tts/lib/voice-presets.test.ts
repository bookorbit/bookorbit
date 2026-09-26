import { describe, it, expect } from 'vitest'
import { detectPreset, mergeVoices, PRESET_VOICES, toStaticVoiceConfig } from './voice-presets'
import type { StaticVoiceConfig } from './voice-presets'

describe('detectPreset', () => {
  it('returns kokoro for model containing kokoro (exact)', () => {
    expect(detectPreset('kokoro')).toBe('kokoro')
  })

  it('returns kokoro for model containing kokoro (case-insensitive)', () => {
    expect(detectPreset('Kokoro-v1.1')).toBe('kokoro')
    expect(detectPreset('KOKORO')).toBe('kokoro')
  })

  it('returns openai for tts-1', () => {
    expect(detectPreset('tts-1')).toBe('openai')
  })

  it('returns openai for tts-1-hd', () => {
    expect(detectPreset('tts-1-hd')).toBe('openai')
  })

  it('returns openai for gpt-4o-mini-tts', () => {
    expect(detectPreset('gpt-4o-mini-tts')).toBe('openai')
  })

  it('returns null for unknown model', () => {
    expect(detectPreset('whisper-1')).toBeNull()
    expect(detectPreset('custom-model')).toBeNull()
  })

  it('returns null for null/undefined/empty', () => {
    expect(detectPreset(null)).toBeNull()
    expect(detectPreset(undefined)).toBeNull()
    expect(detectPreset('')).toBeNull()
  })
})

describe('PRESET_VOICES.kokoro', () => {
  it('contains 12 voices', () => {
    expect(PRESET_VOICES.kokoro).toHaveLength(12)
  })

  it('has en-US and en-GB voices', () => {
    const usVoices = PRESET_VOICES.kokoro.filter((v) => v.locale === 'en-US')
    const gbVoices = PRESET_VOICES.kokoro.filter((v) => v.locale === 'en-GB')
    expect(usVoices.length).toBeGreaterThan(0)
    expect(gbVoices.length).toBeGreaterThan(0)
  })

  it('all voices have required fields', () => {
    for (const v of PRESET_VOICES.kokoro) {
      expect(v.id).toBeTruthy()
      expect(v.name).toBeTruthy()
      expect(v.shortName).toBeTruthy()
      expect(['Male', 'Female', 'Unknown', '']).toContain(v.gender)
    }
  })

  it('af_heart is the first voice', () => {
    expect(PRESET_VOICES.kokoro[0]?.id).toBe('af_heart')
  })
})

describe('PRESET_VOICES.openai', () => {
  it('contains 6 voices', () => {
    expect(PRESET_VOICES.openai).toHaveLength(6)
  })

  it('contains alloy, echo, fable, onyx, nova, shimmer', () => {
    const ids = PRESET_VOICES.openai.map((v) => v.id)
    expect(ids).toContain('alloy')
    expect(ids).toContain('echo')
    expect(ids).toContain('fable')
    expect(ids).toContain('onyx')
    expect(ids).toContain('nova')
    expect(ids).toContain('shimmer')
  })

  it('all voices have en-US locale', () => {
    for (const v of PRESET_VOICES.openai) {
      expect(v.locale).toBe('en-US')
    }
  })
})

describe('mergeVoices', () => {
  const makeVoice = (id: string): StaticVoiceConfig => ({
    id,
    name: id,
    shortName: id,
    language: 'English',
    locale: 'en-US',
    gender: 'Female',
  })

  it('appends non-duplicate voices', () => {
    const existing = [makeVoice('a')]
    const incoming = [makeVoice('b'), makeVoice('c')]
    const result = mergeVoices(existing, incoming)
    expect(result).toHaveLength(3)
    expect(result.map((v) => v.id)).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates by id, keeping existing', () => {
    const existing = [makeVoice('a'), makeVoice('b')]
    const incoming = [makeVoice('b'), makeVoice('c')]
    const result = mergeVoices(existing, incoming)
    expect(result).toHaveLength(3)
    expect(result.map((v) => v.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns existing unchanged when all incoming are duplicates', () => {
    const existing = [makeVoice('a'), makeVoice('b')]
    const incoming = [makeVoice('a'), makeVoice('b')]
    const result = mergeVoices(existing, incoming)
    expect(result).toHaveLength(2)
  })

  it('handles empty existing', () => {
    const result = mergeVoices([], [makeVoice('a')])
    expect(result).toHaveLength(1)
  })

  it('handles empty incoming', () => {
    const result = mergeVoices([makeVoice('a')], [])
    expect(result).toHaveLength(1)
  })

  it('filters out incoming voices with empty id', () => {
    const existing: StaticVoiceConfig[] = []
    const incoming = [{ ...makeVoice(''), id: '' }]
    const result = mergeVoices(existing, incoming)
    expect(result).toHaveLength(0)
  })
})

describe('toStaticVoiceConfig', () => {
  it('drops the catalog fields the curation DTO rejects', () => {
    const discovered = {
      id: 'af_alloy',
      name: 'af_alloy',
      shortName: 'af_alloy',
      language: 'English',
      locale: 'en-US',
      gender: 'Female',
      providerId: '1',
      providerName: 'Kokoro',
    }

    expect(toStaticVoiceConfig(discovered)).toEqual({
      id: 'af_alloy',
      name: 'af_alloy',
      shortName: 'af_alloy',
      language: 'English',
      locale: 'en-US',
      gender: 'Female',
    })
    expect(Object.keys(toStaticVoiceConfig(discovered))).not.toContain('providerId')
  })

  it('falls back to Unknown for a gender the DTO does not allow', () => {
    expect(toStaticVoiceConfig({ id: 'alloy', gender: 'Neutral' }).gender).toBe('Unknown')
    expect(toStaticVoiceConfig({ id: 'alloy' }).gender).toBe('Unknown')
  })

  it('accepts the gender whatever case the provider reported it in', () => {
    expect(toStaticVoiceConfig({ id: 'a', gender: 'female' }).gender).toBe('Female')
    expect(toStaticVoiceConfig({ id: 'a', gender: 'MALE' }).gender).toBe('Male')
  })

  it('names a voice after its id when the provider sent no name', () => {
    expect(toStaticVoiceConfig({ id: 'zf_xiaobei' })).toEqual({
      id: 'zf_xiaobei',
      name: 'zf_xiaobei',
      shortName: 'zf_xiaobei',
      language: '',
      locale: '',
      gender: 'Unknown',
    })
  })
})
