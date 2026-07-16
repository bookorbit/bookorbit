import { computed, shallowRef, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import {
  jumpBucketKindForSort,
  type JumpBucket,
  type JumpBucketsQuery,
  type JumpBucketsResponse,
  type TemporalJumpBucketGranularity,
} from '@bookorbit/types'
import type { BookWindowQuery } from './useBookWindow'

const MAX_CACHE_ENTRIES = 50

/**
 * Fetches the jump buckets for the current query and derives the active
 * bucket purely from the first visible row index. Clicks never write the
 * active bucket; they only scroll, and the active bucket follows from scroll
 * position. That single-source-of-truth rule is what keeps the rail free of
 * scroll-sync suppression logic.
 */
export function useJumpBuckets(options: {
  endpoint: Ref<string | null>
  query: Ref<BookWindowQuery>
  enabled: Ref<boolean>
  firstVisibleIndex: Ref<number>
  maxBuckets: Ref<number>
}) {
  const buckets = shallowRef<JumpBucket[]>([])
  const granularity = shallowRef<TemporalJumpBucketGranularity | null>(null)
  const loading = shallowRef(false)
  const cache = new Map<string, Pick<JumpBucketsResponse, 'buckets' | 'granularity'>>()
  let generation = 0

  const kind = computed(() => jumpBucketKindForSort(options.query.value.sort))
  const cacheKey = computed(() => `${options.endpoint.value ?? ''}|${options.maxBuckets.value}|${JSON.stringify(options.query.value)}`)

  async function fetchBuckets() {
    const gen = ++generation
    const endpoint = options.endpoint.value
    if (!endpoint || !options.enabled.value || !kind.value) {
      buckets.value = []
      granularity.value = null
      loading.value = false
      return
    }

    const key = cacheKey.value
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      buckets.value = cached.buckets
      granularity.value = cached.granularity
      loading.value = false
      return
    }

    loading.value = true
    try {
      const body: JumpBucketsQuery = {
        ...options.query.value,
        pagination: { page: 0, size: 50 },
        maxBuckets: options.maxBuckets.value,
      }
      const res = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (gen !== generation) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: JumpBucketsResponse = await res.json()
      if (gen !== generation) return
      cache.set(key, { buckets: data.buckets, granularity: data.granularity })
      if (cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value
        if (oldestKey !== undefined) cache.delete(oldestKey)
      }
      buckets.value = data.buckets
      granularity.value = data.granularity
    } catch {
      if (gen === generation) {
        buckets.value = []
        granularity.value = null
      }
    } finally {
      if (gen === generation) loading.value = false
    }
  }

  function refresh() {
    cache.delete(cacheKey.value)
    void fetchBuckets()
  }

  const activeBucket = computed<JumpBucket | null>(() => {
    const list = buckets.value
    if (list.length === 0) return null
    let active: JumpBucket | null = null
    for (const bucket of list) {
      if (bucket.index > options.firstVisibleIndex.value) break
      active = bucket
    }
    return active ?? list[0] ?? null
  })

  watch([cacheKey, options.enabled], fetchBuckets, { immediate: true })

  return { buckets, kind, granularity, loading, activeBucket, refresh }
}
