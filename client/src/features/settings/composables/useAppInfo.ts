import { ref } from 'vue'

import type { AppInfoResponse, ServerFeature, StoryGuidesAppInfo } from '@bookorbit/types'

import { api } from '@/lib/api'

const version = ref('')
const updateAvailable = ref<boolean | null>(null)
const latestVersion = ref<string | null>(null)
const maxUploadSizeMb = ref(500)
/** What this server advertises; empty until loaded, and on servers older than the list. */
const features = ref<readonly ServerFeature[]>([])
/** Absent on servers without story guides. */
const storyGuides = ref<StoryGuidesAppInfo | null>(null)
const loaded = ref(false)
const isLoading = ref(false)
const error = ref<string | null>(null)

let inflight: Promise<void> | null = null

async function fetchAppInfo(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const res = await api('/api/v1/app-info')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: AppInfoResponse = await res.json()
    version.value = data.version
    updateAvailable.value = data.updateAvailable
    latestVersion.value = data.latestVersion
    maxUploadSizeMb.value = data.maxUploadSizeMb ?? 500
    features.value = Array.isArray(data.features) ? data.features : []
    storyGuides.value = data.storyGuides ?? null
    loaded.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load app info'
  } finally {
    isLoading.value = false
  }
}

export function useAppInfo() {
  /** Callers that arrive while a load is under way share it. */
  function loadAppInfo(): Promise<void> {
    inflight ??= fetchAppInfo().finally(() => {
      inflight = null
    })
    return inflight
  }

  /** Loads once for the session; later callers get the answer already held. */
  function ensureAppInfo(): Promise<void> {
    return loaded.value ? Promise.resolve() : loadAppInfo()
  }

  function supportsFeature(feature: ServerFeature): boolean {
    return features.value.includes(feature)
  }

  return {
    version,
    updateAvailable,
    latestVersion,
    maxUploadSizeMb,
    features,
    storyGuides,
    loaded,
    isLoading,
    error,
    loadAppInfo,
    ensureAppInfo,
    supportsFeature,
  }
}
