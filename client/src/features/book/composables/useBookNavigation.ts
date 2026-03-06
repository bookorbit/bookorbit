import { computed, ref } from 'vue'

const bookIds = ref<number[]>([])
const total = ref(0)
let loadMoreCallback: (() => Promise<void>) | null = null

export function useBookNavigation() {
  const setBookContext = (ids: number[], totalCount: number) => {
    bookIds.value = ids
    total.value = totalCount
  }

  const registerLoadMore = (cb: (() => Promise<void>) | null) => {
    loadMoreCallback = cb
  }

  const getNextId = async (currentId: number) => {
    const idx = bookIds.value.indexOf(currentId)
    if (idx !== -1) {
      if (idx < bookIds.value.length - 1) {
        return bookIds.value[idx + 1]
      }
      if (bookIds.value.length < total.value && loadMoreCallback) {
        const beforeLength = bookIds.value.length
        await loadMoreCallback()
        if (bookIds.value.length === beforeLength) {
          // No more books were loaded, avoid infinite loop
          return null
        }
        // After loading more, check again
        const newIdx = bookIds.value.indexOf(currentId)
        if (newIdx !== -1 && newIdx < bookIds.value.length - 1) {
          return bookIds.value[newIdx + 1]
        }
      }
    }
    return null
  }

  const getPrevId = (currentId: number) => {
    const idx = bookIds.value.indexOf(currentId)
    if (idx !== -1 && idx > 0) {
      return bookIds.value[idx - 1]
    }
    return null
  }

  const hasContext = computed(() => bookIds.value.length > 0)
  const currentIndex = (currentId: number) => bookIds.value.indexOf(currentId)

  return {
    bookIds: computed(() => bookIds.value),
    total: computed(() => total.value),
    setBookContext,
    registerLoadMore,
    getNextId,
    getPrevId,
    hasContext,
    currentIndex,
  }
}
