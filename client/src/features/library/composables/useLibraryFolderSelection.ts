import { ref } from 'vue'
import { i18n } from '@/i18n'
import { consolidateFolderPaths, coveringFolderPath, normalizeFolderPath } from './folder-paths'

interface FolderSelectionOptions {
  folders: () => string[]
  updateFolders: (folders: string[]) => void
  updatePickerOpen: (open: boolean) => void
}

export function useLibraryFolderSelection(options: FolderSelectionOptions) {
  const pickerOpen = ref(false)
  const manualEntryOpen = ref(false)
  const manualPath = ref('')
  const manualError = ref<string | null>(null)

  function openPicker() {
    pickerOpen.value = true
    options.updatePickerOpen(true)
  }

  function closePicker() {
    pickerOpen.value = false
    options.updatePickerOpen(false)
  }

  function addBrowsedFolders(paths: string[]) {
    updateWith(paths)
    closePicker()
  }

  function removeFolder(path: string) {
    options.updateFolders(options.folders().filter((folder) => normalizeFolderPath(folder) !== normalizeFolderPath(path)))
  }

  function toggleManualEntry() {
    manualEntryOpen.value = !manualEntryOpen.value
    manualError.value = null
  }

  function closeManualEntry() {
    manualEntryOpen.value = false
    manualPath.value = ''
    manualError.value = null
  }

  function clearManualError() {
    manualError.value = null
  }

  function addManualFolder() {
    const path = normalizeFolderPath(manualPath.value)
    if (!manualPath.value.trim()) {
      manualError.value = i18n.global.t('library.creator.folders.errors.empty')
      return
    }
    if (!path.startsWith('/')) {
      manualError.value = i18n.global.t('library.creator.folders.errors.notAbsolute')
      return
    }

    const existing = options.folders().map(normalizeFolderPath)
    if (existing.includes(path)) {
      manualError.value = i18n.global.t('library.creator.folders.errors.duplicate')
      return
    }

    const coveringPath = coveringFolderPath(path, existing)
    if (coveringPath) {
      manualError.value = i18n.global.t('library.creator.folders.errors.covered', { path: coveringPath })
      return
    }

    updateWith([path])
    closeManualEntry()
  }

  function updateWith(paths: string[]) {
    options.updateFolders(consolidateFolderPaths([...options.folders(), ...paths]))
  }

  return {
    pickerOpen,
    manualEntryOpen,
    manualPath,
    manualError,
    openPicker,
    closePicker,
    addBrowsedFolders,
    removeFolder,
    toggleManualEntry,
    closeManualEntry,
    clearManualError,
    addManualFolder,
  }
}
