import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  detail: null as unknown as Ref<BookDetail | null>,
  fetchBook: vi.fn<(bookId: number) => Promise<void>>(),
  pageTitle: null as MaybeRefOrGetter<string | null | undefined> | null,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'views.bookDetail.titleWithId') return `Book #${String(params?.id)}`
      if (key === 'views.bookDetail.title') return 'Book'
      return key
    },
  }),
}))

vi.mock('@/features/book/composables/useBookDetail', () => ({
  useBookDetail: () => ({ detail: mocks.detail, fetch: mocks.fetchBook }),
}))

vi.mock('@/composables/usePageTitle', () => ({
  usePageTitle: (title: MaybeRefOrGetter<string | null | undefined>) => {
    mocks.pageTitle = title
  },
}))

const { useReaderPageTitle } = await import('../useReaderPageTitle')

describe('useReaderPageTitle', () => {
  beforeEach(() => {
    mocks.detail = ref<BookDetail | null>(null)
    mocks.fetchBook.mockReset().mockResolvedValue()
    mocks.pageTitle = null
  })

  it('loads the requested book and uses its title when available', () => {
    useReaderPageTitle(42)

    expect(mocks.fetchBook).toHaveBeenCalledExactlyOnceWith(42)
    expect(toValue(mocks.pageTitle)).toBe('Book #42')

    mocks.detail.value = { id: 42, title: '  The Left Hand of Darkness  ' } as BookDetail

    expect(toValue(mocks.pageTitle)).toBe('The Left Hand of Darkness')
  })

  it('keeps the localized ID fallback when the book title is blank', () => {
    mocks.detail.value = { id: 42, title: '   ' } as BookDetail

    useReaderPageTitle(42)

    expect(toValue(mocks.pageTitle)).toBe('Book #42')
  })

  it('uses the generic book fallback when the route ID is invalid', () => {
    useReaderPageTitle(Number.NaN)

    expect(toValue(mocks.pageTitle)).toBe('Book')
    expect(mocks.fetchBook).not.toHaveBeenCalled()
  })
})
