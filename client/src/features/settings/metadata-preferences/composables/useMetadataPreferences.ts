import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { FieldPreference, LibraryMetadataPreferences, MetadataFetchPreferences, MetadataField } from '@projectx/types'

export function useMetadataPreferences() {
  const globalPrefs = ref<MetadataFetchPreferences | null>(null)
  const libraryPrefs = ref<Map<number, LibraryMetadataPreferences>>(new Map())
  const loadingGlobal = ref(false)
  const savingGlobal = ref(false)
  const savingField = ref<string | null>(null)

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

  async function saveFieldOverride(libraryId: number, field: MetadataField, pref: FieldPreference | null) {
    const key = `${libraryId}:${field}`
    savingField.value = key
    try {
      const url = `/api/v1/metadata-preferences/libraries/${libraryId}/fields/${field}`
      const res = await api(url, {
        method: pref === null ? 'DELETE' : 'PUT',
        headers: pref !== null ? { 'Content-Type': 'application/json' } : undefined,
        body: pref !== null ? JSON.stringify(pref) : undefined,
      })
      if (res.ok || res.status === 204) {
        await fetchLibrary(libraryId)
      } else {
        toast.error('Failed to save field override')
      }
    } finally {
      savingField.value = null
    }
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
    savingField,
    fetchGlobal,
    saveGlobal,
    fetchLibrary,
    saveFieldOverride,
    resetLibrary,
  }
}
