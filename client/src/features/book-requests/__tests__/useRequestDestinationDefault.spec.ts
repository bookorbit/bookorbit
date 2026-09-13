// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

function response(body: unknown, ok = true): Pick<Response, 'json' | 'ok'> {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  }
}

async function freshComposable() {
  vi.resetModules()
  const { useRequestDestinationDefault } = await import('../composables/useRequestDestinationDefault')
  return useRequestDestinationDefault()
}

/** The two halves read different endpoints now, so a test that touches both needs both handles. */
async function freshBoth() {
  vi.resetModules()
  const module = await import('../composables/useRequestDestinationDefault')
  return {
    destination: module.useRequestDestinationDefault(),
    language: module.useRequestLanguageDefault(),
    requestLanguageOptions: module.requestLanguageOptions,
  }
}

const LIBRARIES = [
  { id: 4, folders: [{ id: 8 }, { id: 9 }] },
  { id: 5, folders: [{ id: 10 }] },
]

const NO_DEFAULTS = {
  ebook: { libraryId: null, libraryName: null, folderId: null },
  audiobook: { libraryId: null, libraryName: null, folderId: null },
  comic: { libraryId: null, libraryName: null, folderId: null },
}

describe('useRequestDestinationDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the instance default for each medium', async () => {
    apiMock.mockResolvedValueOnce(
      response({
        ...NO_DEFAULTS,
        ebook: { libraryId: 4, libraryName: 'Novels', folderId: 9 },
        audiobook: { libraryId: 5, libraryName: 'Audiobooks', folderId: 10 },
      }),
    )
    const preferences = await freshComposable()

    await expect(preferences.load()).resolves.toBe(true)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-requests/default-destinations')
    expect(preferences.defaultFor('ebook')).toEqual({ libraryId: 4, libraryName: 'Novels', folderId: 9 })
    expect(preferences.defaultFor('audiobook')).toEqual({ libraryId: 5, libraryName: 'Audiobooks', folderId: 10 })
    expect(preferences.defaultFor('comic')).toEqual({ libraryId: null, libraryName: null, folderId: null })
  })

  it('reads a malformed body as no default rather than a half-made destination', async () => {
    apiMock.mockResolvedValueOnce(response({ ebook: { libraryId: 'four', libraryName: 7 } }))
    const preferences = await freshComposable()

    await preferences.load()

    expect(preferences.defaultFor('ebook')).toEqual({ libraryId: null, libraryName: null, folderId: null })
  })

  it('fetches once and serves later loads from cache', async () => {
    apiMock.mockResolvedValueOnce(response(NO_DEFAULTS))
    const preferences = await freshComposable()

    await preferences.load()
    await expect(preferences.load()).resolves.toBe(true)

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  /**
   * The instance default can name a library this user cannot browse, so it must never become the
   * value of a select they are expected to read and change. The form shows it as the placeholder
   * and the server applies it; putting it in here would show a destination they cannot verify.
   */
  it('never preselects the instance default', async () => {
    apiMock.mockResolvedValueOnce(response({ ...NO_DEFAULTS, ebook: { libraryId: 99, libraryName: 'Staff only', folderId: 1 } }))
    const preferences = await freshComposable()
    await preferences.load()

    expect(preferences.resolveDestination(LIBRARIES)).toEqual({ libraryId: null, folderId: null })
  })

  it('keeps a destination the request already carries', async () => {
    apiMock.mockResolvedValueOnce(response(NO_DEFAULTS))
    const preferences = await freshComposable()
    await preferences.load()

    expect(preferences.resolveDestination(LIBRARIES, { libraryId: 5, folderId: 10 })).toEqual({ libraryId: 5, folderId: 10 })
  })

  it('falls back to the first folder when the request names only a library', async () => {
    apiMock.mockResolvedValueOnce(response(NO_DEFAULTS))
    const preferences = await freshComposable()
    await preferences.load()

    expect(preferences.resolveDestination(LIBRARIES, { libraryId: 5, folderId: null })).toEqual({ libraryId: 5, folderId: 10 })
  })

  it('preselects the only library there is, unless the caller says not to', async () => {
    apiMock.mockResolvedValueOnce(response(NO_DEFAULTS))
    const preferences = await freshComposable()
    await preferences.load()

    expect(preferences.resolveDestination([LIBRARIES[1]!])).toEqual({ libraryId: 5, folderId: 10 })
    expect(preferences.resolveDestination([LIBRARIES[1]!], undefined, false)).toEqual({ libraryId: null, folderId: null })
  })
})

describe('useRequestLanguageDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the pinned language', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: { defaultLanguage: 'de' } }))
    const { language } = await freshBoth()

    await language.load()

    expect(language.defaultLanguage.value).toBe('de')
  })

  /** A row stored before this field existed must not read as a corrupt preference. */
  it('treats a preference saved without a language as no language', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: {} }))
    const { language } = await freshBoth()

    await language.load()

    expect(language.defaultLanguage.value).toBeNull()
  })

  /**
   * Rows written while destinations lived here still exist. The server drops those fields, but a
   * response that still carried them must not make the language unreadable either.
   */
  it('ignores destination fields left over in a stored row', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: { defaultLibraryId: 4, defaultFolderId: 9, defaultLanguage: 'de' } }))
    const { language } = await freshBoth()

    await language.load()

    expect(language.defaultLanguage.value).toBe('de')
  })

  it('prefers the pinned language over the interface language', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: { defaultLanguage: 'it' } }))
    const { language } = await freshBoth()
    await language.load()

    expect(language.resolveLanguage('en')).toBe('it')
  })

  it('falls back to the interface language, subtag and all', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: { defaultLanguage: null } }))
    const { language } = await freshBoth()
    await language.load()

    expect(language.resolveLanguage('en-US')).toBe('en')
    expect(language.resolveLanguage('pt-BR')).toBe('pt')
    expect(language.resolveLanguage(null)).toBeNull()
  })

  /**
   * Mirrors the matcher rather than inventing a narrower rule of its own. Being stricter here is how
   * a language the matcher handles perfectly well would be dropped from the request instead.
   */
  it('resolves anything that yields a subtag, and nothing that does not', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: { defaultLanguage: null } }))
    const { language } = await freshBoth()
    await language.load()

    expect(language.resolveLanguage('spa')).toBe('es')
    expect(language.resolveLanguage('ne')).toBe('ne')
    expect(language.resolveLanguage('!!')).toBeNull()
    expect(language.resolveLanguage('')).toBeNull()
  })

  it('saves the pinned language on its own', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: { defaultLanguage: null } }))
    const { language } = await freshBoth()
    await language.load()

    apiMock.mockResolvedValueOnce(response({}, true))
    await language.setDefault('fr')

    const [url, init] = apiMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/v1/user-preferences/book-requests')
    expect(JSON.parse(String(init.body))).toEqual({ settings: { defaultLanguage: 'fr' } })
    expect(language.defaultLanguage.value).toBe('fr')
  })

  it('keeps the pinned language when saving fails', async () => {
    apiMock.mockResolvedValueOnce(response({ settings: { defaultLanguage: 'fr' } }))
    const { language } = await freshBoth()
    await language.load()

    apiMock.mockResolvedValueOnce(response({}, false))
    await expect(language.setDefault('de')).resolves.toBe(false)

    expect(language.defaultLanguage.value).toBe('fr')
  })

  it('offers only languages a release can be matched against, named and sorted for the reader', async () => {
    const { requestLanguageOptions } = await freshBoth()
    const options = requestLanguageOptions('en')

    const names = options.map((option) => option.name)

    expect(options.some((option) => option.code === 'es')).toBe(true)
    expect(names.every((name) => name.length > 0)).toBe(true)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })
})
