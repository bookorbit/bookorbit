import { ref } from 'vue'
import type { StorygraphSettings, UpsertStorygraphSettingsPayload } from '@bookorbit/types'
import { disconnectStorygraph, fetchStorygraphSettings, upsertStorygraphSettings, validateStorygraphCookies } from '../api/storygraph.api'

const settings = ref<StorygraphSettings | null>(null)
const loading = ref(false)
const saving = ref(false)
const validating = ref(false)
const error = ref<string | null>(null)

export function useStorygraphSettings() {
  async function fetchSettings(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      settings.value = await fetchStorygraphSettings()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load settings'
    } finally {
      loading.value = false
    }
  }

  async function saveSettings(payload: UpsertStorygraphSettingsPayload): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      settings.value = await upsertStorygraphSettings(payload)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save settings'
      return false
    } finally {
      saving.value = false
    }
  }

  async function disconnect(): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await disconnectStorygraph()
      settings.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to disconnect'
    } finally {
      saving.value = false
    }
  }

  async function validateCookies(sessionCookie?: string, rememberToken?: string): Promise<{ valid: boolean }> {
    validating.value = true
    try {
      const result = await validateStorygraphCookies(sessionCookie, rememberToken)
      return { valid: result.valid }
    } catch {
      return { valid: false }
    } finally {
      validating.value = false
    }
  }

  return {
    settings,
    loading,
    saving,
    validating,
    error,
    fetchSettings,
    saveSettings,
    disconnect,
    validateCookies,
  }
}
