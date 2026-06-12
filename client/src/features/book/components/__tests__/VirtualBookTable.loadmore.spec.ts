import { nextTick, ref, watch } from 'vue'
import { describe, expect, it } from 'vitest'
import { isBookPlaceholder, type BookSlot } from '@/features/book/composables/useBookWindow'

describe('isLoadingMore guard', () => {
  it('prevents duplicate load-more emissions while loading is active', async () => {
    const isLoadingMore = ref(false)
    const loading = ref(false)
    const emittedCount = ref(0)
    const books = ref(Array.from({ length: 20 }, (_, index) => index))
    const LOAD_THRESHOLD = 5
    const virtualItems = ref<Array<{ index: number }>>([])

    watch(virtualItems, (items) => {
      if (!items.length || loading.value || isLoadingMore.value) return
      const last = items[items.length - 1]
      if (!last) return
      if (last.index >= books.value.length - LOAD_THRESHOLD) {
        isLoadingMore.value = true
        emittedCount.value += 1
      }
    })

    watch(loading, (value) => {
      if (!value) isLoadingMore.value = false
    })

    virtualItems.value = [{ index: 17 }]
    await nextTick()
    expect(emittedCount.value).toBe(1)
    expect(isLoadingMore.value).toBe(true)

    loading.value = true
    virtualItems.value = [{ index: 18 }]
    await nextTick()
    expect(emittedCount.value).toBe(1)

    loading.value = false
    await nextTick()
    expect(isLoadingMore.value).toBe(false)

    virtualItems.value = [{ index: 19 }]
    await nextTick()
    expect(emittedCount.value).toBe(2)
  })

  it('does not emit when the guard is already active', async () => {
    const isLoadingMore = ref(true)
    const loading = ref(false)
    const emittedCount = ref(0)
    const books = ref(Array.from({ length: 20 }, (_, index) => index))
    const LOAD_THRESHOLD = 5
    const virtualItems = ref<Array<{ index: number }>>([])

    watch(virtualItems, (items) => {
      if (!items.length || loading.value || isLoadingMore.value) return
      const last = items[items.length - 1]
      if (!last) return
      if (last.index >= books.value.length - LOAD_THRESHOLD) {
        isLoadingMore.value = true
        emittedCount.value += 1
      }
    })

    watch(loading, (value) => {
      if (!value) isLoadingMore.value = false
    })

    virtualItems.value = [{ index: 19 }]
    await nextTick()
    expect(emittedCount.value).toBe(0)

    loading.value = true
    await nextTick()
    loading.value = false
    await nextTick()

    virtualItems.value = [{ index: 19 }]
    await nextTick()
    expect(emittedCount.value).toBe(1)
  })
})

describe('windowed table rows', () => {
  it('emits the visible range and a scroll-derived first visible index', async () => {
    const rowEstimate = 44
    const scrollOffset = ref(0)
    const virtualItems = ref<Array<{ index: number }>>([])
    const booksLength = 500
    const ranges: Array<[number, number]> = []
    const firstVisible = ref(-1)

    watch(virtualItems, (items) => {
      if (!items.length) return
      ranges.push([items[0]!.index, items[items.length - 1]!.index])
      firstVisible.value = Math.min(booksLength - 1, Math.max(0, Math.floor(scrollOffset.value / rowEstimate)))
    })

    scrollOffset.value = 44 * 120
    virtualItems.value = Array.from({ length: 30 }, (_, i) => ({ index: 110 + i }))
    await nextTick()

    expect(ranges).toEqual([[110, 139]])
    expect(firstVisible.value).toBe(120)
  })

  it('distinguishes placeholder rows from loaded rows by slot shape', () => {
    const slots: BookSlot[] = [{ id: 1 } as never, { id: -1, placeholder: true }, { id: 2 } as never]

    const isPlaceholderRow = (index: number) => {
      const slot = slots[index]
      return slot === undefined || isBookPlaceholder(slot)
    }

    expect(isPlaceholderRow(0)).toBe(false)
    expect(isPlaceholderRow(1)).toBe(true)
    expect(isPlaceholderRow(2)).toBe(false)
    expect(isPlaceholderRow(3)).toBe(true)
  })
})
