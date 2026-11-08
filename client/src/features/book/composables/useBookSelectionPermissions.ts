import { computed, shallowRef, watch, type Ref } from 'vue'
import { Permission, type BookCard } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { mergeDisabledReason, type MergeSelectionState } from '../lib/book-merge'
import { linkDisabledReason, type LinkSelectionState } from '../lib/book-link'
import type { QuerySelectionState } from './useBookBulkActions'

export function useBookSelectionPermissions(books: Ref<BookCard[]>, selectedIds: Ref<Set<number>>, querySelection?: Ref<QuerySelectionState | null>) {
  const { hasPermission } = usePermissions()
  const { hasLibraryPermission, hasPermissionInAnyLibrary } = useLibraryPermissions()
  const { libraries } = useLibraries()
  const selectedLibraries = shallowRef(new Map<number, number | undefined>())
  watch(
    () => ({
      ids: [...selectedIds.value],
      loaded: books.value.filter((book) => selectedIds.value.has(book.id)).map((book) => ({ id: book.id, libraryId: book.libraryId })),
    }),
    ({ ids, loaded }) => {
      const next = new Map<number, number | undefined>()
      for (const id of ids) {
        if (selectedLibraries.value.has(id)) next.set(id, selectedLibraries.value.get(id))
      }
      for (const book of loaded) next.set(book.id, book.libraryId)
      selectedLibraries.value = next
    },
    { immediate: true, flush: 'sync' },
  )
  const canEditSelectionMetadata = computed(() => {
    const query = querySelection?.value
    if (query) {
      if (query.libraryId != null) return hasLibraryPermission(Permission.LibraryEditMetadata, query.libraryId, 'editor')
      return (
        libraries.value.length > 0 && libraries.value.every((library) => hasLibraryPermission(Permission.LibraryEditMetadata, library.id, 'editor'))
      )
    }
    if (selectedIds.value.size === 0) return false
    return [...selectedIds.value].every(
      (id) => selectedLibraries.value.has(id) && hasLibraryPermission(Permission.LibraryEditMetadata, selectedLibraries.value.get(id), 'editor'),
    )
  })

  /**
   * Null hides Merge: no permission, or editor access to none of the selected libraries. Otherwise
   * Merge shows, disabled with a reason when this selection cannot be merged as it stands. Books may
   * sit in different libraries, but every one of them must be editable, as for Link.
   */
  const mergeSelection = computed<MergeSelectionState | null>(() => {
    if (!hasPermission(Permission.LibraryMergeBooks)) return null
    const query = querySelection?.value
    if (query) {
      const allowed =
        query.libraryId != null
          ? hasLibraryPermission(Permission.LibraryMergeBooks, query.libraryId, 'editor')
          : hasPermissionInAnyLibrary(Permission.LibraryMergeBooks, 'editor')
      return allowed ? { disabledReason: 'queryScoped' } : null
    }
    const { anyEditable, allEditable } = selectionEditability()
    const allowed = selectedIds.value.size === 0 ? hasPermissionInAnyLibrary(Permission.LibraryMergeBooks, 'editor') : anyEditable
    if (!allowed) return null
    return { disabledReason: mergeDisabledReason({ queryScoped: false, count: selectedIds.value.size, allEditable }) }
  })

  function selectionEditability(): { anyEditable: boolean; allEditable: boolean } {
    let anyEditable = false
    let allEditable = true
    for (const id of selectedIds.value) {
      const editable = hasLibraryPermission(Permission.LibraryMergeBooks, selectedLibraries.value.get(id), 'editor')
      anyEditable ||= editable
      allEditable &&= editable
    }
    return { anyEditable, allEditable }
  }

  /**
   * Null hides Link, on the same rule as Merge. Linking may span libraries, but the server needs
   * editor access to every selected book's library, so a selection that reaches into a library the
   * user only views, or one whose library is unknown, is offered with a reason instead.
   */
  const linkSelection = computed<LinkSelectionState | null>(() => {
    if (!hasPermission(Permission.LibraryMergeBooks)) return null
    const query = querySelection?.value
    if (query) {
      const allowed =
        query.libraryId != null
          ? hasLibraryPermission(Permission.LibraryMergeBooks, query.libraryId, 'editor')
          : hasPermissionInAnyLibrary(Permission.LibraryMergeBooks, 'editor')
      return allowed ? { disabledReason: 'queryScoped' } : null
    }
    const { anyEditable, allEditable } = selectionEditability()
    const allowed = selectedIds.value.size === 0 ? hasPermissionInAnyLibrary(Permission.LibraryMergeBooks, 'editor') : anyEditable
    if (!allowed) return null
    return { disabledReason: linkDisabledReason({ queryScoped: false, count: selectedIds.value.size, allEditable }) }
  })

  return { canEditSelectionMetadata, mergeSelection, linkSelection }
}
