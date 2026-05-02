import { computed, type Ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import { useBookSelection } from './useBookSelection'

export function useBookViewSelection(books: Ref<BookCard[]>) {
  const selection = useBookSelection()

  const bookIds = computed(() => books.value.map((book) => book.id))

  function handleSelect(id: number, event: MouseEvent) {
    if (event.shiftKey) {
      selection.rangeSelectTo(id, bookIds.value)
      return
    }
    selection.toggleBook(id)
  }

  function toggleSelectionMode() {
    if (selection.selectionMode.value) selection.exitSelectionMode()
    else selection.enterSelectionMode()
  }

  return {
    ...selection,
    handleSelect,
    toggleSelectionMode,
  }
}
