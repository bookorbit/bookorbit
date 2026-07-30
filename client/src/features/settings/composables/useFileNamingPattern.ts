import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { DEFAULT_DOWNLOAD_PATTERN, EXAMPLE_PATTERN_METADATA, resolveDownloadFilename, resolveUploadPath, validatePattern } from '@bookorbit/types'
import type { Library } from '@bookorbit/types'
import { useLibraries } from '@/features/library/composables/useLibraries'

export function previewPath(pattern: string): string {
  if (!pattern) return '/neuromancer.epub'

  const resolved = resolveUploadPath(pattern, EXAMPLE_PATTERN_METADATA, 'epub')
  if (!resolved) return '/the_name_of_the_wind.epub'

  return resolved.startsWith('/') ? resolved : `/${resolved}`
}

export function previewDownloadName(pattern: string): string {
  const resolved = resolveDownloadFilename(pattern || DEFAULT_DOWNLOAD_PATTERN, EXAMPLE_PATTERN_METADATA, 'epub')
  return resolved || 'neuromancer.epub'
}

export function useFileNamingPattern() {
  const { t } = useI18n()

  const globalPattern = ref('')
  const savedGlobalPattern = ref('')
  const globalError = ref('')
  const loadingGlobal = ref(false)
  const savingGlobal = ref(false)
  const folderPattern = ref('')
  const savedFolderPattern = ref('')
  const folderError = ref('')
  const loadingFolder = ref(false)
  const savingFolder = ref(false)
  const downloadPattern = ref('')
  const savedDownloadPattern = ref('')
  const downloadError = ref('')
  const loadingDownload = ref(false)
  const savingDownload = ref(false)
  const crossPlatformSanitizationEnabled = ref(true)
  const loadingCrossPlatformSanitization = ref(false)
  const savingCrossPlatformSanitization = ref(false)
  const savingLibraryId = ref<number | null>(null)
  const savedLibraryPatterns = ref<Record<number, string>>({})

  const { libraries, fetchLibraries } = useLibraries()

  const globalDirty = computed(() => globalPattern.value !== savedGlobalPattern.value)
  const folderDirty = computed(() => folderPattern.value !== savedFolderPattern.value)
  const downloadDirty = computed(() => downloadPattern.value !== savedDownloadPattern.value)

  async function fetchGlobalPattern() {
    loadingGlobal.value = true
    try {
      const res = await api('/api/v1/app-settings/upload-pattern')
      if (res.ok) {
        const data: { pattern: string } = await res.json()
        globalPattern.value = data.pattern
        savedGlobalPattern.value = data.pattern
      }
    } finally {
      loadingGlobal.value = false
    }
  }

  async function fetchFolderPattern() {
    loadingFolder.value = true
    try {
      const res = await api('/api/v1/app-settings/upload-pattern-folder')
      if (res.ok) {
        const data: { pattern: string } = await res.json()
        folderPattern.value = data.pattern
        savedFolderPattern.value = data.pattern
      }
    } finally {
      loadingFolder.value = false
    }
  }

  async function fetchDownloadPattern() {
    loadingDownload.value = true
    try {
      const res = await api('/api/v1/app-settings/download-pattern')
      if (res.ok) {
        const data: { pattern: string } = await res.json()
        downloadPattern.value = data.pattern
        savedDownloadPattern.value = data.pattern
      }
    } finally {
      loadingDownload.value = false
    }
  }

  async function fetchCrossPlatformSanitization() {
    loadingCrossPlatformSanitization.value = true
    try {
      const res = await api('/api/v1/app-settings/cross-platform-path-sanitization')
      if (res.ok) {
        const data: { enabled: boolean } = await res.json()
        crossPlatformSanitizationEnabled.value = data.enabled
      }
    } finally {
      loadingCrossPlatformSanitization.value = false
    }
  }

  async function loadLibraries() {
    await fetchLibraries()
    const snapshot: Record<number, string> = {}
    for (const library of libraries.value) snapshot[library.id] = library.fileNamingPattern ?? ''
    savedLibraryPatterns.value = snapshot
  }

  function isLibraryDirty(library: Library): boolean {
    return (library.fileNamingPattern ?? '') !== (savedLibraryPatterns.value[library.id] ?? '')
  }

  function patternError(value: string): string {
    return value && !validatePattern(value) ? t('settings.reader.fileNaming.invalidCharacters') : ''
  }

  function onGlobalPatternInput(value: string) {
    globalPattern.value = value
    globalError.value = patternError(value)
  }

  function onFolderPatternInput(value: string) {
    folderPattern.value = value
    folderError.value = patternError(value)
  }

  function onDownloadPatternInput(value: string) {
    downloadPattern.value = value
    downloadError.value = patternError(value)
  }

  async function saveGlobalPattern() {
    if (globalError.value) return
    savingGlobal.value = true
    try {
      const res = await api('/api/v1/app-settings/upload-pattern', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: globalPattern.value }),
      })
      if (res.ok) {
        savedGlobalPattern.value = globalPattern.value
        toast.success(t('settings.reader.fileNaming.fileAsBookSaved'))
      } else {
        toast.error(t('settings.reader.fileNaming.savePatternFailed'))
      }
    } finally {
      savingGlobal.value = false
    }
  }

  async function saveFolderPattern() {
    if (folderError.value) return
    savingFolder.value = true
    try {
      const res = await api('/api/v1/app-settings/upload-pattern-folder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: folderPattern.value }),
      })
      if (res.ok) {
        savedFolderPattern.value = folderPattern.value
        toast.success(t('settings.reader.fileNaming.folderAsBookSaved'))
      } else {
        toast.error(t('settings.reader.fileNaming.savePatternFailed'))
      }
    } finally {
      savingFolder.value = false
    }
  }

  async function saveDownloadPattern() {
    if (downloadError.value) return
    savingDownload.value = true
    try {
      const res = await api('/api/v1/app-settings/download-pattern', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: downloadPattern.value }),
      })
      if (res.ok) {
        savedDownloadPattern.value = downloadPattern.value
        toast.success(t('settings.reader.fileNaming.downloadPatternSaved'))
      } else {
        toast.error(t('settings.reader.fileNaming.saveDownloadPatternFailed'))
      }
    } finally {
      savingDownload.value = false
    }
  }

  async function setCrossPlatformSanitization(enabled: boolean) {
    if (savingCrossPlatformSanitization.value) return
    const previous = crossPlatformSanitizationEnabled.value
    crossPlatformSanitizationEnabled.value = enabled
    savingCrossPlatformSanitization.value = true
    try {
      const res = await api('/api/v1/app-settings/cross-platform-path-sanitization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) {
        toast.success(enabled ? t('settings.reader.fileNaming.crossPlatformEnabled') : t('settings.reader.fileNaming.crossPlatformDisabled'))
      } else {
        crossPlatformSanitizationEnabled.value = previous
        toast.error(t('settings.reader.fileNaming.crossPlatformSaveFailed'))
      }
    } finally {
      savingCrossPlatformSanitization.value = false
    }
  }

  async function saveLibraryPattern(library: Library) {
    savingLibraryId.value = library.id
    try {
      const res = await api(`/api/v1/libraries/${library.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileNamingPattern: library.fileNamingPattern ?? null }),
      })
      if (res.ok) {
        savedLibraryPatterns.value = { ...savedLibraryPatterns.value, [library.id]: library.fileNamingPattern ?? '' }
        toast.success(t('settings.reader.fileNaming.librarySaved', { name: library.name }))
      } else {
        toast.error(t('settings.reader.fileNaming.librarySaveFailed'))
      }
    } finally {
      savingLibraryId.value = null
    }
  }

  async function clearLibraryPattern(library: Library) {
    library.fileNamingPattern = null
    await saveLibraryPattern(library)
  }

  function getEffectivePreview(library: Library): string {
    const base = library.organizationMode === 'book_per_folder' ? folderPattern.value : globalPattern.value
    return previewPath(library.fileNamingPattern ?? base)
  }

  return {
    globalPattern,
    globalError,
    globalDirty,
    folderPattern,
    folderError,
    folderDirty,
    downloadPattern,
    downloadError,
    downloadDirty,
    crossPlatformSanitizationEnabled,
    libraries,
    loadingGlobal,
    savingGlobal,
    loadingFolder,
    savingFolder,
    loadingDownload,
    savingDownload,
    loadingCrossPlatformSanitization,
    savingCrossPlatformSanitization,
    savingLibraryId,
    fetchGlobalPattern,
    fetchFolderPattern,
    fetchDownloadPattern,
    fetchCrossPlatformSanitization,
    loadLibraries,
    isLibraryDirty,
    onGlobalPatternInput,
    onFolderPatternInput,
    onDownloadPatternInput,
    saveGlobalPattern,
    saveFolderPattern,
    saveDownloadPattern,
    setCrossPlatformSanitization,
    saveLibraryPattern,
    clearLibraryPattern,
    getEffectivePreview,
    previewPath,
    previewDownloadName,
  }
}
