import { afterEach, describe, expect, it } from 'vitest'
import { setI18nLocale } from '@/i18n'
import { formatBytes } from '@/lib/formatting'
import { formatDate, formatLanguageName, formatNumber } from './formatters'

describe('locale formatters', () => {
  afterEach(async () => {
    await setI18nLocale('en')
  })

  it('formats numbers with the active BookOrbit locale', async () => {
    await setI18nLocale('en')
    expect(formatNumber(1234.5)).toBe('1,234.5')

    await setI18nLocale('nl')
    expect(formatNumber(1234.5)).toBe('1.234,5')
  })

  it('formats dates with the active BookOrbit locale', async () => {
    const date = new Date('2026-01-15T12:00:00Z')

    await setI18nLocale('en')
    expect(formatDate(date, { month: 'long', timeZone: 'UTC' })).toBe('January')

    await setI18nLocale('nl')
    expect(formatDate(date, { month: 'long', timeZone: 'UTC' })).toBe('januari')
  })

  it('formats language codes and safely preserves custom language values', async () => {
    await setI18nLocale('en')
    expect(formatLanguageName('de')).toBe('German')
    expect(formatLanguageName('Custom language')).toBe('Custom language')
  })

  it('formats file sizes with localized decimals', async () => {
    await setI18nLocale('en')
    expect(formatBytes(1536)).toBe('1.5 KB')

    await setI18nLocale('nl')
    expect(formatBytes(1536)).toBe('1,5 KB')
  })
})
