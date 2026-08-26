import { computed, onUnmounted, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { METADATA_PROVIDER_STATUS_EVENT } from '@bookorbit/types'
import type {
  ConcreteBookMediaKind,
  MetadataCandidate,
  MetadataProviderInfo,
  MetadataProviderKey,
  MetadataProviderSearchOutcome,
  MetadataProviderSearchStatus,
} from '@bookorbit/types'

export interface SearchParams {
  title?: string
  author?: string
  isbn?: string
  bookId?: number
  isAudiobook?: boolean
  /** Narrows the search to the providers that serve one medium; the server derives isAudiobook from it. */
  mediaKind?: ConcreteBookMediaKind
}

export function useMetadataSearch() {
  const results = ref<MetadataCandidate[]>([])
  const providerCounts = reactive<Partial<Record<MetadataProviderKey, number>>>({})
  // Providers that stopped early. Without this an interrupted search looks like an empty one.
  const providerStatuses = reactive<Partial<Record<MetadataProviderKey, MetadataProviderSearchOutcome>>>({})
  const isStreaming = ref(false)
  const hasSearched = ref(false)
  const providers = ref<MetadataProviderInfo[]>([])
  const selectedProviders = ref<MetadataProviderKey[]>([])

  let abortController: AbortController | null = null

  async function loadProviders(bookId?: number) {
    const query = bookId != null ? `?bookId=${bookId}` : ''
    const res = await api(`/api/v1/metadata-fetch/providers${query}`)
    if (res.ok) {
      providers.value = (await res.json()) as MetadataProviderInfo[]
      selectAllProviders()
    }
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
    for (const k of Object.keys(providerStatuses)) delete providerStatuses[k as MetadataProviderKey]
    hasSearched.value = true
    isStreaming.value = true
    const controller = new AbortController()
    abortController = controller

    const query = new URLSearchParams()
    if (params.title) query.set('title', params.title)
    if (params.author) query.set('author', params.author)
    if (params.isbn) query.set('isbn', params.isbn)
    if (params.bookId != null) query.set('bookId', String(params.bookId))
    if (params.isAudiobook != null) query.set('isAudiobook', String(params.isAudiobook))
    if (params.mediaKind) query.set('mediaKind', params.mediaKind)
    const onlyProvider = providers.value.length === 1 ? providers.value[0] : undefined
    const requestedProviders = selectedProviders.value.length ? selectedProviders.value : onlyProvider ? [onlyProvider.key] : []
    if (requestedProviders.length) query.set('providers', requestedProviders.join(','))

    try {
      const res = await api(`/api/v1/metadata-fetch/stream?${query}`, {
        signal: controller.signal,
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
          const lines = event.split('\n')
          const dataLine = lines.find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          const eventName = lines
            .find((l) => l.startsWith('event:'))
            ?.slice(6)
            .trim()
          try {
            const payload = JSON.parse(dataLine.slice(5).trim())
            if (eventName === METADATA_PROVIDER_STATUS_EVENT) {
              const status = payload as MetadataProviderSearchStatus
              providerStatuses[status.provider] = status.outcome
              continue
            }
            const candidate = payload as MetadataCandidate
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
      if (abortController === controller) {
        isStreaming.value = false
        abortController = null
      }
    }
  }

  const PROVIDER_ORDER: MetadataProviderKey[] = [
    'comicvine',
    'amazon',
    'audible',
    'audnexus',
    'librofm',
    'goodreads',
    'hardcover',
    'google',
    'itunes',
    'kobo',
    'openLibrary',
    'aladin',
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

  const coverProviderOrder = computed(() =>
    providers.value
      .filter((provider) => provider.coverPriority !== undefined)
      .sort((a, b) => a.coverPriority! - b.coverPriority!)
      .map((provider) => provider.key),
  )

  const resultProviderOrder = computed(() => {
    const available = new Set(providers.value.map((provider) => provider.key))
    return [
      ...PROVIDER_ORDER.filter((provider) => available.has(provider)),
      ...providers.value.map((provider) => provider.key).filter((provider) => !PROVIDER_ORDER.includes(provider)),
    ]
  })

  function toggleProvider(key: MetadataProviderKey) {
    const idx = selectedProviders.value.indexOf(key)
    if (idx === -1) selectedProviders.value.push(key)
    else {
      selectedProviders.value.splice(idx, 1)
      if (selectedProviders.value.length === 0) selectAllProviders()
    }
  }

  function selectAllProviders() {
    selectedProviders.value = providers.value.map((provider) => provider.key)
  }

  function selectFieldRuleProviders() {
    const fieldRuleProviders = providers.value.filter((provider) => provider.selectedByFieldRules).map((provider) => provider.key)
    selectedProviders.value = fieldRuleProviders.length ? fieldRuleProviders : providers.value.map((provider) => provider.key)
  }

  function clearProviderFilter() {
    selectAllProviders()
  }

  const interruptedProviders = computed(() =>
    (Object.entries(providerStatuses) as [MetadataProviderKey, MetadataProviderSearchOutcome][])
      .filter(([key]) => !selectedProviders.value.length || selectedProviders.value.includes(key))
      .map(([provider, outcome]) => ({ provider, outcome })),
  )

  return {
    filteredResults,
    coverProviderOrder,
    resultProviderOrder,
    providerCounts,
    providerStatuses,
    interruptedProviders,
    isStreaming,
    hasSearched,
    providers,
    selectedProviders,
    loadProviders,
    search,
    toggleProvider,
    selectAllProviders,
    selectFieldRuleProviders,
    clearProviderFilter,
  }
}
