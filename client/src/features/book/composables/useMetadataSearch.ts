import { computed, onUnmounted, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import type { MetadataCandidate, MetadataProviderInfo, MetadataProviderKey } from '@projectx/types'

export interface SearchParams {
  title?: string
  author?: string
  isbn?: string
  bookId?: number
  isAudiobook?: boolean
}

export function useMetadataSearch() {
  const results = ref<MetadataCandidate[]>([])
  const providerCounts = reactive<Partial<Record<MetadataProviderKey, number>>>({})
  const isStreaming = ref(false)
  const hasSearched = ref(false)
  const providers = ref<MetadataProviderInfo[]>([])
  const selectedProviders = ref<MetadataProviderKey[]>([])

  let abortController: AbortController | null = null

  async function loadProviders() {
    const res = await api('/api/v1/metadata-fetch/providers')
    if (res.ok) providers.value = (await res.json()) as MetadataProviderInfo[]
  }

  function cancel() {
    abortController?.abort()
    abortController = null
    isStreaming.value = false
  }

  onUnmounted(cancel)

  async function search(params: SearchParams) {
    cancel()
    results.value = []
    for (const k of Object.keys(providerCounts)) delete providerCounts[k as MetadataProviderKey]
    hasSearched.value = true
    isStreaming.value = true
    abortController = new AbortController()

    const query = new URLSearchParams()
    if (params.title) query.set('title', params.title)
    if (params.author) query.set('author', params.author)
    if (params.isbn) query.set('isbn', params.isbn)
    if (params.bookId != null) query.set('bookId', String(params.bookId))
    if (params.isAudiobook != null) query.set('isAudiobook', String(params.isAudiobook))
    if (selectedProviders.value.length) query.set('providers', selectedProviders.value.join(','))

    try {
      const res = await api(`/api/v1/metadata-fetch/stream?${query}`, {
        signal: abortController.signal,
      })
      if (!res.ok || !res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          const line = event.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          try {
            const candidate = JSON.parse(line.slice(5).trim()) as MetadataCandidate
            results.value.push(candidate)
            providerCounts[candidate.provider] = (providerCounts[candidate.provider] ?? 0) + 1
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
    } finally {
      isStreaming.value = false
      abortController = null
    }
  }

  const PROVIDER_ORDER: MetadataProviderKey[] = [
    'comicvine',
    'amazon',
    'audible',
    'audnexus',
    'goodreads',
    'hardcover',
    'google',
    'itunes',
    'openLibrary',
  ]

  function sortResults(list: MetadataCandidate[]): MetadataCandidate[] {
    const byProvider = new Map<string, MetadataCandidate[]>()
    for (const r of list) {
      const bucket = byProvider.get(r.provider) ?? []
      bucket.push(r)
      byProvider.set(r.provider, bucket)
    }

    const orderedKeys = [
      ...PROVIDER_ORDER.filter((p) => byProvider.has(p)),
      ...[...byProvider.keys()].filter((p) => !PROVIDER_ORDER.includes(p as MetadataProviderKey)),
    ]

    const out: MetadataCandidate[] = []
    for (const p of orderedKeys) out.push(...(byProvider.get(p)?.slice(0, 2) ?? []))
    for (const p of orderedKeys) out.push(...(byProvider.get(p)?.slice(2) ?? []))
    return out
  }

  const filteredResults = computed(() => {
    const filtered = selectedProviders.value.length ? results.value.filter((r) => selectedProviders.value.includes(r.provider)) : results.value
    return sortResults(filtered)
  })

  function toggleProvider(key: MetadataProviderKey) {
    const idx = selectedProviders.value.indexOf(key)
    if (idx === -1) selectedProviders.value.push(key)
    else selectedProviders.value.splice(idx, 1)
  }

  function clearProviderFilter() {
    selectedProviders.value = []
  }

  return {
    filteredResults,
    providerCounts,
    isStreaming,
    hasSearched,
    providers,
    selectedProviders,
    loadProviders,
    search,
    toggleProvider,
    clearProviderFilter,
  }
}
