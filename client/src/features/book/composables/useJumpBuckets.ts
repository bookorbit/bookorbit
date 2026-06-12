import { computed, shallowRef, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import { jumpBucketKindForSort, type BookQuery, type JumpBucket, type JumpBucketsResponse } from '@bookorbit/types'
import type { BookWindowQuery } from './useBookWindow'

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
}) {
  const buckets = shallowRef<JumpBucket[]>([])
  const loading = shallowRef(false)
  const cache = new Map<string, JumpBucket[]>()
  let generation = 0

  const kind = computed(() => jumpBucketKindForSort(options.query.value.sort))
  const cacheKey = computed(() => `${options.endpoint.value ?? ''}|${JSON.stringify(options.query.value)}`)

  async function fetchBuckets() {
    const gen = ++generation
    const endpoint = options.endpoint.value
    if (!endpoint || !options.enabled.value || !kind.value) {
      buckets.value = []
      loading.value = false
      return
    }

    const key = cacheKey.value
    const cached = cache.get(key)
    if (cached) {
      buckets.value = cached
      loading.value = false
      return
    }

    loading.value = true
    try {
      const body: BookQuery = { ...options.query.value, pagination: { page: 0, size: 50 } }
      const res = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (gen !== generation) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: JumpBucketsResponse = await res.json()
      if (gen !== generation) return
      cache.set(key, data.buckets)
      buckets.value = data.buckets
    } catch {
      if (gen === generation) buckets.value = []
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

  return { buckets, kind, loading, activeBucket, refresh }
}
