import { computed, shallowRef, watch, type Ref } from 'vue'
import { Permission, type BookCard } from '@bookorbit/types'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import type { QuerySelectionState } from './useBookBulkActions'

export function useBookSelectionPermissions(books: Ref<BookCard[]>, selectedIds: Ref<Set<number>>, querySelection?: Ref<QuerySelectionState | null>) {
  const { hasLibraryPermission } = useLibraryPermissions()
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

  return { canEditSelectionMetadata }
}
