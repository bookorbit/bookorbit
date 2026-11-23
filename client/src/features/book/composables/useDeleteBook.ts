import { ref } from 'vue'
import { Permission, type BookCard, type BookDetail } from '@bookorbit/types'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { i18n } from '@/i18n'
import { useLibraryCountsRefresh } from '@/features/library/composables/useLibraryCountsRefresh'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { cardEditionCount, deleteEditionsChoice, type DeleteEditionsChoice } from '@/features/book/lib/book-editions'

/** What the prompt deletes: the book alone, or with the other editions this user may delete. */
export type DeleteScope = 'edition' | 'all'

export function useDeleteBook(onDeleted: (id: number) => void) {
  const { hasLibraryPermission } = useLibraryPermissions()
  const refreshLibraryCounts = useLibraryCountsRefresh()
  const pendingId = ref<number | null>(null)
  const deleting = ref(false)
  /** Set when the pending book has other editions; the prompt then offers to delete them too. */
  const editions = ref<DeleteEditionsChoice | null>(null)

  function canDeleteInLibrary(libraryId: number): boolean {
    return hasLibraryPermission(Permission.LibraryDeleteBooks, libraryId)
  }

  /**
   * A book page passes its editions; a card with other editions has them looked up, so the prompt
   * can name them. Without them the prompt deletes this book alone.
   */
  function promptDelete(id: number, source?: DeleteEditionsChoice | Pick<BookCard, 'linked' | 'collapsedSeries'> | null) {
    pendingId.value = id
    editions.value = null
    if (!source) return
    if ('current' in source) {
      editions.value = source
      return
    }
    if (cardEditionCount(source) > 0) void loadEditions(id)
  }

  async function loadEditions(id: number) {
    try {
      const res = await api(`/api/v1/books/${id}`)
      if (!res.ok || pendingId.value !== id) return
      const detail = (await res.json()) as BookDetail
      if (pendingId.value === id) editions.value = deleteEditionsChoice(detail, canDeleteInLibrary)
    } catch {
      // The prompt still deletes this edition; it just cannot offer the others.
    }
  }

  function cancelDelete() {
    pendingId.value = null
    editions.value = null
  }

  async function confirmDelete(scope: DeleteScope = 'edition') {
    if (pendingId.value === null) return
    const id = pendingId.value
    const others = scope === 'all' ? (editions.value?.others.map((other) => other.bookId) ?? []) : []
    const ids = [id, ...others]
    deleting.value = true
    try {
      const res = await api('/api/v1/books', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds: ids }),
      })
      if (!res.ok) {
        toast.error(i18n.global.t('book.deleteDialog.failed'))
        return
      }
      for (const deletedId of ids) onDeleted(deletedId)
      refreshLibraryCounts()
      toast.success(
        ids.length > 1 ? i18n.global.t('book.editions.delete.deleted', { count: ids.length }) : i18n.global.t('book.deleteDialog.deleted'),
      )
    } finally {
      deleting.value = false
      pendingId.value = null
      editions.value = null
    }
  }

  return { pendingId, deleting, editions, promptDelete, cancelDelete, confirmDelete }
}
