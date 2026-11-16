import { mount } from '@vue/test-utils'
import { RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookRequestReview } from '@bookorbit/types'

import RequestReviewPanel from '../components/RequestReviewPanel.vue'

function review(overrides: Partial<BookRequestReview> = {}): BookRequestReview {
  return {
    requestId: 7,
    bookDockFileId: 100,
    verification: {
      score: 65,
      threshold: 70,
      passed: false,
      reason: 'below_threshold',
      rows: [
        { field: 'title', requested: 'Fablehaven', imported: 'Fablehaven, Book 1 (Unabridged)', verdict: 'mismatch' },
        { field: 'authors', requested: 'Brandon Mull', imported: 'Brandon Mull', verdict: 'match' },
        { field: 'isbn13', requested: null, imported: null, verdict: 'unknown' },
      ],
    },
    files: [{ fileName: 'fablehaven-01.m4b', fileSize: 402_000_000, format: 'm4b', role: 'content' }],
    totalSizeBytes: 402_000_000,
    canFile: true,
    heldOnRequest: false,
    releaseInfoUrl: null,
    edition: null,
    hasCover: false,
    ...overrides,
  }
}

function render(overrides: Partial<BookRequestReview> = {}, props: { canManage?: boolean; coverUrl?: string | null } = {}) {
  return mount(RequestReviewPanel, {
    props: { review: review(overrides), canManage: props.canManage ?? true, coverUrl: props.coverUrl ?? null },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('RequestReviewPanel', () => {
  /** The score itself is the status card's sentence; this section says what to do about it. */
  it('leads with what the score means for the person checking it', () => {
    const wrapper = render()

    expect(wrapper.text()).toContain('Check the match')
    expect(wrapper.text()).toContain('Check the fields below and decide whether it is the right book.')
    expect(wrapper.text()).not.toContain('scored 65')
  })

  it('compares the request and the file in a table, field by field', () => {
    const rows = render().findAll('tbody tr')

    expect(rows).toHaveLength(3)
    expect(rows[0]!.get('th').text()).toContain('Title')
    expect(rows[0]!.get('th').text()).toContain('Does not match')
    expect(rows[1]!.get('th').text()).toContain('Matches')
  })

  /** The question the panel exists to answer: which field cost the points. */
  it('shows both sides of every compared field', () => {
    const text = render().text()

    expect(text).toContain('Fablehaven, Book 1 (Unabridged)')
    expect(text).toContain('Brandon Mull')
  })

  it('says a field neither side carries was not compared, rather than showing two blanks', () => {
    const text = render().text()

    expect(text).toContain('Neither the request nor the file has one')
    expect(text).not.toContain('Not set')
  })

  it('lists what landed with its size', () => {
    const text = render().text()

    expect(text).toContain('fablehaven-01.m4b')
    expect(text).toContain('1 file')
  })

  it('labels a file that is not the book itself', () => {
    const text = render({
      files: [
        { fileName: 'part-01.m4b', fileSize: 100, format: 'm4b', role: 'content' },
        { fileName: 'cover.jpg', fileSize: 50, format: 'jpg', role: 'cover' },
      ],
    }).text()

    expect(text).toContain('cover.jpg')
    expect(text).toContain('Cover')
  })

  it('says when the request has nowhere to file it into', () => {
    expect(render({ canFile: false }).text()).toContain('no destination library')
  })

  /** Backend-gated too, but an approve button a requester cannot use should not be there at all. */
  it('offers no action to somebody who cannot moderate the queue', () => {
    const wrapper = render({ canFile: false }, { canManage: false })

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('no destination library')
    expect(wrapper.text()).toContain('fablehaven-01.m4b')
  })

  /**
   * The state the dev database was actually in: both pointers to the dock entry are `on delete set
   * null`, so filing it by hand leaves the request held over a file that no longer exists.
   */
  it('says so when the entry it was held over has left the Book Dock', () => {
    const wrapper = render({ bookDockFileId: null, verification: null, files: [], totalSizeBytes: null, canFile: false })

    expect(wrapper.text()).toContain('If the book is already in your library')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('What landed')
  })

  it('compares nothing for a hold that no score produced, and still lists what landed', () => {
    const wrapper = render({ verification: null })

    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('fablehaven-01.m4b')
  })
  it('links the page of the release the import came from', () => {
    const link = render({ releaseInfoUrl: 'https://tracker.example.com/t/42' }).get('a[href="https://tracker.example.com/t/42"]')

    expect(link.text()).toContain('Open the release page')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.attributes('target')).toBe('_blank')
  })

  it('lists only the edition facts the file states, beside the cover it carried', () => {
    const wrapper = render(
      {
        edition: {
          publisher: 'Brilliance Audio',
          publishedDate: '2007',
          language: 'en',
          pageCount: null,
          isbn10: null,
          narrators: ['E.B. Stevens'],
          durationSeconds: 9 * 3600 + 30 * 60,
          abridged: false,
          chapterCount: 12,
        },
      },
      { coverUrl: '/api/v1/admin/book-requests/7/review/cover?entry=100' },
    )
    const facts = wrapper.get('dl')

    expect(facts.text()).toContain('PublisherBrilliance Audio')
    expect(facts.text()).toContain('Narrated byE.B. Stevens')
    expect(facts.text()).toContain('VersionUnabridged')
    expect(facts.text()).toContain('Chapters12')
    expect(facts.text()).not.toContain('Pages')
    expect(wrapper.get('img').attributes('alt')).toBe('Cover found in the imported file')
  })

  it('draws no edition section for a file that states nothing and carries no cover', () => {
    expect(render().text()).not.toContain('What the file says it is')
  })

  it('drops a cover that will not load and keeps the facts', async () => {
    const wrapper = render({ edition: null }, { coverUrl: '/api/v1/admin/book-requests/7/review/cover?entry=100' })

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('What the file says it is')
  })
})
