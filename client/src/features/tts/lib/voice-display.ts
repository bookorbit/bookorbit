import type { TtsVoice } from '@bookorbit/types'

export function formatVoiceDisplayName(voice: TtsVoice): string {
  return voice.name.trim() || voice.shortName || voice.id
}

export function formatVoiceLocaleLabel(voice: TtsVoice): string {
  const parsed = parseVoiceLanguageCountry(voice)
  return parsed.countryName ? `${parsed.languageName} (${parsed.countryName})` : parsed.languageName
}

export function parseVoiceLanguageCountry(voice: TtsVoice): { languageName: string; countryName: string } {
  return parseLanguageCountryFromLocale(voice.locale)
}

export function parseLanguageCountryFromLocale(locale: string): { languageName: string; countryName: string } {
  const languageDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'language' }) : null
  const regionDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

  const normalizedLocale = locale.trim()
  if (!normalizedLocale) return { languageName: '', countryName: '' }

  let languageCode = normalizedLocale
  let regionCode = ''
  try {
    const parsed = new Intl.Locale(normalizedLocale)
    languageCode = parsed.language ?? normalizedLocale
    regionCode = parsed.region ?? ''
  } catch {
    const [language = normalizedLocale, region = ''] = normalizedLocale.split('-')
    languageCode = language
    regionCode = region
  }
  const languageName = getDisplayName(languageDisplayNames, languageCode)
  const countryName = regionCode ? getDisplayName(regionDisplayNames, regionCode) : ''
  return { languageName, countryName }
}

function getDisplayName(displayNames: Intl.DisplayNames | null, code: string): string {
  if (!displayNames || !code) return code
  try {
    return displayNames.of(code) ?? code
  } catch {
    return code
  }
}
