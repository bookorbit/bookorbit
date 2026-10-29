import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { BookChaptersState, BookDetail } from '@bookorbit/types'
import { setI18nLocale } from '@/i18n'
import ChaptersHeroBar from '../ChaptersHeroBar.vue'

const STATE = {
  chapters: [{ title: 'One', startMs: 0 }],
  source: 'embedded',
  locked: false,
  updatedAt: null,
  updatedBy: null,
  totalDurationMs: 3_600_000,
} as unknown as BookChaptersState

function book(overrides: Partial<BookDetail>): BookDetail {
  return {
    id: 7,
    title: 'Ghost Story',
    coverSource: 'extracted',
    coverVersion: 'v1',
    coverAspectRatio: '2/3',
    covers: { ebook: { source: 'extracted', updatedAt: '2026-01-01', width: 400, height: 600 }, audio: null },
    ...overrides,
  } as BookDetail
}

let wrapper: VueWrapper | null = null

async function mountHero(detail: BookDetail) {
  await setI18nLocale('en')
  wrapper = mount(ChaptersHeroBar, { props: { book: detail, state: STATE, editing: false, canEdit: true, chapterCount: 1 } })
  await flushPromises()
  return wrapper.find('.hero-cover')
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChaptersHeroBar', () => {
  it('shows the audiobook art in its own shape when the book has some', async () => {
    const cover = await mountHero(
      book({
        covers: {
          ebook: { source: 'extracted', updatedAt: '2026-01-01', width: 400, height: 600 },
          audio: { source: 'extracted', updatedAt: '2026-01-02', width: 500, height: 500 },
        },
      }),
    )

    expect(cover.attributes('src')).toContain('medium=audio')
    expect(cover.attributes('style')).toContain('aspect-ratio: 1')
  })

  it('falls back to the usual cover, framed as the server frames it', async () => {
    const cover = await mountHero(book({}))

    expect(cover.attributes('src')).not.toContain('medium=')
    expect(Number(/aspect-ratio: ([\d.]+)/.exec(cover.attributes('style') ?? '')?.[1])).toBeCloseTo(2 / 3)
  })

  it('treats audiobook art of unknown size as square', async () => {
    const cover = await mountHero(book({ covers: { ebook: null, audio: { source: 'custom', updatedAt: '2026-01-02', width: null, height: null } } }))

    expect(cover.attributes('style')).toContain('aspect-ratio: 1')
  })
})
