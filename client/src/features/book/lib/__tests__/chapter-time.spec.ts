// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatChapterClock, formatChapterLength, parseChapterClock } from '../chapter-time'

describe('formatChapterClock', () => {
  it.each([
    [0, '0:00.000'],
    [14_377, '0:14.377'],
    [61_005, '1:01.005'],
    [3_723_250, '1:02:03.250'],
    [37_190_000, '10:19:50.000'],
  ])('formats %d ms as %s', (ms, expected) => {
    expect(formatChapterClock(ms)).toBe(expected)
  })

  it('drops the fraction or forces hours on request, and never goes negative', () => {
    expect(formatChapterClock(61_999, { withMs: false })).toBe('1:01')
    expect(formatChapterClock(5_000, { forceHours: true })).toBe('0:00:05.000')
    expect(formatChapterClock(-40)).toBe('0:00.000')
    expect(formatChapterLength(3_723_999)).toBe('1:02:03')
  })
})

describe('parseChapterClock', () => {
  it.each([
    ['90', 90_000],
    ['90.5', 90_500],
    ['1:30', 90_000],
    ['01:02:03', 3_723_000],
    ['1:02:03.25', 3_723_250],
    ['1:02:03,250', 3_723_250],
    [' 0:14.377 ', 14_377],
    ['125:00:00', 450_000_000],
  ])('reads %s', (text, ms) => {
    expect(parseChapterClock(text)).toBe(ms)
  })

  it.each(['', 'abc', '1:75', '1:00:61', '1:2:3:4', '-5', '1.2.3', '1:30.1234'])('refuses %j', (text) => {
    expect(parseChapterClock(text)).toBeNull()
  })

  it('round-trips every formatted clock', () => {
    for (const ms of [0, 999, 59_999, 3_599_999, 3_600_000, 86_399_999]) {
      expect(parseChapterClock(formatChapterClock(ms))).toBe(ms)
    }
  })
})
