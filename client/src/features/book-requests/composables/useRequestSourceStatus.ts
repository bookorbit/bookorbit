import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import type { BookRequestSourceStatus } from '@bookorbit/types'

const ENDPOINT = '/api/v1/book-requests/source-status'

/**
 * Whether this instance can search for a release at all.
 *
 * Its own endpoint rather than a field on the request summary: that one is cached against the
 * request change version, and switching an indexer off changes nothing about any request, so the
 * banner would keep saying the old thing until somebody happened to file one.
 *
 * A failed load stays silent. This drives a warning, and a warning nobody can act on because the
 * fetch failed is worse than no warning: the release picker still states the same fact from the
 * search result it already has.
 */
export function useRequestSourceStatus() {
  const status = ref<BookRequestSourceStatus | null>(null)

  /** No source is switched on, so nothing will be searched no matter what is requested. */
  const noSourcesEnabled = computed(() => status.value !== null && status.value.enabled === 0)
  /** Of those, the ones that are one toggle away from working rather than one setup away. */
  const noSourcesConfigured = computed(() => noSourcesEnabled.value && status.value?.configured === 0)

  async function fetchSourceStatus(): Promise<void> {
    try {
      const res = await api(ENDPOINT)
      if (!res.ok) return
      status.value = toStatus(await res.json())
    } catch {
      // Deliberately silent; see above.
    }
  }

  return { status, noSourcesEnabled, noSourcesConfigured, fetchSourceStatus }
}

/**
 * Only a body carrying both counts becomes a status. Anything else stays null, which reads as "not
 * answered yet" everywhere this is used, so a shape nobody expected shows no banner rather than
 * accusing a working instance of having no sources.
 */
function toStatus(body: unknown): BookRequestSourceStatus | null {
  const value = body as Partial<BookRequestSourceStatus> | null
  if (typeof value?.configured !== 'number' || typeof value.enabled !== 'number') return null
  return { configured: value.configured, enabled: value.enabled }
}
