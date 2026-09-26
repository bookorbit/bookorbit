import { afterEach, describe, expect, it } from 'vitest'
import type { WritableComputedRef } from 'vue'
import type { Locale } from '@bookorbit/types'
import { i18n, type MessageSchema } from '@/i18n'
import { formatPlaybackClock, formatPodcastDate, formatPodcastDuration } from './podcast-format'

function activate(locale: Locale, messages?: Record<string, unknown>) {
  if (messages) i18n.global.setLocaleMessage(locale, messages as MessageSchema)
  ;(i18n.global.locale as WritableComputedRef<Locale>).value = locale
}

describe('podcast formatters', () => {
  afterEach(() => {
    activate('en')
  })

  it('formats durations through translated messages rather than baked-in English', () => {
    expect(formatPodcastDuration(3_900)).toBe('1h 5m')
    expect(formatPodcastDuration(150)).toBe('2m')
    expect(formatPodcastDuration(null)).toBe('Duration unavailable')

    activate('de', {
      podcast: {
        labels: {
          durationHoursMinutes: '{hours} Std. {minutes} Min.',
          durationMinutes: '{minutes} Min.',
          durationUnavailable: 'Dauer unbekannt',
        },
      },
    })

    expect(formatPodcastDuration(3_900)).toBe('1 Std. 5 Min.')
    expect(formatPodcastDuration(150)).toBe('2 Min.')
    expect(formatPodcastDuration(null)).toBe('Dauer unbekannt')
  })

  it('formats dates in the active application locale, not the browser locale', () => {
    const iso = '2026-07-11T12:00:00.000Z'
    const english = formatPodcastDate(iso)

    activate('de', {})
    const german = formatPodcastDate(iso)

    expect(english).not.toBe(german)
    expect(german).toContain('2026')
  })

  it('reports an unknown date through a translated message', () => {
    expect(formatPodcastDate(null)).toBe('Unknown date')
    expect(formatPodcastDate('not-a-date')).toBe('Unknown date')

    activate('de', { podcast: { labels: { unknownDate: 'Unbekanntes Datum' } } })

    expect(formatPodcastDate(null)).toBe('Unbekanntes Datum')
  })

  it('formats the playback clock as M:SS below an hour and H:MM:SS above it', () => {
    expect(formatPlaybackClock(0)).toBe('0:00')
    expect(formatPlaybackClock(9)).toBe('0:09')
    expect(formatPlaybackClock(600)).toBe('10:00')
    expect(formatPlaybackClock(3_599)).toBe('59:59')
    expect(formatPlaybackClock(3_600)).toBe('1:00:00')
    expect(formatPlaybackClock(3_905.7)).toBe('1:05:05')
  })

  it('clamps unusable playback positions instead of rendering NaN', () => {
    expect(formatPlaybackClock(-30)).toBe('0:00')
    expect(formatPlaybackClock(Number.NaN)).toBe('0:00')
    expect(formatPlaybackClock(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})
