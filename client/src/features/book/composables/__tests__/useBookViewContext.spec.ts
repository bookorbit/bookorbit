import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { useBookNavigation } from '../useBookNavigation'
import { useBookViewContext } from '../useBookViewContext'
import type { BookPlaceholder, BookSlot } from '../useBookWindow'

function placeholder(id: number): BookPlaceholder {
  return { id, placeholder: true }
}

function makeBook(id: number): BookCard {
  return {
    id,
    status: 'active',
    title: `Book ${id}`,
    authors: [],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
  }
}

describe('useBookViewContext', () => {
  afterEach(() => {
    const nav = useBookNavigation()
    nav.setBookContext([], 0)
    nav.registerLoadMore(null)
  })

  it('keeps metadata navigation working after the source list view unmounts', async () => {
    const nav = useBookNavigation()
    const books = ref<BookCard[]>([makeBook(1), makeBook(2)])
    const total = ref(4)
    const loadMore = vi.fn<() => Promise<void>>(async () => {
      books.value = [makeBook(1), makeBook(2), makeBook(3), makeBook(4)]
    })

    const Harness = defineComponent({
      setup() {
        useBookViewContext(books, total, loadMore)
        return {}
      },
      template: '<div />',
    })

    const wrapper = mount(Harness)
    wrapper.unmount()

    const nextId = await nav.getNextId(2)

    expect(loadMore).toHaveBeenCalledTimes(1)
    expect(nextId).toBe(3)
  })

  it('advances across a block boundary when load-more resolves asynchronously', async () => {
    const nav = useBookNavigation()
    // 100 contiguous loaded slots (indexes 0..99); book 100 is the last loaded
    // of the first block, with 900 more still to load.
    const slots = ref<BookSlot[]>(Array.from({ length: 100 }, (_, i) => makeBook(i + 1)))
    const total = ref(1000)

    let releaseLoad: (() => void) | undefined
    const loadMore = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          releaseLoad = () => {
            slots.value = [...slots.value, ...Array.from({ length: 100 }, (_, i) => makeBook(i + 101))]
            resolve()
          }
        }),
    )

    const Harness = defineComponent({
      setup() {
        useBookViewContext(slots, total, loadMore)
        return {}
      },
      template: '<div />',
    })

    const wrapper = mount(Harness)
    // Mirror real navigation: the grid/list view unmounts when the editor opens.
    wrapper.unmount()

    const nextPromise = nav.getNextId(100)
    await Promise.resolve()
    // The next block is still loading, so the id is not resolved synchronously.
    expect(releaseLoad).toBeDefined()
    releaseLoad?.()

    expect(await nextPromise).toBe(101)
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('does not let a deactivated kept-alive source passively clobber the active navigation context', async () => {
    const nav = useBookNavigation()
    const showSource = ref(true)
    const slots = ref<BookSlot[]>([makeBook(1), makeBook(2), makeBook(3)])
    const total = ref(3)
    const loadMore = vi.fn<() => Promise<void>>(async () => {})

    const Source = defineComponent({
      setup() {
        useBookViewContext(slots, total, loadMore)
        return {}
      },
      template: '<div />',
    })

    const Harness = defineComponent({
      components: { Source },
      setup() {
        return { showSource }
      },
      template: '<KeepAlive><Source v-if="showSource" /></KeepAlive>',
    })

    const wrapper = mount(Harness)
    await nextTick()

    nav.setBookContext([10, 20], 2)
    expect(nav.currentIndex(20)).toBe(1)

    showSource.value = false
    await nextTick()

    slots.value = []
    total.value = 0
    await nextTick()

    expect(nav.bookIds.value).toEqual([10, 20])
    expect(nav.currentIndex(20)).toBe(1)
    expect(nav.total.value).toBe(2)

    wrapper.unmount()
  })

  it('reports the absolute slot index after a jump rail loads a far block', async () => {
    const nav = useBookNavigation()
    // First block (rows 0-1) plus a far block (rows 5000-5001) loaded; the
    // rows in between are still placeholders, as after a jump to "Z".
    const slots = ref<BookSlot[]>([
      makeBook(1),
      makeBook(2),
      ...Array.from({ length: 4998 }, (_, i) => placeholder(-(i + 1))),
      makeBook(5001),
      makeBook(5002),
    ])
    const total = ref(5002)
    const loadMore = vi.fn<() => Promise<void>>(async () => {})

    const Harness = defineComponent({
      setup() {
        useBookViewContext(slots, total, loadMore)
        return {}
      },
      template: '<div />',
    })

    const wrapper = mount(Harness)

    expect(nav.currentIndex(5001)).toBe(5000)
    expect(nav.currentIndex(5002)).toBe(5001)
    expect(nav.currentIndex(1)).toBe(0)
    expect(nav.total.value).toBe(5002)

    wrapper.unmount()
  })
})
