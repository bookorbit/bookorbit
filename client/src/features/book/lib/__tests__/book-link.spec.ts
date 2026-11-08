import { describe, expect, it } from 'vitest'
import { BOOK_LINK_MAX_MEMBERS, type BookCardLinkInfo } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { cardFormatBadges, hasLinkedBooks, linkDisabledReason, linkedMediumLabel } from '../book-link'

describe('linkDisabledReason', () => {
  it.each([
    [{ queryScoped: true, count: 2, allEditable: true }, 'queryScoped'],
    [{ queryScoped: false, count: 1, allEditable: true }, 'tooFew'],
    [{ queryScoped: false, count: BOOK_LINK_MAX_MEMBERS + 1, allEditable: true }, 'tooMany'],
    [{ queryScoped: false, count: 2, allEditable: false }, 'notEditable'],
    [{ queryScoped: false, count: BOOK_LINK_MAX_MEMBERS, allEditable: true }, null],
    [{ queryScoped: false, count: 2, allEditable: true }, null],
  ] as const)('%o gives %s', (options, reason) => {
    expect(linkDisabledReason(options)).toBe(reason)
  })
})

describe('hasLinkedBooks', () => {
  it('is true only for a card with at least one visible linked book', () => {
    expect(hasLinkedBooks(null)).toBe(false)
    expect(hasLinkedBooks({})).toBe(false)
    expect(hasLinkedBooks({ linked: { groupId: 1, books: [], memberCount: 1 } })).toBe(false)
    expect(
      hasLinkedBooks({ linked: { groupId: 1, books: [{ bookId: 2, libraryId: 3, formats: ['m4b'], mediaKind: 'audiobook' }], memberCount: 2 } }),
    ).toBe(true)
  })
})

describe('cardFormatBadges', () => {
  const linked: BookCardLinkInfo = {
    groupId: 4,
    memberCount: 3,
    books: [
      { bookId: 20, libraryId: 2, formats: ['mp3', 'mp3', 'epub'], mediaKind: 'audiobook' },
      { bookId: 21, libraryId: 5, formats: ['PDF'], mediaKind: 'ebook' },
    ],
  }

  it('keeps the card own formats first and adds only formats the linked books bring', () => {
    expect(cardFormatBadges(['epub', 'cbz'], linked)).toEqual([
      { key: 'epub', linked: false, libraryId: null },
      { key: 'cbz', linked: false, libraryId: null },
      { key: 'mp3', linked: true, libraryId: 2 },
      { key: 'pdf', linked: true, libraryId: 5 },
    ])
  })

  it('shows just the own formats when nothing is linked', () => {
    expect(cardFormatBadges(['m4b', 'm4b'], undefined)).toEqual([{ key: 'm4b', linked: false, libraryId: null }])
  })

  it('still lists linked formats for a card without content files of its own', () => {
    expect(cardFormatBadges([], linked).map((badge) => badge.key)).toEqual(['mp3', 'epub', 'pdf'])
  })
})

describe('linkedMediumLabel', () => {
  it('names each medium', () => {
    i18n.global.locale.value = 'en'
    expect(linkedMediumLabel('audiobook')).toBe('Audiobook')
    expect(linkedMediumLabel('ebook')).toBe('Ebook')
    expect(linkedMediumLabel('comic')).toBe('Comic')
    expect(linkedMediumLabel('unknown')).toBe('Book')
  })
})
