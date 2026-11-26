import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { SeriesNextBook } from '@bookorbit/types'
import NextIssueCard from '../NextIssueCard.vue'

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: (bookId: number) => `/covers/${bookId}` }),
}))

function mountCard(overrides: Partial<SeriesNextBook> = {}) {
  const nextBook: SeriesNextBook = { bookId: 5, fileId: 9, format: 'cbz', title: 'Embers', seriesIndex: '93', ...overrides }
  return mount(NextIssueCard, { props: { nextBook } })
}

function label(wrapper: ReturnType<typeof mountCard>) {
  return wrapper.get('p.truncate').text()
}

describe('NextIssueCard', () => {
  it('keeps the bare number for a book without a unit', () => {
    expect(label(mountCard())).toBe('#93 Embers')
  })

  it('names the unit of the next book', () => {
    expect(label(mountCard({ seriesUnit: 'chapter' }))).toBe('Ch. 93 Embers')
    expect(label(mountCard({ seriesUnit: 'volume', seriesIndex: '2', title: 'Low Water' }))).toBe('Vol. 2 Low Water')
    expect(label(mountCard({ seriesUnit: 'issue', seriesIndex: '12', title: 'The Long Night' }))).toBe('#12 The Long Night')
  })

  it('drops the token when the title already says it', () => {
    const wrapper = mountCard({ seriesUnit: 'issue', seriesIndex: '12', title: 'Night Warden #12' })

    expect(label(wrapper)).toBe('Night Warden #12')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Read next: Night Warden #12')
  })

  it('shows only the title without a position', () => {
    expect(label(mountCard({ seriesIndex: null, seriesUnit: 'chapter' }))).toBe('Embers')
  })
})
