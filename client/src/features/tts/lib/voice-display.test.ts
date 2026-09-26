import { describe, expect, it } from 'vitest'
import type { TtsVoice } from '@bookorbit/types'
import { parseVoiceLanguageCountry } from './voice-display'

function makeVoice(overrides: Partial<TtsVoice> = {}): TtsVoice {
  return {
    id: 'af_heart',
    name: 'af_heart',
    shortName: 'af_heart',
    language: '',
    locale: '',
    gender: 'Unknown',
    providerId: '1',
    providerName: 'Kokoro',
    ...overrides,
  }
}

describe('parseVoiceLanguageCountry', () => {
  it('handles a voice without locale metadata', () => {
    expect(parseVoiceLanguageCountry(makeVoice())).toEqual({ languageName: '', countryName: '' })
  })

  it('falls back to an invalid locale instead of throwing', () => {
    expect(parseVoiceLanguageCountry(makeVoice({ locale: 'invalid_locale' }))).toEqual({
      languageName: 'invalid_locale',
      countryName: '',
    })
  })
})
