import { ref } from 'vue'
import {
  BOOK_REQUEST_MEDIA_KINDS,
  DEFAULT_BOOK_REQUEST_PREFERENCES,
  emptyResolvedRequestDestinations,
  NO_REQUEST_DESTINATION,
  NO_RESOLVED_REQUEST_DESTINATION,
  REQUEST_LANGUAGE_CODES,
  toRequestLanguage,
  type BookRequestMediaKind,
  type BookRequestPreferences,
  type RequestDestination,
  type ResolvedRequestDestination,
  type ResolvedRequestDestinations,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { formatLanguageName } from '@/i18n/formatters'

const PREFERENCES_ENDPOINT = '/api/v1/user-preferences/book-requests'
const DEFAULTS_ENDPOINT = '/api/v1/book-requests/default-destinations'

const destinations = ref<ResolvedRequestDestinations>(emptyResolvedRequestDestinations())
const defaultLanguage = ref<string | null>(DEFAULT_BOOK_REQUEST_PREFERENCES.defaultLanguage)
const isSaving = ref(false)

let hasLoadedDefaults = false
let inFlightDefaults: Promise<boolean> | null = null
let hasLoadedPreferences = false
let inFlightPreferences: Promise<boolean> | null = null

interface DestinationLibrary {
  id: number
  folders: { id: number }[]
}

function normalizeId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** A code the matcher does not know is a filter nothing satisfies, so it is dropped rather than kept. */
function normalizeLanguageCode(value: unknown): string | null {
  return typeof value === 'string' ? toRequestLanguage(value) : null
}

function current(): BookRequestPreferences {
  return { defaultLanguage: defaultLanguage.value }
}

/**
 * The server already checked that these still name something; this only settles the shape, so a
 * malformed body reads as "no default" rather than as a destination made of undefined.
 */
function normalizeDestinations(value: Partial<ResolvedRequestDestinations> | undefined): ResolvedRequestDestinations {
  const next = emptyResolvedRequestDestinations()
  for (const mediaKind of BOOK_REQUEST_MEDIA_KINDS) {
    const libraryId = normalizeId(value?.[mediaKind]?.libraryId)
    if (libraryId === null) continue
    const libraryName = value?.[mediaKind]?.libraryName
    next[mediaKind] = {
      libraryId,
      libraryName: typeof libraryName === 'string' ? libraryName : null,
      folderId: normalizeId(value?.[mediaKind]?.folderId),
    }
  }
  return next
}

async function fetchDefaults(): Promise<boolean> {
  try {
    const response = await api(DEFAULTS_ENDPOINT)
    if (!response.ok) return false

    destinations.value = normalizeDestinations((await response.json()) as Partial<ResolvedRequestDestinations>)
    hasLoadedDefaults = true
    return true
  } catch {
    return false
  }
}

async function fetchPreferences(): Promise<boolean> {
  try {
    const response = await api(PREFERENCES_ENDPOINT)
    if (!response.ok) return false

    const body = (await response.json()) as { settings?: Partial<BookRequestPreferences> }
    defaultLanguage.value = normalizeLanguageCode(body.settings?.defaultLanguage)
    hasLoadedPreferences = true
    return true
  } catch {
    return false
  }
}

async function persist(settings: BookRequestPreferences): Promise<boolean> {
  const previous = current()
  defaultLanguage.value = settings.defaultLanguage
  isSaving.value = true

  try {
    const response = await api(PREFERENCES_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings } satisfies { settings: BookRequestPreferences }),
    })
    if (!response.ok) {
      defaultLanguage.value = previous.defaultLanguage
      return false
    }
    hasLoadedPreferences = true
    return true
  } catch {
    defaultLanguage.value = previous.defaultLanguage
    return false
  } finally {
    isSaving.value = false
  }
}

/**
 * Where a request of each medium lands when nobody picks anywhere: the operator's instance
 * default, resolved server-side and read here only so the form can say so.
 *
 * Read-only, and no longer a per-user pin. The pin answered the same question one person at a
 * time, so every requester had to find it, and two mechanisms with an invisible precedence rule
 * between them was worse than one. Keying it on the medium made it worse still: a pin whose state
 * flips when you touch the segmented control beside it is not a control anyone can trust.
 */
export function useRequestDestinationDefault() {
  async function load(): Promise<boolean> {
    if (hasLoadedDefaults) return true
    inFlightDefaults ??= fetchDefaults().finally(() => {
      inFlightDefaults = null
    })
    return inFlightDefaults
  }

  function defaultFor(mediaKind: BookRequestMediaKind): ResolvedRequestDestination {
    return destinations.value[mediaKind] ?? NO_RESOLVED_REQUEST_DESTINATION
  }

  /**
   * Where a destination picker starts: what the request already carries, then the only library
   * there is when there is no choice.
   *
   * The instance default is deliberately not selected here. It can name a library this user
   * cannot browse, so it must not become the value of a select they are expected to read and
   * change; it is shown as the placeholder instead, and applied by the server when nothing was
   * picked.
   */
  function resolveDestination(
    libraries: readonly DestinationLibrary[],
    carried: RequestDestination = NO_REQUEST_DESTINATION,
    allowOnlyLibrary = true,
  ): RequestDestination {
    const onlyLibraryId = allowOnlyLibrary && libraries.length === 1 ? (libraries[0]?.id ?? null) : null
    const libraryId = carried.libraryId ?? onlyLibraryId
    const firstFolderId = libraries.find((library) => library.id === libraryId)?.folders[0]?.id ?? null

    return { libraryId, folderId: carried.folderId ?? firstFolderId }
  }

  return { destinations, load, defaultFor, resolveDestination }
}

/**
 * The language a new request asks for. The only thing this category still stores: destinations
 * moved to the instance default, and a reading language has no instance-level answer.
 */
export function useRequestLanguageDefault() {
  async function load(): Promise<boolean> {
    if (hasLoadedPreferences) return true
    inFlightPreferences ??= fetchPreferences().finally(() => {
      inFlightPreferences = null
    })
    return inFlightPreferences
  }

  function setDefault(language: string | null): Promise<boolean> {
    return persist({ ...current(), defaultLanguage: normalizeLanguageCode(language) })
  }

  /**
   * What a new request should ask for: the pinned language, then whatever fallback the caller
   * offers, which is the reader's own interface language.
   *
   * Deliberately not the language of the edition being requested. Taking that is exactly what
   * turned a request for a book into a request for a translation nobody chose.
   */
  function resolveLanguage(fallback: string | null | undefined): string | null {
    return defaultLanguage.value ?? normalizeLanguageCode(fallback)
  }

  return { defaultLanguage, isSaving, load, setDefault, resolveLanguage }
}

/**
 * The languages a request may ask for, named in the reader's own language and sorted by that name
 * rather than by code, so the list reads in their alphabet instead of English's.
 *
 * Only codes the release matcher can compare, so nothing offered here can silently match nothing.
 */
export function requestLanguageOptions(locale: string): { code: string; name: string }[] {
  return REQUEST_LANGUAGE_CODES.map((code) => ({ code, name: formatLanguageName(code) })).sort((a, b) => a.name.localeCompare(b.name, locale))
}
