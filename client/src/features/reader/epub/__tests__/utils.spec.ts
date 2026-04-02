import { describe, expect, it } from 'vitest'
import { formatDate, stripFragment } from '../utils'

describe('epub utils', () => {
  it('removes hash fragments from href values', () => {
    expect(stripFragment('chapter-1.xhtml#start')).toBe('chapter-1.xhtml')
    expect(stripFragment('chapter-2.xhtml')).toBe('chapter-2.xhtml')
    expect(stripFragment('')).toBe('')
  })

  it('formats dates using locale short month/day/year format', () => {
    const iso = '2026-02-14T12:00:00.000Z'
    const expected = new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

    expect(formatDate(iso)).toBe(expected)
  })
})
