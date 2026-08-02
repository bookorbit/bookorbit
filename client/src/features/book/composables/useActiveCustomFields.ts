import { ref } from 'vue'
import type { CustomMetadataFieldSummary } from '@bookorbit/types'
import { api } from '@/lib/api'

// Module-level singleton: shared across all table instances in the same session.
// Fields are fetched once and reused; callers can trigger an explicit refresh.
const fields = ref<CustomMetadataFieldSummary[]>([])
const loading = ref(false)
const initialized = ref(false)
let fetchPromise: Promise<void> | null = null

async function doFetch(): Promise<void> {
  loading.value = true
  try {
    const res = await api('/api/v1/custom-metadata/fields/active')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    fields.value = (await res.json()) as CustomMetadataFieldSummary[]
    initialized.value = true
  } catch {
    fields.value = []
  } finally {
    loading.value = false
  }
}

function ensureLoaded(): void {
  if (initialized.value || loading.value) return
  fetchPromise = doFetch()
}

function refresh(): Promise<void> {
  fetchPromise = doFetch()
  return fetchPromise
}

export function useActiveCustomFields() {
  ensureLoaded()
  return { fields, loading, initialized, refresh }
}

/** Label lookup for already-loaded fields. Reactive, and never triggers a fetch of its own. */
export function activeCustomFieldLabel(fieldId: number): string | null {
  return fields.value.find((f) => f.id === fieldId)?.label ?? null
}

// For testing: resets the singleton state so tests are isolated.
export function _resetActiveCustomFieldsState(): void {
  fields.value = []
  loading.value = false
  initialized.value = false
  fetchPromise = null
}
