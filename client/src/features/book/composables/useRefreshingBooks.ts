import { ref } from 'vue'

const refreshingCounts = ref(new Map<number, number>())

export function useRefreshingBooks() {
  function markRefreshing(ids: number[]) {
    const next = new Map(refreshingCounts.value)
    for (const id of ids) {
      const current = next.get(id) ?? 0
      next.set(id, current + 1)
    }
    refreshingCounts.value = next
  }

  function clearRefreshing(ids: number[]) {
    const next = new Map(refreshingCounts.value)
    for (const id of ids) {
      const current = next.get(id) ?? 0
      if (current <= 1) next.delete(id)
      else next.set(id, current - 1)
    }
    refreshingCounts.value = next
  }

  function isRefreshing(id: number): boolean {
    return (refreshingCounts.value.get(id) ?? 0) > 0
  }

  return { markRefreshing, clearRefreshing, isRefreshing }
}
