import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { CBX_READER_DEFAULTS, READER_GROUP_DEFAULTS, type PdfReaderSettings } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

const toastMock = vi.hoisted(() => ({ success: vi.fn<(...args: unknown[]) => unknown>() }))
vi.mock('vue-sonner', () => ({ toast: toastMock }))

const useAuthMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>(() => ({ user: ref(null) })))
vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: useAuthMock }))

import { useReaderSettings, useReaderDefaultSettings } from './useReaderSettings'

const BOOK_FILE_ID = 42

function makeFakeResponse(ok: boolean, data: unknown) {
  return Promise.resolve({ ok, json: () => Promise.resolve(data) })
}

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  useAuthMock.mockReturnValue({ user: ref(null) })
  apiMock.mockResolvedValue({ ok: false, json: async () => ({}) })
})

describe('useReaderSettings - load() with no localStorage', () => {
  it('initializes bookDelta to null and isCustomized to false', async () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    await s.load()

    expect(s.bookDelta.value).toBeNull()
    expect(s.isCustomized.value).toBe(false)
  })

  it('effective equals READER_GROUP_DEFAULTS for epub', async () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    await s.load()

    expect(s.effective.value).toEqual(READER_GROUP_DEFAULTS.epub)
  })

  it('effective equals READER_GROUP_DEFAULTS for cbz', async () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'cbz')
    await s.load()

    expect(s.effective.value).toEqual(READER_GROUP_DEFAULTS.cbx)
  })
})

describe('useReaderSettings - load() with valid localStorage epub delta', () => {
  it('sets bookDelta from localStorage and marks isCustomized', async () => {
    const delta = { fontSize: 20, isDark: true }
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify(delta))

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    await s.load()

    expect(s.bookDelta.value).toEqual(delta)
    expect(s.isCustomized.value).toBe(true)
  })

  it('effective reflects merged settings', async () => {
    const delta = { fontSize: 24 }
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify(delta))

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    await s.load()

    expect(s.effective.value).toMatchObject({ ...READER_GROUP_DEFAULTS.epub, fontSize: 24 })
  })

  it('filters invalid EPUB spread settings from localStorage deltas', async () => {
    const raw = { fontSize: 20, fixedLayoutSpread: 'two-page' }
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify(raw))

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    await s.load()

    expect(s.bookDelta.value).toEqual({ fontSize: 20 })
    expect(localStorage.getItem(`reader:book:${BOOK_FILE_ID}`)).toBe(JSON.stringify({ fontSize: 20 }))
  })
})

describe('useReaderSettings - load() with invalid localStorage value', () => {
  it('removes localStorage key and leaves bookDelta null when value is not an object', async () => {
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify('not-an-object'))

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    await s.load()

    expect(s.bookDelta.value).toBeNull()
    expect(s.isCustomized.value).toBe(false)
    expect(localStorage.getItem(`reader:book:${BOOK_FILE_ID}`)).toBeNull()
  })

  it('removes localStorage key and leaves bookDelta null when cbx value has no valid fields', async () => {
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify({ fitMode: 'stretch' }))

    const s = useReaderSettings(BOOK_FILE_ID, 'cbz')
    await s.load()

    expect(s.bookDelta.value).toBeNull()
    expect(s.isCustomized.value).toBe(false)
    expect(localStorage.getItem(`reader:book:${BOOK_FILE_ID}`)).toBeNull()
  })
})

describe('useReaderSettings - PDF validation', () => {
  it('keeps valid PDF settings and removes values that can break reader layout', async () => {
    localStorage.setItem(
      `reader:book:${BOOK_FILE_ID}`,
      JSON.stringify({
        scrollMode: 'horizontal',
        spread: 'odd',
        zoomMode: 'custom',
        customScale: 40,
        rotation: 45,
      }),
    )

    const settings = useReaderSettings(BOOK_FILE_ID, 'pdf')
    await settings.load()

    expect(settings.bookDelta.value).toEqual({
      scrollMode: 'horizontal',
      spread: 'odd',
      zoomMode: 'custom',
    })
    const effective = settings.effective.value as PdfReaderSettings
    expect(effective.customScale).toBe(1)
    expect(effective.rotation).toBe(0)
  })

  it('migrates wrapped mode and retains new read-only layout choices', async () => {
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify({ scrollMode: 'wrapped', spread: 'auto', zoomMode: 'automatic' }))

    const settings = useReaderSettings(BOOK_FILE_ID, 'pdf')
    await settings.load()

    expect(settings.bookDelta.value).toEqual({ scrollMode: 'vertical', spread: 'auto', zoomMode: 'automatic' })
    expect(JSON.parse(localStorage.getItem(`reader:book:${BOOK_FILE_ID}`) ?? '{}')).toEqual({
      scrollMode: 'vertical',
      spread: 'auto',
      zoomMode: 'automatic',
    })
  })
})

describe('useReaderSettings - load() with valid cbx localStorage delta', () => {
  it('filters out invalid fitMode and keeps valid fields', async () => {
    const raw = { fitMode: 'stretch', viewMode: 'single' }
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify(raw))

    const s = useReaderSettings(BOOK_FILE_ID, 'cbz')
    await s.load()

    expect(s.bookDelta.value).not.toHaveProperty('fitMode')
    expect(s.bookDelta.value).toMatchObject({ viewMode: 'single' })
  })

  it('includes valid fitMode fit-page in bookDelta', async () => {
    const raw = { fitMode: 'fit-page', viewMode: 'two-page' }
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify(raw))

    const s = useReaderSettings(BOOK_FILE_ID, 'cbz')
    await s.load()

    expect(s.bookDelta.value).toMatchObject({ fitMode: 'fit-page', viewMode: 'two-page' })
    expect(s.isCustomized.value).toBe(true)
  })
})

describe('useReaderSettings - updateBookSettings', () => {
  it('merges patch into bookDelta and writes to localStorage', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 22 } as never)

    expect(s.bookDelta.value).toMatchObject({ fontSize: 22 })
    const stored = JSON.parse(localStorage.getItem(`reader:book:${BOOK_FILE_ID}`) ?? 'null')
    expect(stored).toMatchObject({ fontSize: 22 })
  })

  it('merges subsequent patches additively', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 22 } as never)
    s.updateBookSettings({ isDark: true } as never)

    expect(s.bookDelta.value).toMatchObject({ fontSize: 22, isDark: true })
  })

  it('does not call api() when sync is disabled', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 22 } as never)

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('calls api() with PUT when sync is enabled', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
    apiMock.mockResolvedValue({ ok: true })

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 22 } as never)

    expect(apiMock).toHaveBeenCalledWith(`/api/v1/reader/preferences/${BOOK_FILE_ID}`, expect.objectContaining({ method: 'PUT' }))
  })
})

describe('useReaderSettings - resetBookSettings', () => {
  it('clears bookDelta, sets isCustomized false, removes from localStorage', () => {
    localStorage.setItem(`reader:book:${BOOK_FILE_ID}`, JSON.stringify({ fontSize: 20 }))

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 20 } as never)
    s.resetBookSettings()

    expect(s.bookDelta.value).toBeNull()
    expect(s.isCustomized.value).toBe(false)
    expect(localStorage.getItem(`reader:book:${BOOK_FILE_ID}`)).toBeNull()
  })

  it('does not call api() when sync is disabled', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.resetBookSettings()

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('calls api() with DELETE when sync is enabled', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
    apiMock.mockResolvedValue({ ok: true })

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.resetBookSettings()

    expect(apiMock).toHaveBeenCalledWith(`/api/v1/reader/preferences/${BOOK_FILE_ID}`, expect.objectContaining({ method: 'DELETE' }))
  })
})

describe('useReaderSettings - updateDefaultSettings', () => {
  it('merges patch into READER_GROUP_DEFAULTS when no default set', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateDefaultSettings({ fontSize: 18 } as never)

    const stored = JSON.parse(localStorage.getItem('reader:default:epub') ?? 'null')
    expect(stored).toMatchObject({ ...READER_GROUP_DEFAULTS.epub, fontSize: 18 })
  })

  it('merges patch into existing defaultSettings', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateDefaultSettings({ fontSize: 18 } as never)
    s.updateDefaultSettings({ isDark: true } as never)

    const stored = JSON.parse(localStorage.getItem('reader:default:epub') ?? 'null')
    expect(stored).toMatchObject({ fontSize: 18, isDark: true })
  })

  it('calls api() with PUT when sync is enabled', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
    apiMock.mockResolvedValue({ ok: true })

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateDefaultSettings({ fontSize: 18 } as never)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/reader/defaults/epub', expect.objectContaining({ method: 'PUT' }))
  })

  it('does not call api() when sync is disabled', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateDefaultSettings({ fontSize: 18 } as never)

    expect(apiMock).not.toHaveBeenCalled()
  })
})

describe('useReaderSettings - resetDefaultSettings', () => {
  it('removes from localStorage', () => {
    localStorage.setItem('reader:default:epub', JSON.stringify({ fontSize: 18 }))

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.resetDefaultSettings()

    expect(localStorage.getItem('reader:default:epub')).toBeNull()
  })

  it('calls api() with DELETE when sync is enabled', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
    apiMock.mockResolvedValue({ ok: true })

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.resetDefaultSettings()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/reader/defaults/epub', expect.objectContaining({ method: 'DELETE' }))
  })

  it('does not call api() when sync is disabled', () => {
    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.resetDefaultSettings()

    expect(apiMock).not.toHaveBeenCalled()
  })
})

describe('useReaderSettings - syncEnabled behavior', () => {
  it('does not call api() when user is null', () => {
    useAuthMock.mockReturnValue({ user: ref(null) })

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 22 } as never)

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('calls api() when user has syncReaderPreferences: true', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
    apiMock.mockResolvedValue({ ok: true })

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 22 } as never)

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('does not call api() when syncReaderPreferences is false', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: false } }) })

    const s = useReaderSettings(BOOK_FILE_ID, 'epub')
    s.updateBookSettings({ fontSize: 22 } as never)

    expect(apiMock).not.toHaveBeenCalled()
  })
})

describe('useReaderSettings - syncFromDb (via load() when syncEnabled)', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
  })

  it('updates bookDelta when api returns valid settings', async () => {
    apiMock.mockResolvedValueOnce(makeFakeResponse(true, { settings: { fitMode: 'fit-page' } })).mockResolvedValueOnce(makeFakeResponse(false, {}))

    const s = useReaderSettings(BOOK_FILE_ID, 'cbz')
    await s.load()

    expect(s.bookDelta.value).toMatchObject({ fitMode: 'fit-page' })
    expect(s.isCustomized.value).toBe(true)
  })

  it('updates defaultSettings when api returns group key', async () => {
    apiMock
      .mockResolvedValueOnce(makeFakeResponse(false, {}))
      .mockResolvedValueOnce(makeFakeResponse(true, { cbx: { fitMode: 'fit-width', viewMode: 'single' } }))

    const s = useReaderSettings(BOOK_FILE_ID, 'cbz')
    await s.load()

    expect(s.effective.value).toMatchObject({ fitMode: 'fit-width' })
  })

  it('does not update bookDelta when api returns non-ok response', async () => {
    apiMock.mockResolvedValueOnce(makeFakeResponse(false, { settings: { fitMode: 'fit-page' } })).mockResolvedValueOnce(makeFakeResponse(false, {}))

    const s = useReaderSettings(BOOK_FILE_ID, 'cbz')
    await s.load()

    expect(s.bookDelta.value).toBeNull()
  })
})

describe('useReaderDefaultSettings - load() with localStorage', () => {
  it('loads epub settings from localStorage', async () => {
    const stored = { ...READER_GROUP_DEFAULTS.epub, fontSize: 20 }
    localStorage.setItem('reader:default:epub', JSON.stringify(stored))

    const s = useReaderDefaultSettings('epub')
    await s.load()

    expect(s.effective.value).toMatchObject({ fontSize: 20 })
  })

  it('fills fixedLayoutSpread for older epub defaults in localStorage', async () => {
    const stored = { ...READER_GROUP_DEFAULTS.epub, fontSize: 20 }
    delete (stored as Record<string, unknown>).fixedLayoutSpread
    localStorage.setItem('reader:default:epub', JSON.stringify(stored))

    const s = useReaderDefaultSettings('epub')
    await s.load()

    expect(s.effective.value).toMatchObject({ fontSize: 20, fixedLayoutSpread: 'auto' })
    expect(JSON.parse(localStorage.getItem('reader:default:epub') ?? '{}')).toMatchObject({ fixedLayoutSpread: 'auto' })
  })

  it('merges cbx localStorage settings with CBX_READER_DEFAULTS', async () => {
    const stored = { fitMode: 'fit-width', viewMode: 'single' }
    localStorage.setItem('reader:default:cbx', JSON.stringify(stored))

    const s = useReaderDefaultSettings<typeof CBX_READER_DEFAULTS>('cbz')
    await s.load()

    expect(s.effective.value).toMatchObject({ ...CBX_READER_DEFAULTS, fitMode: 'fit-width' })
  })

  it('falls back to group defaults when localStorage is empty', async () => {
    const s = useReaderDefaultSettings('epub')
    await s.load()

    expect(s.effective.value).toEqual(READER_GROUP_DEFAULTS.epub)
  })
})

describe('useReaderDefaultSettings - update', () => {
  it('merges patch into effective settings', () => {
    const s = useReaderDefaultSettings('epub')
    s.update({ fontSize: 22 } as never)

    expect(s.effective.value).toMatchObject({ fontSize: 22 })
  })

  it('writes merged settings to localStorage', () => {
    const s = useReaderDefaultSettings('epub')
    s.update({ fontSize: 22 } as never)

    const stored = JSON.parse(localStorage.getItem('reader:default:epub') ?? 'null')
    expect(stored).toMatchObject({ fontSize: 22 })
  })

  it('calls api() with PUT when sync is enabled', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
    apiMock.mockResolvedValue({ ok: true })

    const s = useReaderDefaultSettings('epub')
    s.update({ fontSize: 22 } as never)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/reader/defaults/epub', expect.objectContaining({ method: 'PUT' }))
  })
})

describe('useReaderDefaultSettings - reset', () => {
  it('clears settings and removes from localStorage', () => {
    localStorage.setItem('reader:default:epub', JSON.stringify({ fontSize: 22 }))

    const s = useReaderDefaultSettings('epub')
    s.reset()

    expect(s.effective.value).toEqual(READER_GROUP_DEFAULTS.epub)
    expect(localStorage.getItem('reader:default:epub')).toBeNull()
  })

  it('calls toast.success', () => {
    const s = useReaderDefaultSettings('epub')
    s.reset()

    expect(toastMock.success).toHaveBeenCalledWith('Settings reset to defaults')
  })

  it('calls api() with DELETE when sync is enabled', () => {
    useAuthMock.mockReturnValue({ user: ref({ settings: { syncReaderPreferences: true } }) })
    apiMock.mockResolvedValue({ ok: true })

    const s = useReaderDefaultSettings('epub')
    s.reset()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/reader/defaults/epub', expect.objectContaining({ method: 'DELETE' }))
  })

  it('does not call api() when sync is disabled', () => {
    const s = useReaderDefaultSettings('epub')
    s.reset()

    expect(apiMock).not.toHaveBeenCalled()
  })
})
