import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { CreateFolderResult, DirectoryEntry, PathConfig } from '@bookorbit/types'
import { api } from '@/lib/api'
import { consolidateFolderPaths, coveringFolderPath, normalizeFolderPath } from './folder-paths'

export function useFolderBrowser(existingPaths: () => string[]) {
  const browseRoot = ref('/')
  const currentPath = ref('/')
  const entries = ref<DirectoryEntry[]>([])
  const loading = ref(false)
  const initialized = ref(false)
  const search = ref('')
  const error = ref<string | null>(null)
  const selectedPaths = ref<string[]>([])
  const selectionNotice = ref<string | null>(null)
  const creatingFolder = ref(false)
  const newFolderName = ref('')
  const createError = ref<string | null>(null)
  const createLoading = ref(false)
  const newFolderInput = ref<HTMLInputElement | null>(null)
  let loadSequence = 0

  const filteredEntries = computed(() => {
    const query = search.value.trim().toLowerCase()
    return query ? entries.value.filter((entry) => entry.name.toLowerCase().includes(query)) : entries.value
  })

  const breadcrumbs = computed(() => {
    const root = normalizeFolderPath(browseRoot.value)
    const current = normalizeFolderPath(currentPath.value)
    const crumbs = [{ label: root, path: root }]
    if (current === root) return crumbs

    const relative = root === '/' ? current.slice(1) : current.slice(root.length + 1)
    const parts = relative.split('/').filter(Boolean)
    let built = root === '/' ? '' : root
    for (const part of parts) {
      built = built ? `${built}/${part}` : `/${part}`
      crumbs.push({ label: part, path: built })
    }
    return crumbs
  })

  const canGoUp = computed(() => normalizeFolderPath(currentPath.value) !== normalizeFolderPath(browseRoot.value))
  const selectedCount = computed(() => selectedPaths.value.length)

  function navigate(path: string) {
    search.value = ''
    cancelNewFolder()
    const normalized = normalizeFolderPath(path)
    currentPath.value = isAtOrBelowBrowseRoot(normalized) ? normalized : browseRoot.value
  }

  function goUp() {
    if (!canGoUp.value) return
    const parts = currentPath.value.split('/').filter(Boolean)
    parts.pop()
    const parent = parts.length === 0 ? '/' : `/${parts.join('/')}`
    navigate(parent)
  }

  async function loadEntries(path: string) {
    const requestSequence = ++loadSequence
    loading.value = true
    error.value = null
    try {
      const response = await api(`/api/v1/path?path=${encodeURIComponent(path)}`)
      if (requestSequence !== loadSequence) return
      if (response.ok) {
        entries.value = await response.json()
      } else {
        error.value = 'This directory could not be read.'
        entries.value = []
      }
    } catch {
      if (requestSequence !== loadSequence) return
      error.value = 'BookOrbit could not connect to the server.'
      entries.value = []
    } finally {
      if (requestSequence === loadSequence) loading.value = false
    }
  }

  async function loadConfig() {
    try {
      const response = await api('/api/v1/path/config')
      if (response.ok) {
        const config: PathConfig = await response.json()
        browseRoot.value = normalizeFolderPath(config.root)
      }
    } catch {
      browseRoot.value = '/'
    } finally {
      currentPath.value = browseRoot.value
      await loadEntries(currentPath.value)
      initialized.value = true
    }
  }

  function reloadCurrent() {
    void loadEntries(currentPath.value)
  }

  function clearSearch() {
    search.value = ''
  }

  function isSelected(path: string): boolean {
    return selectedPaths.value.includes(normalizeFolderPath(path))
  }

  function existingPathStatus(path: string): string | null {
    const normalized = normalizeFolderPath(path)
    const existing = existingPaths().map(normalizeFolderPath)
    if (existing.includes(normalized)) return 'Already added'
    const coveringPath = coveringFolderPath(normalized, existing)
    return coveringPath ? `Covered by ${coveringPath}` : null
  }

  function selectedPathStatus(path: string): string | null {
    if (isSelected(path)) return 'Selected'
    const coveringPath = coveringFolderPath(path, selectedPaths.value)
    return coveringPath ? `Covered by ${coveringPath}` : null
  }

  function isSelectionDisabled(path: string): boolean {
    return existingPathStatus(path) !== null || (!isSelected(path) && selectedPathStatus(path) !== null)
  }

  function toggleSelection(path: string) {
    const normalized = normalizeFolderPath(path)
    const unavailableReason = existingPathStatus(normalized)
    if (unavailableReason) {
      selectionNotice.value = unavailableReason
      return
    }

    if (isSelected(normalized)) {
      selectedPaths.value = selectedPaths.value.filter((selected) => selected !== normalized)
      selectionNotice.value = null
      return
    }

    const coveringPath = coveringFolderPath(normalized, selectedPaths.value)
    if (coveringPath) {
      selectionNotice.value = `${normalized} is already covered by ${coveringPath}.`
      return
    }

    const previousCount = selectedPaths.value.length
    selectedPaths.value = consolidateFolderPaths([...selectedPaths.value, normalized])
    selectionNotice.value = selectedPaths.value.length <= previousCount ? 'Nested selections were consolidated into the top-level folder.' : null
  }

  function toggleCurrentPath() {
    toggleSelection(currentPath.value)
  }

  function toggleNewFolder() {
    creatingFolder.value = !creatingFolder.value
    newFolderName.value = ''
    createError.value = null
    if (creatingFolder.value) void nextTick(() => newFolderInput.value?.focus())
  }

  function cancelNewFolder() {
    creatingFolder.value = false
    newFolderName.value = ''
    createError.value = null
  }

  async function submitNewFolder() {
    const name = newFolderName.value.trim()
    if (!name || createLoading.value) return
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.startsWith('.')) {
      createError.value = 'Enter one folder name without slashes or a leading dot.'
      return
    }

    createLoading.value = true
    createError.value = null
    try {
      const response = await api('/api/v1/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: currentPath.value, name }),
      })
      if (response.ok) {
        const created: CreateFolderResult = await response.json()
        cancelNewFolder()
        navigate(created.path)
      } else {
        const body = await response.json().catch(() => ({}))
        const message = Array.isArray(body?.message) ? body.message[0] : body?.message
        createError.value = message ?? 'The folder could not be created.'
      }
    } catch {
      createError.value = 'BookOrbit could not connect to the server.'
    } finally {
      createLoading.value = false
    }
  }

  function onNewFolderKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitNewFolder()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelNewFolder()
    }
  }

  function isAtOrBelowBrowseRoot(path: string): boolean {
    const root = normalizeFolderPath(browseRoot.value)
    return root === '/' || path === root || path.startsWith(`${root}/`)
  }

  watch(currentPath, (path) => {
    if (initialized.value) void loadEntries(path)
  })

  onMounted(() => {
    void loadConfig()
  })

  return {
    browseRoot,
    currentPath,
    entries,
    loading,
    search,
    error,
    selectedPaths,
    selectionNotice,
    creatingFolder,
    newFolderName,
    createError,
    createLoading,
    newFolderInput,
    filteredEntries,
    breadcrumbs,
    canGoUp,
    selectedCount,
    navigate,
    goUp,
    reloadCurrent,
    clearSearch,
    isSelected,
    existingPathStatus,
    selectedPathStatus,
    isSelectionDisabled,
    toggleSelection,
    toggleCurrentPath,
    toggleNewFolder,
    cancelNewFolder,
    submitNewFolder,
    onNewFolderKeydown,
  }
}
