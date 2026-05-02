import { ref } from 'vue'
import type { BookCard } from '@bookorbit/types'

export function useTableContextMenu() {
  const contextMenuBook = ref<BookCard | null>(null)
  const contextMenuPosition = ref<{ x: number; y: number } | null>(null)

  function openContextMenu(event: MouseEvent, book: BookCard) {
    event.preventDefault()
    contextMenuBook.value = book
    contextMenuPosition.value = { x: event.clientX, y: event.clientY }
  }

  function closeContextMenu() {
    contextMenuBook.value = null
    contextMenuPosition.value = null
  }

  return { contextMenuBook, contextMenuPosition, openContextMenu, closeContextMenu }
}
