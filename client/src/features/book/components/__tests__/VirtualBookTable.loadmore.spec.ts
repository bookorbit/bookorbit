import { nextTick, ref, watch } from 'vue'
import { describe, expect, it } from 'vitest'

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
