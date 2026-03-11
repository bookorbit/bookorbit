import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { DEFAULT_DOWNLOAD_PATTERN, EXAMPLE_PATTERN_METADATA, resolveDownloadFilename, resolveUploadPath, validatePattern } from '@projectx/types'
import type { Library } from '@projectx/types'
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
  const globalPattern = ref('')
  const globalError = ref('')
  const loadingGlobal = ref(false)
  const savingGlobal = ref(false)
  const downloadPattern = ref('')
  const downloadError = ref('')
  const loadingDownload = ref(false)
  const savingDownload = ref(false)
  const savingLibraryId = ref<number | null>(null)

  const { libraries, fetchLibraries } = useLibraries()

  async function fetchGlobalPattern() {
    loadingGlobal.value = true
    try {
      const res = await api('/api/v1/app-settings/upload-pattern')
      if (res.ok) {
        const data: { pattern: string } = await res.json()
        globalPattern.value = data.pattern
      }
    } finally {
      loadingGlobal.value = false
    }
  }

  async function fetchDownloadPattern() {
    loadingDownload.value = true
    try {
      const res = await api('/api/v1/app-settings/download-pattern')
      if (res.ok) {
        const data: { pattern: string } = await res.json()
        downloadPattern.value = data.pattern
      }
    } finally {
      loadingDownload.value = false
    }
  }

  function onGlobalPatternInput(value: string) {
    globalPattern.value = value
    globalError.value = value && !validatePattern(value) ? 'Pattern contains invalid characters' : ''
  }

  function onDownloadPatternInput(value: string) {
    downloadPattern.value = value
    downloadError.value = value && !validatePattern(value) ? 'Pattern contains invalid characters' : ''
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
        toast.success('Default pattern saved')
      } else {
        toast.error('Failed to save pattern')
      }
    } finally {
      savingGlobal.value = false
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
        toast.success('Download pattern saved')
      } else {
        toast.error('Failed to save download pattern')
      }
    } finally {
      savingDownload.value = false
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
        toast.success(`Pattern saved for "${library.name}"`)
      } else {
        toast.error('Failed to save library pattern')
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
    return previewPath(library.fileNamingPattern ?? globalPattern.value)
  }

  return {
    globalPattern,
    globalError,
    downloadPattern,
    downloadError,
    libraries,
    loadingGlobal,
    savingGlobal,
    loadingDownload,
    savingDownload,
    savingLibraryId,
    fetchGlobalPattern,
    fetchDownloadPattern,
    fetchLibraries,
    onGlobalPatternInput,
    onDownloadPatternInput,
    saveGlobalPattern,
    saveDownloadPattern,
    saveLibraryPattern,
    clearLibraryPattern,
    getEffectivePreview,
    previewPath,
    previewDownloadName,
  }
}
