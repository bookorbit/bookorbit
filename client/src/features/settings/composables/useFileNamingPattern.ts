import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { EXAMPLE_PATTERN_METADATA, resolveUploadPath, validatePattern } from '@projectx/types'
import type { Library } from '@projectx/types'
import { useLibraries } from '@/features/library/composables/useLibraries'

export function previewPath(pattern: string): string {
  if (!pattern) return '/neuromancer.epub'

  const resolved = resolveUploadPath(pattern, EXAMPLE_PATTERN_METADATA, 'epub')
  if (!resolved) return '/the_name_of_the_wind.epub'

  return resolved.startsWith('/') ? resolved : `/${resolved}`
}

export function useFileNamingPattern() {
  const globalPattern = ref('')
  const globalError = ref('')
  const loadingGlobal = ref(false)
  const savingGlobal = ref(false)
  const savingLibraryId = ref<number | null>(null)

  const { libraries, fetchLibraries } = useLibraries()

  async function fetchGlobalPattern() {
    loadingGlobal.value = true
    try {
      const res = await api('/api/app-settings/upload-pattern')
      if (res.ok) {
        const data: { pattern: string } = await res.json()
        globalPattern.value = data.pattern
      }
    } finally {
      loadingGlobal.value = false
    }
  }

  function onGlobalPatternInput(value: string) {
    globalPattern.value = value
    globalError.value = value && !validatePattern(value) ? 'Pattern contains invalid characters' : ''
  }

  async function saveGlobalPattern() {
    if (globalError.value) return
    savingGlobal.value = true
    try {
      const res = await api('/api/app-settings/upload-pattern', {
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

  async function saveLibraryPattern(library: Library) {
    savingLibraryId.value = library.id
    try {
      const res = await api(`/api/libraries/${library.id}`, {
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
    libraries,
    loadingGlobal,
    savingGlobal,
    savingLibraryId,
    fetchGlobalPattern,
    fetchLibraries,
    onGlobalPatternInput,
    saveGlobalPattern,
    saveLibraryPattern,
    clearLibraryPattern,
    getEffectivePreview,
    previewPath,
  }
}
