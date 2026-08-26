import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { canonicalizeBookRequestIsbn, MAX_BOOK_REQUEST_SEARCH_ISBNS, normalizeBookRequestIsbn } from '@bookorbit/types'
import type { BookRequestItem, ReleaseSearchCriteria, ReleaseSearchOverrides } from '@bookorbit/types'

import { searchAttemptKey, TITLE_AUTHOR_SEARCH_KEY } from './useReleasePicker'

/** What the server will accept, checked here so a typo comes back as a field error, not a 400. */
const MAX_SEARCH_AUTHORS = 50
const MAX_SEARCH_AUTHOR_LENGTH = 255
const MAX_SEARCH_FORMATS = 20
const MAX_SEARCH_FORMAT_LENGTH = 20

export interface ReleaseSearchEditorOptions {
  request: Ref<BookRequestItem | null>
  criteria: Ref<ReleaseSearchCriteria | null>
  /** How many releases each key this visit has already spent came back with. */
  attempts: Ref<Map<string, number>>
  requestId: Ref<number>
  fetchReleases: (id: number, options?: { overrides?: ReleaseSearchOverrides }) => Promise<boolean>
  /** Run before every search this editor starts, for the row state a new list invalidates. */
  beforeSearch: () => void
}

/**
 * The key a release search runs under, and the form for changing it.
 *
 * Two things rather than one: the ISBN chips re-run the same criteria under a different key, while
 * the form edits the criteria themselves. Both end in `fetchReleases`, and both have to say what a
 * key already returned, so the panel does not offer the approver a key it has already spent.
 */
export function useReleaseSearchEditor(options: ReleaseSearchEditorOptions) {
  const { t } = useI18n()
  const { request, criteria, attempts, requestId, fetchReleases, beforeSearch } = options

  const searchEditing = ref(false)
  const originalCriteria = ref<ReleaseSearchCriteria | null>(null)
  const searchTitle = ref('')
  const searchAuthors = ref('')
  const searchIsbnOptions = ref<string[]>([])
  const selectedSearchIsbn = ref<string | null>(null)
  const customSearchIsbn = ref('')
  const searchLanguage = ref('')
  const searchFormats = ref('')
  const searchEditError = ref<string | null>(null)

  const alternativeIsbns = computed(() => criteria.value?.isbns.filter((isbn) => isbn !== criteria.value?.activeIsbn) ?? [])
  const titleAuthorAttempt = computed(() => attemptLabel(attempts.value.get(TITLE_AUTHOR_SEARCH_KEY)))
  /** The one key this search ran under, which is what the panel states above the source list. */
  const activeKeyText = computed(() => (criteria.value ? (criteria.value.activeIsbn ?? titleAuthorKey(criteria.value)) : ''))

  watch(request, (value) => {
    if (value && originalCriteria.value === null) originalCriteria.value = requestSearchCriteria(value)
  })

  /** Not any one indexer's string: the key itself, which is what the approver chose to search. */
  function titleAuthorKey(value: ReleaseSearchCriteria): string {
    return [value.title, value.authors[0]].filter(Boolean).join(', ')
  }

  function requestSearchCriteria(value: BookRequestItem): ReleaseSearchCriteria {
    const isbns = [
      canonicalizeBookRequestIsbn(value.isbn10, value.isbn13),
      ...value.metadataSources.map((source) => canonicalizeBookRequestIsbn(source.isbn10, source.isbn13)),
    ].filter((isbn): isbn is string => isbn !== null)
    return {
      title: value.title,
      authors: [...value.authors],
      isbn10: value.isbn10,
      isbn13: value.isbn13,
      activeIsbn: isbns[0] ?? null,
      isbns: [...new Set(isbns)].slice(0, MAX_BOOK_REQUEST_SEARCH_ISBNS),
      mediaKind: value.mediaKind,
      language: value.language,
      preferredFormats: [...value.preferredFormats],
    }
  }

  function criteriaOverrides(value: ReleaseSearchCriteria): ReleaseSearchOverrides {
    return {
      title: value.title,
      authors: [...value.authors],
      isbn: value.activeIsbn,
      language: value.language,
      preferredFormats: [...value.preferredFormats],
    }
  }

  function loadSearchEditor(value: ReleaseSearchCriteria): void {
    searchTitle.value = value.title
    searchAuthors.value = value.authors.join('\n')
    searchIsbnOptions.value = [...value.isbns]
    selectedSearchIsbn.value = value.activeIsbn
    customSearchIsbn.value = ''
    searchLanguage.value = value.language ?? ''
    searchFormats.value = value.preferredFormats.join(', ')
    searchEditError.value = null
  }

  function toggleSearchEditor(): void {
    searchEditing.value = !searchEditing.value
    if (searchEditing.value && criteria.value) loadSearchEditor(criteria.value)
  }

  function resetSearchEditor(): void {
    if (originalCriteria.value) loadSearchEditor(originalCriteria.value)
  }

  function selectSearchIsbn(isbn: string): void {
    selectedSearchIsbn.value = isbn
  }

  function selectTitleAuthorSearch(): void {
    selectedSearchIsbn.value = null
  }

  function canonicalizeTypedIsbn(value: string): string | null {
    const normalized = normalizeBookRequestIsbn(value)
    if (normalized?.length === 10) return canonicalizeBookRequestIsbn(normalized, null)
    return canonicalizeBookRequestIsbn(null, normalized)
  }

  function consumeCustomSearchIsbn(): boolean {
    const raw = customSearchIsbn.value.trim()
    if (!raw) return true
    const canonical = canonicalizeTypedIsbn(raw)
    if (!canonical) {
      searchEditError.value = t('bookRequests.releases.criteria.invalidIsbn', { isbn: raw })
      return false
    }
    if (!searchIsbnOptions.value.includes(canonical)) searchIsbnOptions.value = [...searchIsbnOptions.value, canonical]
    selectedSearchIsbn.value = canonical
    customSearchIsbn.value = ''
    searchEditError.value = null
    return true
  }

  function addCustomSearchIsbn(): void {
    consumeCustomSearchIsbn()
  }

  async function handleCustomSearchSubmit(event: Event): Promise<void> {
    event.preventDefault()
    const title = searchTitle.value.trim()
    if (!title) {
      searchEditError.value = t('bookRequests.releases.criteria.titleRequired')
      return
    }
    if (!consumeCustomSearchIsbn()) return

    const authors = searchAuthors.value
      .split('\n')
      .map((author) => author.trim())
      .filter(Boolean)
    const preferredFormats = searchFormats.value
      .split(/[\n,]/)
      .map((format) => format.trim())
      .filter(Boolean)
    if (authors.length > MAX_SEARCH_AUTHORS || authors.some((author) => author.length > MAX_SEARCH_AUTHOR_LENGTH)) {
      searchEditError.value = t('bookRequests.releases.criteria.authorsInvalid')
      return
    }
    if (preferredFormats.length > MAX_SEARCH_FORMATS || preferredFormats.some((format) => format.length > MAX_SEARCH_FORMAT_LENGTH)) {
      searchEditError.value = t('bookRequests.releases.criteria.formatsInvalid')
      return
    }

    const overrides: ReleaseSearchOverrides = {
      title,
      authors,
      isbn: selectedSearchIsbn.value,
      language: searchLanguage.value.trim() || null,
      preferredFormats,
    }

    beforeSearch()
    if (await fetchReleases(requestId.value, { overrides })) searchEditing.value = false
  }

  /**
   * What this visit already learned about a key. Every alternate ISBN on a request tends to carry
   * the same provider label - four "Google Books" chips separate nothing - so once a key has been
   * spent, what it returned is the only thing that tells the approver which one to try next.
   */
  function attemptLabel(count: number | undefined): string | null {
    if (count === undefined) return null
    return count === 0 ? t('bookRequests.releases.criteria.keyTried') : t('bookRequests.releases.criteria.keyTriedCount', { count })
  }

  function isbnKeyLabel(isbn: string): string {
    return attemptLabel(attempts.value.get(searchAttemptKey(isbn))) ?? isbnSourceText(isbn)
  }

  function isbnSourceText(isbn: string): string {
    const labels = request.value?.metadataSources
      .filter((source) => canonicalizeBookRequestIsbn(source.isbn10, source.isbn13) === isbn)
      .map((source) => source.providerLabel)
      .filter((label, index, values) => values.indexOf(label) === index)
    return labels?.length ? labels.join(', ') : t('bookRequests.releases.criteria.customIsbnSource')
  }

  async function runAlternativeIsbnSearch(isbn: string): Promise<void> {
    if (!criteria.value) return
    beforeSearch()
    await fetchReleases(requestId.value, { overrides: { ...criteriaOverrides(criteria.value), isbn } })
  }

  async function runTitleAuthorSearch(): Promise<void> {
    if (!criteria.value) return
    beforeSearch()
    await fetchReleases(requestId.value, { overrides: { ...criteriaOverrides(criteria.value), isbn: null } })
  }

  /** A new request in the same drawer has its own criteria, so nothing here carries over. */
  function resetSearchEditorState(): void {
    originalCriteria.value = null
    searchEditing.value = false
  }

  return {
    searchEditing,
    originalCriteria,
    searchTitle,
    searchAuthors,
    searchIsbnOptions,
    selectedSearchIsbn,
    customSearchIsbn,
    searchLanguage,
    searchFormats,
    searchEditError,
    alternativeIsbns,
    titleAuthorAttempt,
    activeKeyText,
    criteriaOverrides,
    canonicalizeTypedIsbn,
    toggleSearchEditor,
    resetSearchEditor,
    selectSearchIsbn,
    selectTitleAuthorSearch,
    addCustomSearchIsbn,
    handleCustomSearchSubmit,
    isbnKeyLabel,
    isbnSourceText,
    runAlternativeIsbnSearch,
    runTitleAuthorSearch,
    resetSearchEditorState,
  }
}
