import { computed, type Ref } from 'vue'
import type { BookRequestItem } from '@bookorbit/types'

/**
 * The stepper walks the list exactly as it is shown, in its current filter and sort order, so the
 * position it reports can never disagree with the table behind it. It stops at both ends: wrapping
 * from the last row back to the first reads as a bug when the count says you are at the end.
 */
export function useRequestQueue(items: Ref<BookRequestItem[]>, currentId: Ref<number | null>) {
  const index = computed(() => (currentId.value === null ? -1 : items.value.findIndex((request) => request.id === currentId.value)))
  const total = computed(() => items.value.length)

  /**
   * Zero when the open request is not in the list at all, which happens when a filter or a
   * dismissal drops it out from under a drawer that is still open on it. The stepper hides rather
   * than claiming a position the list cannot show.
   */
  const position = computed(() => index.value + 1)

  const hasPrevious = computed(() => index.value > 0)
  const hasNext = computed(() => index.value >= 0 && index.value < total.value - 1)

  const previousId = computed(() => (hasPrevious.value ? (items.value[index.value - 1]?.id ?? null) : null))
  const nextId = computed(() => (hasNext.value ? (items.value[index.value + 1]?.id ?? null) : null))

  return { index, position, total, hasPrevious, hasNext, previousId, nextId }
}
