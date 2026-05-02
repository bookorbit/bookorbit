import { ref } from 'vue'
import type { Ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import { useTableViewControls } from './useTableViewControls'
import { useBookViewSelection } from './useBookViewSelection'
import { useDeleteBook } from './useDeleteBook'
import { useBookBulkActions, type QuerySelectionState } from './useBookBulkActions'

interface BookTableShellOptions {
  viewType?: 'library' | 'collection' | 'smartScope'
  books: Ref<BookCard[]>
  total?: Ref<number>
  loading?: Ref<boolean>
  exitSelectionMode?: () => void
  loadFn: (force?: boolean) => void | Promise<void>
  querySelection?: Ref<QuerySelectionState | null>
}

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'

export function useBookTableShell({ books, loadFn, querySelection }: BookTableShellOptions) {
  const tableControls = useTableViewControls()
  const selection = useBookViewSelection(books)

  const {
    pendingId: deleteBookId,
    deleting: deletingBook,
    promptDelete,
    cancelDelete,
    confirmDelete,
  } = useDeleteBook((id) => {
    books.value = books.value.filter((book) => book.id !== id)
  })

  const bulk = useBookBulkActions(
    selection.selectedIds,
    (ids) => {
      const deleted = new Set(ids)
      books.value = books.value.filter((book) => !deleted.has(book.id))
      selection.exitSelectionMode()
    },
    books,
    () => loadFn(true),
    querySelection,
  )

  const addToCollectionOpen = ref(false)
  const bulkTagsOpen = ref(false)
  const sendBookOpen = ref(false)
  const quickViewBookId = ref<number | null>(null)
  const quickViewOpen = ref(false)

  function handleBookAction(book: BookCard, action: BookActionType): void {
    if (action === 'quick-view') {
      quickViewBookId.value = book.id
      quickViewOpen.value = true
      return
    }

    if (action === 'add-to-collection') {
      if (!selection.selectionMode.value) {
        selection.enterSelectionMode()
        selection.toggleBook(book.id)
      }
      addToCollectionOpen.value = true
      return
    }

    promptDelete(book.id)
  }

  function handleTableBookUpdate(updated: BookCard): void {
    const index = books.value.findIndex((book) => book.id === updated.id)
    if (index === -1) return

    books.value = books.value.map((book, currentIndex) => (currentIndex === index ? updated : book))
  }

  return {
    ...tableControls,
    ...selection,
    deleteBookId,
    deletingBook,
    promptDelete,
    cancelDelete,
    confirmDelete,
    ...bulk,
    addToCollectionOpen,
    bulkTagsOpen,
    sendBookOpen,
    quickViewBookId,
    quickViewOpen,
    handleBookAction,
    handleTableBookUpdate,
  }
}
