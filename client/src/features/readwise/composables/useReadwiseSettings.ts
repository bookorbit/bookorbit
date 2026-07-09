import { ref } from 'vue'
import type { ReadwiseSettings, ReadwiseTokenValidationResult, UpsertReadwiseSettingsPayload } from '@bookorbit/types'
import { fetchReadwiseSettings, upsertReadwiseSettings, validateReadwiseToken } from '../api/readwise.api'

const settings = ref<ReadwiseSettings | null>(null)
const loading = ref(false)
const saving = ref(false)
const validating = ref(false)
const error = ref<string | null>(null)

export function useReadwiseSettings() {
  async function fetchSettings(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      settings.value = await fetchReadwiseSettings()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load settings'
    } finally {
      loading.value = false
    }
  }

  async function saveSettings(payload: UpsertReadwiseSettingsPayload): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      settings.value = await upsertReadwiseSettings(payload)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save settings'
      return false
    } finally {
      saving.value = false
    }
  }

  async function validateToken(token?: string): Promise<ReadwiseTokenValidationResult> {
    validating.value = true
    try {
      return await validateReadwiseToken(token)
    } catch {
      return { valid: false }
    } finally {
      validating.value = false
    }
  }

  return { settings, loading, saving, validating, error, fetchSettings, saveSettings, validateToken }
}
