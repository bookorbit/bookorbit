import { ref } from 'vue'
import type { Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { BookCard } from '@bookorbit/types'
import { useTableViewControls } from './useTableViewControls'
import { useBookViewSelection } from './useBookViewSelection'
import { useBookNavigation } from './useBookNavigation'
import { useDeleteBook } from './useDeleteBook'
import { useBookBulkActions, type QuerySelectionState } from './useBookBulkActions'

interface BookTableShellOptions {
  viewType?: 'library' | 'collection' | 'smartScope'
  books: Ref<BookCard[]>
  total?: Ref<number>
  loading?: Ref<boolean>
  exitSelectionMode?: () => void
  querySelection?: Ref<QuerySelectionState | null>
}

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'

export function useBookTableShell({ books, querySelection }: BookTableShellOptions) {
  const router = useRouter()
  const { setBookContext } = useBookNavigation()
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
    undefined,
    querySelection,
  )

  const addToCollectionOpen = ref(false)
  const bulkEditOpen = ref(false)
  const sendBookOpen = ref(false)
  const quickViewBookId = ref<number | null>(null)
  const quickViewOpen = ref(false)

  function handleBookAction(book: BookCard, action: BookActionType): void {
    if (action === 'quick-view') {
      quickViewBookId.value = book.id
      quickViewOpen.value = true
      return
    }

    quickViewOpen.value = false

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

  function handleEditIndividually(): void {
    const orderedIds = books.value.filter((book) => selection.selectedIds.value.has(book.id)).map((book) => book.id)
    if (orderedIds.length === 0) return
    setBookContext(orderedIds, orderedIds.length)
    router.push({ name: 'book-detail', params: { bookId: orderedIds[0] }, query: { tab: 'edit' } })
    selection.exitSelectionMode()
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
    bulkEditOpen,
    sendBookOpen,
    quickViewBookId,
    quickViewOpen,
    handleBookAction,
    handleTableBookUpdate,
    handleEditIndividually,
  }
}
