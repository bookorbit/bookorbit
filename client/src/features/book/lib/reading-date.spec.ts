import { afterEach, describe, expect, it } from 'vitest'
import { readingDateToDateKey } from './reading-date'

const originalTimeZone = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTimeZone
})

describe('readingDateToDateKey', () => {
  it('keeps projected UTC-midnight dates unchanged west of UTC', () => {
    process.env.TZ = 'America/Sao_Paulo'

    expect(new Date('2026-09-07T00:00:00.000Z').getDate()).toBe(6)
    expect(readingDateToDateKey('2026-09-07T00:00:00.000Z')).toBe('2026-09-07')
    expect(readingDateToDateKey('2026-09-07T00:00:00Z')).toBe('2026-09-07')
  })

  it('does not let projected dates cross forward east of UTC', () => {
    process.env.TZ = 'Pacific/Kiritimati'

    expect(new Date('2026-09-07T12:00:00.000Z').getDate()).toBe(8)
    expect(readingDateToDateKey('2026-09-07T00:00:00.000Z')).toBe('2026-09-07')
  })

  it('continues to localize lifecycle values that carry a real time', () => {
    process.env.TZ = 'America/Sao_Paulo'

    expect(readingDateToDateKey('2026-09-07T02:00:00.000Z')).toBe('2026-09-06')
    expect(readingDateToDateKey('2026-09-07T03:00:00.000Z')).toBe('2026-09-07')
    expect(readingDateToDateKey('2026-09-07T02:00:00.000Z', 'Europe/Rome')).toBe('2026-09-07')
  })

  it('passes date keys through and rejects unusable values', () => {
    expect(readingDateToDateKey('2026-09-07')).toBe('2026-09-07')
    expect(readingDateToDateKey('not-a-date')).toBe('')
    expect(readingDateToDateKey(null)).toBe('')
  })
})
