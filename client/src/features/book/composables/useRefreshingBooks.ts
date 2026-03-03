import { ref } from 'vue'

const refreshingIds = ref(new Set<number>())

export function useRefreshingBooks() {
  function markRefreshing(ids: number[]) {
    const next = new Set(refreshingIds.value)
    ids.forEach((id) => next.add(id))
    refreshingIds.value = next
  }

  function clearRefreshing(ids: number[]) {
    const next = new Set(refreshingIds.value)
    ids.forEach((id) => next.delete(id))
    refreshingIds.value = next
  }

  function isRefreshing(id: number): boolean {
    return refreshingIds.value.has(id)
  }

  return { markRefreshing, clearRefreshing, isRefreshing }
}
