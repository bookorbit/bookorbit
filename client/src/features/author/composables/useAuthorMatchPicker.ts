import { computed, ref, shallowRef, type Ref } from 'vue'

import type { AuthorDetail, AuthorMetadataCandidate, MetadataCandidateCacheInfo } from '@bookorbit/types'
import { METADATA_CACHE_REFRESH, summarizeCandidateCache } from '@/features/metadata-cache/lib/metadata-cache'
import { lookupAuthorMetadata, pinAuthorMetadataMatch, streamAuthorMetadataCandidates, unpinAuthorMetadataMatch } from '../api/author'
import { parseAuthorProviderReference, type AuthorProviderReference } from '../lib/author-metadata-match'

export type AuthorMatchEntry = {
  key: string
  candidate: AuthorMetadataCandidate
  cache: MetadataCandidateCacheInfo | null
}

export type AuthorMatchReferenceError = 'unrecognised' | 'notFound' | 'failed'

const SEARCH_LIMIT = 10

export function authorMatchKey(reference: AuthorProviderReference): string {
  return `${reference.provider}:${reference.providerId}`
}

function toEntry(candidate: AuthorMetadataCandidate, cache: MetadataCandidateCacheInfo | null): AuthorMatchEntry {
  return { key: authorMatchKey(candidate), candidate, cache }
}

export function useAuthorMatchPicker(author: Ref<AuthorDetail>) {
  const query = ref(author.value.name)
  const reference = ref('')
  const entries = shallowRef<AuthorMatchEntry[]>([])
  const searching = ref(false)
  const searched = ref(false)
  const searchFailed = ref(false)
  const selectedKey = ref<string | null>(null)
  /** Selected candidates looked up by id, since a name search returns only a shallow record. */
  const details = shallowRef<Record<string, AuthorMatchEntry>>({})
  const loadingDetailKey = ref<string | null>(null)
  const lookingUpReference = ref(false)
  const referenceError = ref<AuthorMatchReferenceError | null>(null)
  const current = shallowRef<AuthorMatchEntry | null>(null)
  const currentLookupComplete = ref(false)

  let searchAbort: AbortController | null = null
  let searchSeq = 0
  let detailSeq = 0

  const currentKey = computed(() => {
    const { metadataProvider, metadataProviderId } = author.value
    return metadataProvider && metadataProviderId ? authorMatchKey({ provider: metadataProvider, providerId: metadataProviderId }) : null
  })

  /** The current match leads the list even when the name search does not return it. */
  const rows = computed(() => {
    const currentEntry = current.value
    if (!currentEntry) return entries.value
    return [currentEntry, ...entries.value.filter((entry) => entry.key !== currentEntry.key)]
  })

  const cacheSummary = computed(() => summarizeCandidateCache(entries.value.map((entry) => entry.cache)))

  const selected = computed<AuthorMatchEntry | null>(() => {
    const key = selectedKey.value
    if (!key) return null
    return details.value[key] ?? rows.value.find((entry) => entry.key === key) ?? null
  })

  function upsertEntry(entry: AuthorMatchEntry) {
    entries.value = [entry, ...entries.value.filter((existing) => existing.key !== entry.key)]
  }

  async function search(options: { fresh?: boolean } = {}) {
    const q = query.value.trim()
    if (!q) return

    const seq = ++searchSeq
    searchAbort?.abort()
    searchAbort = new AbortController()
    searching.value = true
    searched.value = false
    searchFailed.value = false
    entries.value = []

    try {
      await streamAuthorMetadataCandidates(
        { q, region: 'us', limit: SEARCH_LIMIT, ...(options.fresh ? { cache: METADATA_CACHE_REFRESH } : {}) },
        (candidate, cache) => {
          if (seq !== searchSeq) return
          const entry = toEntry(candidate, cache)
          if (entries.value.some((existing) => existing.key === entry.key)) return
          entries.value = [...entries.value, entry]
        },
        searchAbort.signal,
      )
      if (seq === searchSeq) searched.value = true
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      if (seq !== searchSeq) return
      searchFailed.value = true
      searched.value = true
    } finally {
      if (seq === searchSeq) {
        searching.value = false
        searchAbort = null
      }
    }
  }

  function searchFresh() {
    return search({ fresh: true })
  }

  async function loadDetail(entry: AuthorMatchEntry) {
    if (details.value[entry.key]) return
    const seq = ++detailSeq
    loadingDetailKey.value = entry.key
    try {
      const result = await lookupAuthorMetadata(entry.candidate)
      if (!result) return
      // The search row keeps its own cache marker; the lookup's describes only the extra fields.
      details.value = { ...details.value, [entry.key]: toEntry({ ...entry.candidate, ...result.candidate }, entry.cache) }
    } catch {
      // The shallow search record stays on screen; picking it still looks the person up in full.
    } finally {
      if (seq === detailSeq) loadingDetailKey.value = null
    }
  }

  function select(entry: AuthorMatchEntry) {
    selectedKey.value = entry.key
    void loadDetail(entry)
  }

  function clearSelection() {
    selectedKey.value = null
  }

  async function lookUpReference() {
    referenceError.value = null
    const parsed = parseAuthorProviderReference(reference.value)
    if (!parsed) {
      referenceError.value = 'unrecognised'
      return
    }

    lookingUpReference.value = true
    try {
      const result = await lookupAuthorMetadata(parsed)
      if (!result) {
        referenceError.value = 'notFound'
        return
      }
      const entry = toEntry(result.candidate, result.cache)
      upsertEntry(entry)
      details.value = { ...details.value, [entry.key]: entry }
      selectedKey.value = entry.key
      reference.value = ''
    } catch {
      referenceError.value = 'failed'
    } finally {
      lookingUpReference.value = false
    }
  }

  /** Looks up whoever the author is matched to now, so the list can show them as the current match. */
  async function loadCurrent() {
    const { metadataProvider, metadataProviderId } = author.value
    currentLookupComplete.value = false
    current.value = null
    if (!metadataProvider || !metadataProviderId) {
      currentLookupComplete.value = true
      return
    }
    try {
      const result = await lookupAuthorMetadata({ provider: metadataProvider, providerId: metadataProviderId })
      if (!result) return
      const entry = toEntry(result.candidate, result.cache)
      current.value = entry
      details.value = { ...details.value, [entry.key]: entry }
    } catch {
      // Without it the list is just the search results.
    } finally {
      currentLookupComplete.value = true
    }
  }

  function pin(entry: AuthorMatchEntry) {
    return pinAuthorMetadataMatch(author.value.id, { provider: entry.candidate.provider, providerId: entry.candidate.providerId })
  }

  function unpin() {
    return unpinAuthorMetadataMatch(author.value.id)
  }

  function cancel() {
    searchAbort?.abort()
    searchAbort = null
    searchSeq += 1
    detailSeq += 1
    searching.value = false
  }

  return {
    query,
    reference,
    rows,
    cacheSummary,
    searching,
    searched,
    searchFailed,
    selected,
    selectedKey,
    currentKey,
    currentLookupComplete,
    current,
    loadingDetailKey,
    lookingUpReference,
    referenceError,
    search,
    searchFresh,
    select,
    clearSelection,
    lookUpReference,
    loadCurrent,
    pin,
    unpin,
    cancel,
  }
}
