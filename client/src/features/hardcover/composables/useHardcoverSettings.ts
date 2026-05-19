import { ref } from 'vue'
import type { HardcoverSettings, UpsertHardcoverSettingsPayload } from '@bookorbit/types'
import { disconnectHardcover, fetchHardcoverSettings, upsertHardcoverSettings, validateHardcoverToken } from '../api/hardcover.api'

const settings = ref<HardcoverSettings | null>(null)
const loading = ref(false)
const saving = ref(false)
const validating = ref(false)
const error = ref<string | null>(null)

export function useHardcoverSettings() {
  async function fetchSettings(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      settings.value = await fetchHardcoverSettings()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load settings'
    } finally {
      loading.value = false
    }
  }

  async function saveSettings(payload: UpsertHardcoverSettingsPayload): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      settings.value = await upsertHardcoverSettings(payload)
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
      await disconnectHardcover()
      settings.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to disconnect'
    } finally {
      saving.value = false
    }
  }

  async function validateToken(token?: string): Promise<{ valid: boolean; username?: string }> {
    validating.value = true
    try {
      const result = await validateHardcoverToken(token)
      return { valid: result.valid, username: result.hardcoverUsername }
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
    validateToken,
  }
}
