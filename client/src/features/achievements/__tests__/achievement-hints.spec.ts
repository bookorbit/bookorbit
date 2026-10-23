import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import type { AchievementHint } from '@bookorbit/types'
import { hintKeyOf, hintView } from '../lib/achievement-hints'
import type { MomentMessage } from '../lib/achievement-moments'
import { useMomentText } from '../composables/useMomentText'
import { groupAchievements } from '../composables/useGroupedAchievements'
import { booksFinishedSet, makeAchievement } from './fixtures'

function render(message: MomentMessage | null | undefined): string {
  if (!message) return ''
  const Probe = defineComponent({
    setup() {
      const { momentText } = useMomentText()
      return () => h('span', momentText(message))
    },
  })
  return mount(Probe).text()
}

function sentences(hint: AchievementHint): string[] {
  const view = hintView(hint)
  return view ? [render(view.text), render(view.note)].filter(Boolean) : []
}

describe('hintView', () => {
  it('puts the reading pace and the time it takes at that pace', () => {
    expect(sentences({ key: 'hours_read_3', kind: 'reading_pace', values: { hours: 44, days: 30, remaining: 26, etaDays: 18 } })).toEqual([
      'You read 44 hours in the last 30 days.',
      'About 3 weeks at this pace.',
    ])
    expect(sentences({ key: 'hours_read_3', kind: 'reading_pace', values: { hours: 1, days: 30, remaining: 3, etaDays: 90 } })[1]).toBe(
      'About 3 months at this pace.',
    )
    expect(sentences({ key: 'hours_read_3', kind: 'reading_pace', values: { hours: 9, days: 30, remaining: 3, etaDays: 10 } })[1]).toBe(
      'About 10 days at this pace.',
    )
  })

  it('names a decade or century as a year with its suffix, not a grouped number', () => {
    expect(sentences({ key: 'decade_sampler', kind: 'period_unread', count: 17, bookIds: [1], values: { period: 1990, years: 10 } })).toEqual([
      '17 books from the 1990s are waiting on your shelves.',
    ])
    expect(sentences({ key: 'century_span', kind: 'period_unread', count: 1, values: { period: 1800, years: 100 } })).toEqual([
      '1 book from the 1800s is waiting on your shelves.',
    ])
  })

  it('describes a stalled book and offers to resume it in the reader', () => {
    const view = hintView({
      key: 'slow_burn',
      kind: 'stalled_book',
      count: 3,
      bookIds: [180],
      bookTitles: ['The Dead of Winter'],
      values: {
        title: 'The Dead of Winter',
        percent: 91,
        startedAt: '2025-08-12T12:00:00.000Z',
        resume: { bookId: 180, fileId: 186, format: 'pdf' },
      },
    })
    expect(render(view?.text)).toBe('The Dead of Winter is 91% read and was started on Aug 12, 2025.')
    expect(view?.books).toEqual([{ id: 180, title: 'The Dead of Winter' }])
    expect(render(view?.action?.label)).toBe('Continue reading')
    expect(view?.action?.to).toEqual({ name: 'reader', params: { bookId: 180, fileId: 186 }, query: { format: 'pdf' } })
  })

  it('falls back to a generic subject and no action when the book has no title or file', () => {
    const view = hintView({
      key: 'slow_burn',
      kind: 'stalled_book',
      bookIds: [5],
      values: { title: null, percent: null, startedAt: '2026-01-09T07:12:00.000Z', resume: null },
    })
    expect(render(view?.text)).toBe('A book in progress was started on Jan 9, 2026.')
    expect(view?.action).toBeNull()
  })

  it('links unrated finished books to the first one for rating', () => {
    const view = hintView({ key: 'critic_2', kind: 'unrated_finished', count: 45, bookIds: [163, 837], bookTitles: ['A', null], values: {} })
    expect(render(view?.text)).toBe('45 books you finished have no rating yet.')
    expect(view?.books).toEqual([
      { id: 163, title: 'A' },
      { id: 837, title: null },
    ])
    expect(view?.action?.to).toBe('/book/163')
    expect(render(view?.action?.label)).toBe('Rate a finished book')
  })

  it('counts nearly finished, short, long and old books', () => {
    expect(
      sentences({
        key: 'books_finished_4',
        kind: 'nearly_finished',
        count: 1,
        values: { minPercent: 90, resume: { bookId: 1, fileId: 2, format: null } },
      }),
    ).toEqual(['1 book in progress is past 90%.'])
    expect(sentences({ key: 'short_story_fan', kind: 'short_books', count: 8, values: { maxPages: 100, inProgress: 2 } })).toEqual([
      '8 books under 100 pages are waiting on your shelves.',
      '2 are already in progress.',
    ])
    expect(sentences({ key: 'short_story_fan', kind: 'short_books', count: 1, values: { maxPages: 100, inProgress: 0 } })).toEqual([
      '1 book under 100 pages is waiting on your shelves.',
    ])
    expect(sentences({ key: 'long_book_1', kind: 'long_books', count: 3, values: { minPages: 1000 } })).toEqual([
      '3 books of 1,000 pages or more are waiting on your shelves.',
    ])
    expect(sentences({ key: 'old_soul', kind: 'old_books', count: 2, values: { year: 1900 } })).toEqual([
      '2 books published before 1900 are waiting on your shelves.',
    ])
  })

  it('names the author with both counts and links to the author page', () => {
    const view = hintView({ key: 'author_deep_dive', kind: 'author_unread', count: 10, values: { authorId: 231, author: 'S.D. Perry', finished: 1 } })
    expect(render(view?.text)).toBe('S.D. Perry: 1 finished, 10 more on your shelves.')
    expect(view?.action?.to).toBe('/authors/231')
  })

  it('shows a language by its name', () => {
    expect(sentences({ key: 'polyglot_3', kind: 'language_unread', count: 2, values: { language: 'es' } })).toEqual([
      '2 books in Spanish are waiting on your shelves.',
    ])
  })

  it('lists the months left in the year', () => {
    expect(sentences({ key: 'year_round_reader', kind: 'months_left', count: 2, values: { year: 2026, monthsRead: 10, months: [11, 12] } })).toEqual([
      'You have read in 10 months of 2026 so far.',
      'November and December are left.',
    ])
  })

  it('says why an achievement is out of reach', () => {
    const blocked = (values: Extract<AchievementHint, { kind: 'unavailable' }>['values']) => hintView({ key: 'x', kind: 'unavailable', values })
    expect(render(blocked({ reason: 'no_long_book', pages: 1000 })?.text)).toBe('No book on your shelves has 1,000 pages or more yet.')
    expect(render(blocked({ reason: 'nothing_before_year', year: 1900 })?.text)).toBe('Nothing on your shelves was published before 1900.')
    expect(render(blocked({ reason: 'too_few_periods', years: 100, reachable: 2 })?.text)).toBe('Your shelves span only 2 centuries so far.')
    expect(render(blocked({ reason: 'too_few_periods', years: 10, reachable: 1 })?.text)).toBe('Your shelves span only 1 decade so far.')
    expect(render(blocked({ reason: 'missed_month', year: 2026, month: 3 })?.text)).toBe(
      'You did not read in March, so 2026 is out of reach. The count starts again in January.',
    )
    expect(blocked({ reason: 'no_long_book', pages: 1000 })).toMatchObject({ blocked: true, books: [], action: null })
  })

  it('degrades to nothing for a kind it does not know or a value it lacks', () => {
    expect(hintView({ key: 'x', kind: 'something_new', values: {} } as unknown as AchievementHint)).toBeNull()
    expect(hintView({ key: 'x', kind: 'unavailable', values: { reason: 'brand_new_reason' } } as unknown as AchievementHint)).toBeNull()
    expect(hintView({ key: 'x', kind: 'period_unread', values: { years: 10 } } as unknown as AchievementHint)).toBeNull()
    expect(hintView(null)).toBeNull()
  })

  it('shows at most three valid books', () => {
    const view = hintView({
      key: 'x',
      kind: 'long_books',
      count: 9,
      bookIds: [1, 0, 3, 4],
      bookTitles: ['One', 'Zero', 'Three', 'Four'],
      values: { minPages: 500 },
    })
    expect(view?.books).toEqual([
      { id: 1, title: 'One' },
      { id: 3, title: 'Three' },
    ])
  })
})

describe('hintKeyOf', () => {
  it('keys a set by its next tier and a single by itself while locked', () => {
    const [set] = groupAchievements(booksFinishedSet(2, 12))
    expect(hintKeyOf(set!)).toBe('books_finished_3')
    expect(hintKeyOf(groupAchievements([makeAchievement({ key: 'slow_burn' })])[0]!)).toBe('slow_burn')
    expect(hintKeyOf(groupAchievements([makeAchievement({ key: 'slow_burn', earned: true, awardedAt: '2026-01-01T00:00:00Z' })])[0]!)).toBeNull()
    expect(hintKeyOf(groupAchievements(booksFinishedSet(4, null))[0]!)).toBeNull()
  })
})
