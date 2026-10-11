import { ref } from 'vue'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type { BookRequestSeedStatus } from '@bookorbit/types'

/**
 * Read live from the download client when someone looks, rather than stored. A seed outlives its
 * import by weeks, so polling every finished download to keep a ratio fresh would be an
 * ever-growing number of client calls for a number nobody is reading.
 */
/**
 * The last answer per request, so stepping back to one - the other half of a pair, most often - shows
 * what it said a moment ago while the client is asked again, instead of a loading line. Bounded,
 * because a long session steps through far more requests than it ever returns to.
 */
const seedCache = new Map<string, BookRequestSeedStatus | null>()
const SEED_CACHE_LIMIT = 50

function remember(key: string, value: BookRequestSeedStatus | null): void {
  seedCache.delete(key)
  seedCache.set(key, value)
  if (seedCache.size > SEED_CACHE_LIMIT) seedCache.delete(seedCache.keys().next().value!)
}

async function readSeedStatus(path: string): Promise<BookRequestSeedStatus | null | undefined> {
  const res = await api(path)
  if (!res.ok) return undefined
  const body = (await res.text()).trim()
  return body ? (JSON.parse(body) as BookRequestSeedStatus) : null
}

/** Reads one request's seed ahead of time, so opening it shows the answer straight away. */
export async function prefetchSeedStatus(canManage: boolean, requestId: number): Promise<void> {
  const path = `${fulfilmentBase(canManage)}/${requestId}/seed`
  try {
    const value = await readSeedStatus(path)
    if (value !== undefined) remember(path, value)
  } catch {
    // The panel asks again when it opens; a failed warm-up costs nothing.
  }
}

export function useRequestSeedStatus(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  const status = ref<BookRequestSeedStatus | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  /** Bumped per fetch, so stepping to the next request cannot be answered with the last one's. */
  let generation = 0

  async function fetchStatus(requestId: number): Promise<void> {
    const current = ++generation
    const path = `${basePath()}/${requestId}/seed`
    const cached = seedCache.get(path)
    failed.value = false
    // A known answer stays on screen while it is refreshed; only a first read shows as loading.
    loading.value = cached === undefined
    status.value = cached ?? null
    try {
      const value = await readSeedStatus(path)
      if (current !== generation) return
      if (value === undefined) {
        failed.value = true
        return
      }
      remember(path, value)
      status.value = value
    } catch {
      if (current === generation) failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reset(): void {
    generation++
    status.value = null
    failed.value = false
    loading.value = false
  }

  return { status, loading, failed, fetchStatus, reset }
}
