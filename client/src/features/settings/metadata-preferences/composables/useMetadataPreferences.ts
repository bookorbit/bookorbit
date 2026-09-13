import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { api } from '@/lib/api'
import type { FieldPreferenceOverrides, LibraryMetadataPreferences, MetadataFetchPreferences } from '@bookorbit/types'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'

export function useMetadataPreferences() {
  const { t } = useI18n()
  const globalPrefs = ref<MetadataFetchPreferences | null>(null)
  const libraryPrefs = ref<Map<number, LibraryMetadataPreferences>>(new Map())
  const loadingGlobal = ref(false)
  const savingGlobal = ref(false)
  const savingLibrary = ref<number | null>(null)

  async function fetchGlobal(): Promise<MetadataFetchPreferences | null> {
    loadingGlobal.value = true
    try {
      const res = await api('/api/v1/metadata-preferences/global')
      if (!res.ok) return null
      const prefs = (await res.json()) as MetadataFetchPreferences
      globalPrefs.value = prefs
      return prefs
    } catch {
      return null
    } finally {
      loadingGlobal.value = false
    }
  }

  async function saveGlobal(prefs: MetadataFetchPreferences): Promise<boolean> {
    savingGlobal.value = true
    try {
      const res = await api('/api/v1/metadata-preferences/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (res.ok) {
        globalPrefs.value = prefs
        await fetchGlobal()
        toast.success(t('settings.metadata.preferences.toast.saved'))
        return true
      }
      toast.error(t('settings.metadata.preferences.toast.saveFailed'))
      return false
    } catch {
      toast.error(t('settings.metadata.preferences.toast.saveFailed'))
      return false
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

  async function saveLibraryDraft(libraryId: number, overrides: FieldPreferenceOverrides): Promise<boolean> {
    savingLibrary.value = libraryId
    try {
      const res = await api(`/api/v1/metadata-preferences/libraries/${libraryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      if (res.ok) {
        await fetchLibrary(libraryId)
        toast.success(t('settings.metadata.preferences.toast.saved'))
        return true
      }
      toast.error(t('settings.metadata.preferences.toast.saveFailed'))
      return false
    } catch {
      toast.error(t('settings.metadata.preferences.toast.saveFailed'))
      return false
    } finally {
      savingLibrary.value = null
    }
  }

  async function resetGlobal() {
    const res = await api('/api/v1/metadata-preferences/global', { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await fetchGlobal()
      toast.success(t('settings.metadata.preferences.toast.globalReset'))
    } else {
      toast.error(t('settings.metadata.preferences.toast.resetFailed'))
    }
  }

  async function clearAllProviders(prefs: MetadataFetchPreferences) {
    const fields: MetadataFetchPreferences['fields'] = { ...prefs.fields }
    for (const field of ALL_METADATA_FIELDS) {
      fields[field] = { ...prefs.fields[field], providers: [] }
    }
    await saveGlobal({ ...prefs, fields })
  }

  async function resetLibrary(libraryId: number) {
    const res = await api(`/api/v1/metadata-preferences/libraries/${libraryId}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await fetchLibrary(libraryId)
      toast.success(t('settings.metadata.preferences.toast.libraryReset'))
    } else {
      toast.error(t('settings.metadata.preferences.toast.resetFailed'))
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
