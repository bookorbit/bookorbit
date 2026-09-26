import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFiveFieldCronExpression } from '@bookorbit/types'

import { parseCronToHuman } from '../cron'

function mockBrowserClock(locale: string, hour12: boolean): void {
  const NativeDateTimeFormat = Intl.DateTimeFormat
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function dateTimeFormat(requestedLocale, options) {
    const formatter = new NativeDateTimeFormat(requestedLocale, options)
    if (requestedLocale === undefined) {
      vi.spyOn(formatter, 'resolvedOptions').mockReturnValue({ ...formatter.resolvedOptions(), locale, hour12 })
    }
    return formatter
  })
}

afterEach(() => vi.restoreAllMocks())

describe('isFiveFieldCronExpression', () => {
  it.each(['0 4 * * *', '*/30 * * * *', '0 0 * * 1', '0 4 * * MON', '0  4 * * *', '1-5/2 * * * *', '0 4 * jan-mar *'])(
    'accepts %s and previews it',
    (expression) => {
      expect(isFiveFieldCronExpression(expression)).toBe(true)
      expect(parseCronToHuman(expression, 'en')).not.toBe(expression)
    },
  )

  it.each(['not a cron', '0 99 * * *', '* * * * * *', '*/0 * * * *', '5-1 * * * *', '0 4 */0 * *', '@daily', '0 4 * * FRI-MON'])(
    'rejects %s',
    (expression) => {
      expect(isFiveFieldCronExpression(expression)).toBe(false)
    },
  )
})

describe('parseCronToHuman', () => {
  it('uses the browser clock for an English regional preference', () => {
    mockBrowserClock('en-GB', false)

    expect(parseCronToHuman('31 12,0 * * *', 'en')).toBe('At 00:31 and 12:31')
  })

  it('preserves a 12-hour English browser preference', () => {
    mockBrowserClock('en-US', true)

    expect(parseCronToHuman('31 12,0 * * *', 'en')).toBe('At 12:31 AM and 12:31 PM')
  })

  it('uses the selected language convention when it differs from the browser language', () => {
    mockBrowserClock('en-US', true)

    expect(parseCronToHuman('31 12,0 * * *', 'nl')).toBe('At 00:31 and 12:31')
  })

  it('preserves the English convention with a Dutch browser language', () => {
    mockBrowserClock('nl-BE', false)

    expect(parseCronToHuman('31 12,0 * * *', 'en')).toBe('At 12:31 AM and 12:31 PM')
  })

  it('returns null for null input', () => {
    expect(parseCronToHuman(null, 'en')).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseCronToHuman(undefined, 'en')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseCronToHuman('', 'en')).toBeNull()
  })

  it('uses a 12-hour clock for locales that prefer it', () => {
    const result = parseCronToHuman('17 14 * * *', 'en')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('02:17 pm')
  })

  it('uses a 24-hour clock for locales that prefer it', () => {
    const result = parseCronToHuman('17 14 * * *', 'nl')
    expect(result).not.toBeNull()
    expect(result).toContain('14:17')
    expect(result).not.toMatch(/am|pm/i)
  })

  it('parses an every-5-minutes cron', () => {
    const result = parseCronToHuman('*/5 * * * *', 'en')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('every 5 minutes')
  })

  it('parses a weekly cron', () => {
    const result = parseCronToHuman('0 0 * * 1', 'en')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('monday')
  })

  it('falls back to the raw cron string on invalid input', () => {
    const garbage = 'not-a-cron-at-all'
    expect(parseCronToHuman(garbage, 'en')).toBe(garbage)
  })

  it('parses a monthly cron', () => {
    const result = parseCronToHuman('0 0 1 * *', 'en')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('day 1')
  })

  it('parses an hourly cron', () => {
    const result = parseCronToHuman('0 * * * *', 'en')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('every hour')
  })
})
