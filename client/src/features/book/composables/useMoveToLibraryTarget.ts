import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { BookSelectionPayload } from '@bookorbit/types'

interface MoveToLibraryTargetOptions {
  /** Payload for the current multi-select, used when the move is not scoped to one book. */
  getSelectionPayload: () => BookSelectionPayload
  selectedCount: Ref<number>
}

/**
 * Owns which books a move applies to.
 *
 * The action bar moves whatever is selected, while the row context menu moves the
 * book that was right-clicked. Keeping the single-book case explicit rather than
 * pushing that book into the global selection means a quick move never silently
 * picks up an unrelated selection that is already active.
 */
export function useMoveToLibraryTarget(options: MoveToLibraryTargetOptions) {
  const open = ref(false)
  const quickBookId = ref<number | null>(null)

  const payload = computed<BookSelectionPayload>(() =>
    quickBookId.value === null ? options.getSelectionPayload() : { bookIds: [quickBookId.value] },
  )

  const count = computed(() => (quickBookId.value === null ? options.selectedCount.value : 1))

  function openForSelection(): void {
    quickBookId.value = null
    open.value = true
  }

  function openForBook(bookId: number): void {
    quickBookId.value = bookId
    open.value = true
  }

  function setOpen(next: boolean): void {
    open.value = next
    if (!next) quickBookId.value = null
  }

  return { open, quickBookId, payload, count, openForSelection, openForBook, setOpen }
}
