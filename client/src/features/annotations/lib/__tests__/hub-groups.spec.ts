import { describe, it, expect } from 'vitest'
import type { AnnotationHubItem } from '@bookorbit/types'
import { buildHubGroups, dayKey, HUB_VIEWS, hubGroupKey, isHubViewKey, monthKey } from '../hub-groups'

function item(overrides: Partial<AnnotationHubItem> = {}): AnnotationHubItem {
  return {
    id: 1,
    bookId: 10,
    cfi: null,
    jumpFileId: null,
    pageno: null,
    text: 'quote',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    bookTitle: 'Tartufo',
    author: 'Kira Jane Buxton',
    deletedAt: null,
    jumpFileFormat: 'epub',
    ...overrides,
  }
}

describe('HUB_VIEWS', () => {
  it('pairs every grouping with the server sort that produces it', () => {
    // Grouping a page of an infinite list only lands on whole groups when the rows
    // arrived ordered by the same key, so these two must never drift apart.
    expect(HUB_VIEWS.newest).toEqual({ group: 'month', sortBy: 'createdAt', sortDir: 'desc' })
    expect(HUB_VIEWS.oldest).toEqual({ group: 'month', sortBy: 'createdAt', sortDir: 'asc' })
    expect(HUB_VIEWS.book.group).toBe('book')
    expect(HUB_VIEWS.book.sortBy).toBe('book')
    expect(HUB_VIEWS.color.sortBy).toBe('color')
    expect(HUB_VIEWS.source.sortBy).toBe('origin')
  })

  it('guards unknown view keys coming back from a URL', () => {
    expect(isHubViewKey('book')).toBe(true)
    expect(isHubViewKey('bogus')).toBe(false)
  })
})

describe('hubGroupKey', () => {
  it('keys each mode off the field the server sorted by', () => {
    const row = item({ bookId: 42, color: '#38BDF8', origin: 'kobo', createdAt: '2026-03-04T00:00:00.000Z' })
    expect(hubGroupKey(row, 'book')).toBe('42')
    expect(hubGroupKey(row, 'color')).toBe('#38BDF8')
    expect(hubGroupKey(row, 'source')).toBe('kobo')
    expect(hubGroupKey(row, 'month')).toBe(monthKey(row.createdAt))
  })
})

describe('buildHubGroups', () => {
  it('opens a group when the key changes and keeps the server order', () => {
    const rows = [item({ id: 1, bookId: 10 }), item({ id: 2, bookId: 10 }), item({ id: 3, bookId: 20 })]

    const groups = buildHubGroups(rows, 'book')

    expect(groups).toHaveLength(2)
    expect(groups[0]!.items.map((row) => row.id)).toEqual([1, 2])
    expect(groups[1]!.items.map((row) => row.id)).toEqual([3])
    expect(groups[0]!.lead.id).toBe(1)
  })

  it('reopens a group when the same key returns later, rather than reordering rows', () => {
    // The server owns the order. Bucketing here would move a row the next page contradicts.
    const rows = [item({ id: 1, bookId: 10 }), item({ id: 2, bookId: 20 }), item({ id: 3, bookId: 10 })]

    const groups = buildHubGroups(rows, 'book')

    expect(groups.map((group) => group.key)).toEqual(['10', '20', '10'])
  })

  it('returns nothing for an empty window', () => {
    expect(buildHubGroups([], 'month')).toEqual([])
  })
})

describe('monthKey and dayKey', () => {
  it('bucket in the viewer timezone so a rule matches the dates printed under it', () => {
    const iso = '2026-08-24T10:00:00.000Z'
    const local = new Date(iso)
    const expectedMonth = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`
    expect(monthKey(iso)).toBe(expectedMonth)
    expect(dayKey(iso)).toBe(`${expectedMonth}-${String(local.getDate()).padStart(2, '0')}`)
  })

  it('returns an empty key for an unparseable date instead of throwing', () => {
    expect(monthKey('not-a-date')).toBe('')
    expect(dayKey('not-a-date')).toBe('')
  })
})
