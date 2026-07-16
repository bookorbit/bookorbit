import { describe, expect, it } from 'vitest'

import { getDashboardGreetingLabel, getHourInTimeZone, resolveDashboardGreetingTimeZone } from './greeting'

describe('dashboard greeting', () => {
  it.each([
    ['00:00', 'night', '2025-12-31T16:00:00.000Z'],
    ['04:59', 'night', '2025-12-31T20:59:00.000Z'],
    ['05:00', 'morning', '2025-12-31T21:00:00.000Z'],
    ['11:59', 'morning', '2026-01-01T03:59:00.000Z'],
    ['12:00', 'afternoon', '2026-01-01T04:00:00.000Z'],
    ['17:59', 'afternoon', '2026-01-01T09:59:00.000Z'],
    ['18:00', 'evening', '2026-01-01T10:00:00.000Z'],
    ['23:59', 'evening', '2026-01-01T15:59:00.000Z'],
  ])('returns Asia/Shanghai %s as %s', (_localTime, expected, instant) => {
    expect(getDashboardGreetingLabel(new Date(instant), 'Asia/Shanghai')).toBe(expected)
  })

  it('uses the configured timezone instead of the browser timezone', () => {
    const instant = new Date('2026-01-01T21:30:00.000Z')

    expect(getDashboardGreetingLabel(instant, 'UTC')).toBe('evening')
    expect(getDashboardGreetingLabel(instant, 'Asia/Shanghai')).toBe('morning')
  })

  it('falls back to UTC when the configured timezone is missing or invalid', () => {
    const instant = new Date('2026-01-01T03:30:00.000Z')

    expect(resolveDashboardGreetingTimeZone(undefined)).toBe('UTC')
    expect(resolveDashboardGreetingTimeZone('Invalid/Zone')).toBe('UTC')
    expect(getDashboardGreetingLabel(instant, 'Asia/Shanghai')).toBe('morning')
    expect(getDashboardGreetingLabel(instant, 'Invalid/Zone')).toBe('night')
  })

  it('extracts midnight as hour zero', () => {
    expect(getHourInTimeZone(new Date('2025-12-31T16:00:00.000Z'), 'Asia/Shanghai')).toBe(0)
  })
})
