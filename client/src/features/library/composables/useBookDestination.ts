import { computed, ref, watchEffect } from 'vue'
import { useLibraries } from './useLibraries'

interface BookDestinationOptions {
  libraryId?: number | null
  folderId?: number | null
  defaultToFirstLibrary?: boolean
}

export function useBookDestination(options: BookDestinationOptions = {}) {
  const source = useLibraries()
  const libraries = computed(() => source.libraries.value.filter((library) => library.type === 'books'))
  const libraryId = ref<number | null>(options.libraryId ?? null)
  const folderId = ref<number | null>(options.folderId ?? null)
  const selectedLibrary = computed(() => libraries.value.find((library) => library.id === libraryId.value))
  const folders = computed(() => selectedLibrary.value?.folders ?? [])
  const selectedFolder = computed(() => folders.value.find((folder) => folder.id === folderId.value))
  const available = computed(() => source.loaded.value && !source.loading.value && !source.error.value)
  const hasDestination = computed(() => available.value && !!selectedLibrary.value && !!selectedFolder.value)

  watchEffect(() => {
    if (!available.value) return
    if (libraryId.value === null && (libraries.value.length === 1 || options.defaultToFirstLibrary)) {
      libraryId.value = libraries.value[0]?.id ?? null
    }
    if (folderId.value === null) folderId.value = folders.value[0]?.id ?? null
  })

  async function fetchLibraries(): Promise<void> {
    if (source.error.value) await source.refreshLibraries()
    else await source.fetchLibraries()
  }

  function selectLibrary(id: number | null): void {
    libraryId.value = id
    folderId.value = libraries.value.find((library) => library.id === id)?.folders[0]?.id ?? null
  }

  function selectFolder(id: number | null): void {
    folderId.value = id
  }

  function reset(library: number | null, folder: number | null): void {
    libraryId.value = library
    folderId.value = folder
  }

  return {
    libraries,
    libraryId,
    folderId,
    selectedLibrary,
    folders,
    selectedFolder,
    available,
    hasDestination,
    loading: source.loading,
    loaded: source.loaded,
    error: source.error,
    fetchLibraries,
    refreshLibraries: source.refreshLibraries,
    selectLibrary,
    selectFolder,
    reset,
  }
}

export type BookDestination = ReturnType<typeof useBookDestination>
