import type { Library, SortSpec } from '@bookorbit/types'
import { useRouter } from 'vue-router'
import { useLibraries } from './useLibraries'

const DEFAULT_SORT_FOR_NEW_LIBRARY: SortSpec[] = [{ field: 'addedAt', dir: 'desc' }]

function setDefaultSortForLibrary(libraryId: number) {
  const sortKey = `bookorbit:sort:library:${libraryId}`
  localStorage.setItem(sortKey, JSON.stringify(DEFAULT_SORT_FOR_NEW_LIBRARY))
}

export function useLibraryCreationRedirect() {
  const router = useRouter()
  const { refreshLibraries } = useLibraries()

  async function handleLibraryCreated(library: Pick<Library, 'id'>) {
    setDefaultSortForLibrary(library.id)
    await refreshLibraries()
    await router.push({ name: 'library', params: { id: library.id } })
  }

  return { handleLibraryCreated }
}
