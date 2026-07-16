import { nextTick, watch } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { useBookNavigation } from '../useBookNavigation'
import type { BookPlaceholder, BookSlot } from '../useBookWindow'

function makeBook(id: number): BookCard {
  return {
    id,
    status: 'active',
    title: `Book ${id}`,
    authors: [],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedDate: null,
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
    customMetadata: [],
  }
}

function placeholder(id: number): BookPlaceholder {
  return { id, placeholder: true }
}

describe('useBookNavigation', () => {
  afterEach(() => {
    const nav = useBookNavigation()
    nav.setBookContext([], 0)
    nav.registerLoadMore(null)
  })

  describe('setBookContext (fully-loaded list)', () => {
    it('uses the array position as the absolute index', () => {
      const nav = useBookNavigation()
      nav.setBookContext([10, 20, 30], 3)

      expect(nav.currentIndex(10)).toBe(0)
      expect(nav.currentIndex(30)).toBe(2)
      expect(nav.total.value).toBe(3)
      expect(nav.hasContext.value).toBe(true)
    })

    it('returns -1 for an id outside the context', () => {
      const nav = useBookNavigation()
      nav.setBookContext([10, 20], 2)

      expect(nav.currentIndex(999)).toBe(-1)
    })
  })

  describe('setBookSlotContext (windowed listing reached via the jump rail)', () => {
    it('reports the true slot index for a book in a far block, not its loaded-subset position', () => {
      const nav = useBookNavigation()
      // Mirrors the bug: the first block (rows 0-2) loads on open, then the
      // jump rail loads a far block (rows 5000-5001). Everything in between is
      // still a placeholder, so the loaded subset is sparse.
      const slots: BookSlot[] = [
        makeBook(1),
        makeBook(2),
        makeBook(3),
        ...Array.from({ length: 4997 }, (_, i) => placeholder(-(i + 1))),
        makeBook(5001),
        makeBook(5002),
      ]

      nav.setBookSlotContext(slots, 5083)

      // The old compacted-list logic reported index 3 (the 4th loaded card);
      // the fix reports the real slot index.
      expect(nav.currentIndex(5001)).toBe(5000)
      expect(nav.currentIndex(5002)).toBe(5001)
      // Head books keep their low positions.
      expect(nav.currentIndex(1)).toBe(0)
      expect(nav.total.value).toBe(5083)
    })

    it('returns -1 for a book that is not loaded into any slot', () => {
      const nav = useBookNavigation()
      nav.setBookSlotContext([makeBook(1), placeholder(-1)], 2)

      expect(nav.currentIndex(999)).toBe(-1)
    })
  })

  describe('prev/next adjacency', () => {
    it('navigates between absolute-adjacent loaded books', async () => {
      const nav = useBookNavigation()
      nav.setBookSlotContext([makeBook(1), makeBook(2), makeBook(3)], 3)

      expect(nav.getPrevId(2)).toBe(1)
      expect(await nav.getNextId(2)).toBe(3)
    })

    it('does not jump across a placeholder gap left by the jump rail', async () => {
      const nav = useBookNavigation()
      // Loaded: rows 0,1 and row 3; row 2 is a placeholder.
      const slots: BookSlot[] = [makeBook(1), makeBook(2), placeholder(-1), makeBook(50)]
      nav.setBookSlotContext(slots, 4)

      // Book 2 (index 1) has no loaded neighbour at index 2, so next is null
      // rather than the far book 50 (index 3).
      expect(await nav.getNextId(2)).toBe(null)
      // Book 50 (index 3) has a placeholder at index 2, so prev is null.
      expect(nav.getPrevId(50)).toBe(null)
    })
  })

  describe('getNextId load-more at the end of a contiguous prefix', () => {
    it('loads the next chunk and returns the newly adjacent book', async () => {
      const nav = useBookNavigation()
      nav.setBookContext([1, 2], 4)
      nav.registerLoadMore(async () => {
        nav.setBookContext([1, 2, 3, 4], 4)
      })

      expect(await nav.getNextId(2)).toBe(3)
    })

    it('returns null when load-more adds nothing', async () => {
      const nav = useBookNavigation()
      nav.setBookContext([1, 2], 4)
      nav.registerLoadMore(async () => {})

      expect(await nav.getNextId(2)).toBe(null)
    })
  })

  describe('re-sync stability (boundary loop guard)', () => {
    it('does not invalidate bookIds when the slot context is structurally unchanged', async () => {
      const nav = useBookNavigation()
      nav.setBookSlotContext([makeBook(1), makeBook(2), makeBook(3)], 100)

      let fires = 0
      const stop = watch(nav.bookIds, () => {
        fires++
      })

      // A re-sync with the same ids/indexes (e.g. while a lazy block is still
      // in flight) must not retrigger watchers that recompute next/prev id.
      nav.setBookSlotContext([makeBook(1), makeBook(2), makeBook(3)], 100)
      await nextTick()
      expect(fires).toBe(0)

      // A genuine change still propagates.
      nav.setBookSlotContext([makeBook(1), makeBook(2), makeBook(3), makeBook(4)], 100)
      await nextTick()
      expect(fires).toBe(1)

      stop()
    })

    it('does not invalidate bookIds when the fully-loaded context is unchanged', async () => {
      const nav = useBookNavigation()
      nav.setBookContext([1, 2, 3], 3)

      let fires = 0
      const stop = watch(nav.bookIds, () => {
        fires++
      })

      nav.setBookContext([1, 2, 3], 3)
      await nextTick()
      expect(fires).toBe(0)

      stop()
    })
  })
})
