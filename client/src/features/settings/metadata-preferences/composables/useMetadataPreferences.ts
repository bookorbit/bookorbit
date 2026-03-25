import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { FieldPreferenceOverrides, LibraryMetadataPreferences, MetadataFetchPreferences } from '@projectx/types'
import { ALL_METADATA_FIELDS } from '@projectx/types'

export function useMetadataPreferences() {
  const globalPrefs = ref<MetadataFetchPreferences | null>(null)
  const libraryPrefs = ref<Map<number, LibraryMetadataPreferences>>(new Map())
  const loadingGlobal = ref(false)
  const savingGlobal = ref(false)
  const savingLibrary = ref<number | null>(null)

  async function fetchGlobal() {
    loadingGlobal.value = true
    try {
      const res = await api('/api/v1/metadata-preferences/global')
      if (res.ok) globalPrefs.value = await res.json()
    } finally {
      loadingGlobal.value = false
    }
  }

  async function saveGlobal(prefs: MetadataFetchPreferences) {
    savingGlobal.value = true
    try {
      const res = await api('/api/v1/metadata-preferences/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (res.ok) {
        await fetchGlobal()
        toast.success('Global preferences saved')
      } else {
        toast.error('Failed to save preferences')
      }
    } finally {
      savingGlobal.value = false
    }
  }

  async function fetchLibrary(libraryId: number) {
    const res = await api(`/api/v1/metadata-preferences/libraries/${libraryId}`)
    if (res.ok) {
      const data: LibraryMetadataPreferences = await res.json()
      libraryPrefs.value = new Map(libraryPrefs.value).set(libraryId, data)
    }
  }

  async function saveLibraryDraft(libraryId: number, overrides: FieldPreferenceOverrides) {
    savingLibrary.value = libraryId
    try {
      const res = await api(`/api/v1/metadata-preferences/libraries/${libraryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      if (res.ok) {
        await fetchLibrary(libraryId)
        toast.success('Library preferences saved')
      } else {
        toast.error('Failed to save library preferences')
      }
    } finally {
      savingLibrary.value = null
    }
  }

  async function resetGlobal() {
    const res = await api('/api/v1/metadata-preferences/global', { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await fetchGlobal()
      toast.success('Global preferences reset to system defaults')
    } else {
      toast.error('Failed to reset global preferences')
    }
  }

  async function clearAllProviders(prefs: MetadataFetchPreferences) {
    const fields: MetadataFetchPreferences['fields'] = { ...prefs.fields }
    for (const field of ALL_METADATA_FIELDS) {
      fields[field] = { ...prefs.fields[field], providers: [] }
    }
    const cleared: MetadataFetchPreferences = {
      ...prefs,
      fields,
    }
    await saveGlobal(cleared)
  }

  async function resetLibrary(libraryId: number) {
    const res = await api(`/api/v1/metadata-preferences/libraries/${libraryId}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await fetchLibrary(libraryId)
      toast.success('Library reset to global defaults')
    } else {
      toast.error('Failed to reset library')
    }
  }

  return {
    globalPrefs,
    libraryPrefs,
    loadingGlobal,
    savingGlobal,
    savingLibrary,
    fetchGlobal,
    saveGlobal,
    resetGlobal,
    clearAllProviders,
    fetchLibrary,
    saveLibraryDraft,
    resetLibrary,
  }
}
