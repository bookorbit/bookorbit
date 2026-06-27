import { ref } from 'vue'
import { api } from '@/lib/api'
import type { KoboSyncSettings } from '@bookorbit/types'

const settings = ref<KoboSyncSettings>({
  readingThreshold: 1,
  finishedThreshold: 99,
  convertToKepub: true,
  forceEnableHyphenation: false,
  kepubConversionLimitMb: 100,
  twoWayProgressSync: false,
  syncBookOrbitAnnotationsToKobo: false,
})
let fetchPromise: Promise<void> | null = null

export function useKoboSettings() {
  async function fetchSettings(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/kobo/settings')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch settings')
        settings.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function updateSettings(patch: Partial<KoboSyncSettings>) {
    const res = await api('/api/v1/kobo/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message ?? 'Failed to update settings')
    }
    settings.value = await res.json()
  }

  return { settings, fetchSettings, updateSettings }
}
