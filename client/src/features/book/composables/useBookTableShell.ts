import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { BookCard } from '@bookorbit/types'
import { useTableViewControls } from './useTableViewControls'
import { useBookViewSelection } from './useBookViewSelection'
import { useBookSelectionPermissions } from './useBookSelectionPermissions'
import { useBookNavigation } from './useBookNavigation'
import { useDeleteBook } from './useDeleteBook'
import { useBookBulkActions, type QuerySelectionState } from './useBookBulkActions'
import { hasLinkedBooks, type LinkSeedBook } from '../lib/book-link'

interface BookTableShellOptions {
  viewType?: 'library' | 'collection' | 'smartScope'
  books: Ref<BookCard[]>
  selectionMode?: Ref<boolean>
  total?: Ref<number>
  loading?: Ref<boolean>
  exitSelectionMode?: () => void
  querySelection?: Ref<QuerySelectionState | null>
  /** Called for a single-book move; the host view owns the destination sheet. */
  onMoveToLibrary?: (bookId: number) => void
}

type BookActionType = 'quick-view' | 'add-to-collection' | 'move-to-library' | 'delete'

export function useBookTableShell({ books, selectionMode, querySelection, onMoveToLibrary }: BookTableShellOptions) {
  const router = useRouter()
  const { setBookContext } = useBookNavigation()
  const tableControls = useTableViewControls()
  const selection = useBookViewSelection(books, selectionMode)
  const { canEditSelectionMetadata, mergeSelection, linkSelection } = useBookSelectionPermissions(books, selection.selectedIds, querySelection)

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
  const mergeOpen = ref(false)
  /** Captured when the sheet opens, in grid order; the live selection changes once the merge lands. */
  const mergeBookIds = ref<number[]>([])
  const linkOpen = ref(false)
  /** Captured when the sheet opens, in grid order: the first book becomes the main book of a new link. */
  const linkBookIds = ref<number[]>([])
  const linkBooks = ref<BookCard[]>([])
  const linkSeedBooks = ref<LinkSeedBook[]>([])

  /**
   * A selected card stands for a book linked with others. Deleting it removes that book only, which
   * the confirmation says (G6). A query selection resolves every matching book, so it never applies.
   */
  const selectionHasLinked = computed(() => {
    if (querySelection?.value) return false
    const selected = selection.selectedIds.value
    return books.value.some((book) => selected.has(book.id) && hasLinkedBooks(book))
  })
  const pendingDeleteLinked = computed(() => {
    const id = deleteBookId.value
    return id !== null && hasLinkedBooks(books.value.find((book) => book.id === id))
  })

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

    if (action === 'move-to-library') {
      onMoveToLibrary?.(book.id)
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

  function openMergeForSelection(): void {
    if (mergeSelection.value?.disabledReason !== null) return
    const selected = selection.selectedIds.value
    const loaded = books.value.filter((book) => selected.has(book.id)).map((book) => book.id)
    const loadedIds = new Set(loaded)
    mergeBookIds.value = [...loaded, ...[...selected].filter((id) => !loadedIds.has(id))]
    mergeOpen.value = true
  }

  function setMergeOpen(open: boolean): void {
    mergeOpen.value = open
  }

  function openLinkForSelection(): void {
    if (linkSelection.value?.disabledReason !== null) return
    const selected = selection.selectedIds.value
    const loaded = books.value.filter((book) => selected.has(book.id))
    const loadedIds = new Set(loaded.map((book) => book.id))
    linkBooks.value = loaded
    linkSeedBooks.value = []
    linkBookIds.value = [...loadedIds, ...[...selected].filter((id) => !loadedIds.has(id))]
    linkOpen.value = true
  }

  function setLinkOpen(open: boolean): void {
    linkOpen.value = open
  }

  /** A merge blocker suggested Link: open it for the same books, the kept one first, which may span libraries. */
  function switchMergeToLink(bookIds: number[], seeds: LinkSeedBook[] = []): void {
    mergeOpen.value = false
    const wanted = new Set(bookIds)
    linkBooks.value = books.value.filter((book) => wanted.has(book.id))
    linkSeedBooks.value = seeds
    linkBookIds.value = [...bookIds]
    linkOpen.value = true
  }

  return {
    ...tableControls,
    ...selection,
    canEditSelectionMetadata,
    mergeSelection,
    mergeOpen,
    mergeBookIds,
    openMergeForSelection,
    setMergeOpen,
    linkSelection,
    linkOpen,
    linkBookIds,
    linkBooks,
    linkSeedBooks,
    openLinkForSelection,
    setLinkOpen,
    switchMergeToLink,
    selectionHasLinked,
    pendingDeleteLinked,
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
