import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FONT_FILE_SIZE } from '@bookorbit/types'
import { makeCustomFontsMock, makeFontStore, mockFont, type MockFontStore } from '../../../__tests__/font-store-fixture'

const apiMock = vi.hoisted(() => vi.fn<(input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

vi.mock('@/features/reader/epub/composables/useCustomFonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/reader/epub/composables/useCustomFonts')>()),
  useCustomFonts: vi.fn<() => unknown>(),
}))

import { FontUploadError, useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { useFontLibrary } from '../useFontLibrary'

const USAGE = {
  families: [
    { familyName: 'Courgette', books: 2, readers: 1, defaults: 0, hidden: 0 },
    { familyName: 'Big Caslon', books: 0, readers: 0, defaults: 0, hidden: 1 },
  ],
}

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

function setup(fonts = [mockFont(3, 'Courgette'), mockFont(2, 'Big Caslon', 500)]): {
  store: MockFontStore
  library: ReturnType<typeof useFontLibrary>
} {
  const store = makeFontStore('server', fonts)
  vi.mocked(useCustomFonts).mockReturnValue(makeCustomFontsMock({ server: store }) as never)
  return { store, library: useFontLibrary('server') }
}

const fontFile = (name: string, size = 1000) => {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('useFontLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockImplementation((url: string) => (url.endsWith('/usage') ? respond(USAGE) : respond({}, false)))
  })

  describe('usage', () => {
    it('loads the files and the reader counts together', async () => {
      const { store, library } = setup()

      await library.load()

      expect(store.fetchFonts).toHaveBeenCalled()
      expect(apiMock).toHaveBeenCalledWith('/api/v1/server-fonts/usage')
      expect(library.usageOf('__serverfont_courgette')).toMatchObject({ books: 2, readers: 1 })
    })

    it('answers zeros for a family the server did not count', async () => {
      const { library } = setup()
      await library.load()

      expect(library.usageOf('__serverfont_literata')).toEqual({ books: 0, readers: 0, defaults: 0, hidden: 0 })
    })

    it('keeps working when the counts cannot be loaded', async () => {
      apiMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })
      const { library } = setup()

      await expect(library.load()).resolves.toBeUndefined()
      expect(library.usageOf('__serverfont_courgette').books).toBe(0)
    })
  })

  describe('addFiles', () => {
    it('uploads one file at a time and records the face each became', async () => {
      const { store, library } = setup()
      let inFlight = 0
      let peak = 0
      store.uploadFont.mockImplementation(async (file: File) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
        inFlight--
        const name = file.name.replace(/-.*$/, '')
        return { font: mockFont(10, name), suggestedFamilyName: name, suggestedWeight: 400, suggestedStyle: 'normal' }
      })

      await library.addFiles([fontFile('Caudex-Regular.ttf'), fontFile('Forum-Regular.ttf')])

      expect(peak).toBe(1)
      expect(library.uploads.value.map((entry) => [entry.state, entry.face?.familyName, entry.newFamily])).toEqual([
        ['added', 'Caudex', true],
        ['added', 'Forum', true],
      ])
      expect([...library.newFamilies.value]).toEqual(['Caudex', 'Forum'])
    })

    it('does not call a file that joins an existing family new', async () => {
      const { store, library } = setup()
      store.uploadFont.mockResolvedValue({
        font: mockFont(11, 'Courgette', 700),
        suggestedFamilyName: 'Courgette',
        suggestedWeight: 700,
        suggestedStyle: 'normal',
      })

      await library.addFiles([fontFile('Courgette-Bold.ttf')])

      expect(library.uploads.value[0]).toMatchObject({ state: 'added', newFamily: false })
      expect(library.newFamilies.value.size).toBe(0)
    })

    it('refuses the wrong type and oversized files without sending them', async () => {
      const { store, library } = setup()

      await library.addFiles([fontFile('reading-notes.pdf'), fontFile('Huge.otf', MAX_FONT_FILE_SIZE + 1)])

      expect(store.uploadFont).not.toHaveBeenCalled()
      expect(library.uploads.value.map((entry) => [entry.state, entry.code])).toEqual([
        ['refused', 'FONT_UNSUPPORTED_TYPE'],
        ['refused', 'FONT_TOO_LARGE'],
      ])
    })

    it('keeps going after a refusal and reports each file on its own', async () => {
      const { store, library } = setup()
      store.uploadFont
        .mockRejectedValueOnce(
          new FontUploadError('This font file has already been uploaded', 409, 'FONT_DUPLICATE', {
            familyName: 'Courgette',
            weight: 400,
            style: 'normal',
          }),
        )
        .mockResolvedValueOnce({ font: mockFont(12, 'Gabriela'), suggestedFamilyName: 'Gabriela', suggestedWeight: 400, suggestedStyle: 'normal' })

      await library.addFiles([fontFile('Courgette-Copy.ttf'), fontFile('Gabriela-Regular.ttf')])

      expect(library.uploads.value.map((entry) => entry.state)).toEqual(['duplicate', 'added'])
      expect(library.uploads.value[0]!.face).toEqual({ familyName: 'Courgette', weight: 400, style: 'normal' })
    })

    it('names a duplicate by the style the font itself names', async () => {
      const italic = mockFont(9, 'Literata', 400, 'italic', {
        weightMin: 200,
        weightMax: 900,
        instances: [
          { name: 'Italic', weight: 400, style: 'italic' },
          { name: 'Bold Italic', weight: 700, style: 'italic' },
        ],
      })
      const { store, library } = setup([italic])
      store.uploadFont.mockRejectedValue(
        new FontUploadError('This font file has already been uploaded', 409, 'FONT_DUPLICATE', {
          familyName: 'Literata',
          weight: 400,
          style: 'italic',
        }),
      )

      await library.addFiles([fontFile('Literata-Italic.ttf')])

      expect(library.uploads.value[0]).toMatchObject({ state: 'duplicate', styleName: 'Italic' })
    })

    it('refreshes the reader counts once the batch is done', async () => {
      const { store, library } = setup()
      store.uploadFont.mockResolvedValue({
        font: mockFont(13, 'Forum'),
        suggestedFamilyName: 'Forum',
        suggestedWeight: 400,
        suggestedStyle: 'normal',
      })

      await library.addFiles([fontFile('Forum-Regular.ttf')])

      expect(apiMock).toHaveBeenCalledWith('/api/v1/server-fonts/usage')
    })

    it('clears the tray and the new marks on dismiss', async () => {
      const { store, library } = setup()
      store.uploadFont.mockResolvedValue({
        font: mockFont(14, 'Forum'),
        suggestedFamilyName: 'Forum',
        suggestedWeight: 400,
        suggestedStyle: 'normal',
      })
      await library.addFiles([fontFile('Forum-Regular.ttf')])

      library.dismissUploads()

      expect(library.uploads.value).toEqual([])
      expect(library.newFamilies.value.size).toBe(0)
    })
  })

  describe('renameFamily', () => {
    it('renames the family in one request and swaps the returned files in', async () => {
      const { store, library } = setup([mockFont(8, 'Literata'), mockFont(9, 'Literata', 400, 'italic'), mockFont(3, 'Courgette')])
      apiMock.mockImplementation((url: string) =>
        url.endsWith('/families') ? respond([mockFont(8, 'Literata Text'), mockFont(9, 'Literata Text', 400, 'italic')]) : respond(USAGE),
      )

      const result = await library.renameFamily('Literata', 'Literata Text')

      expect(result).toEqual({ ok: true })
      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/server-fonts/families',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ familyName: 'Literata', newFamilyName: 'Literata Text' }) }),
      )
      expect(store.fonts.value.map((font) => font.familyName)).toEqual(['Literata Text', 'Literata Text', 'Courgette'])
    })

    it('passes the error code back when the new name clashes', async () => {
      const { store, library } = setup()
      apiMock.mockImplementation((url: string) => (url.endsWith('/families') ? respond({ errorCode: 'FONT_FACE_TAKEN' }, false) : respond(USAGE)))

      await expect(library.renameFamily('Courgette', 'Big Caslon')).resolves.toEqual({ ok: false, code: 'FONT_FACE_TAKEN' })
      expect(store.fonts.value.map((font) => font.familyName)).toEqual(['Courgette', 'Big Caslon'])
    })
  })

  describe('removeFamily', () => {
    it('removes every file of the family', async () => {
      const { store, library } = setup([mockFont(8, 'Literata'), mockFont(9, 'Literata', 400, 'italic'), mockFont(3, 'Courgette')])

      await expect(library.removeFamily('Literata')).resolves.toEqual({ removed: 2, failed: 0 })
      expect(store.deleteFont.mock.calls).toEqual([[8], [9]])
    })

    it('counts the files it could not remove', async () => {
      const { store, library } = setup([mockFont(8, 'Literata'), mockFont(9, 'Literata', 400, 'italic')])
      store.deleteFont.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

      await expect(library.removeFamily('Literata')).resolves.toEqual({ removed: 1, failed: 1 })
    })
  })
})

describe("useFontLibrary('user')", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads the reader's own counts, which cover their fonts and the server's, by CSS name", async () => {
    apiMock.mockImplementation((url: string) =>
      url === '/api/v1/fonts/usage'
        ? respond({
            fonts: [
              { cssFamily: '__userfont_georgia', books: 2, isDefault: false },
              { cssFamily: '__serverfont_courgette', books: 0, isDefault: true },
            ],
          })
        : respond({}, false),
    )
    const store = makeFontStore('user', [mockFont(1, 'Georgia')])
    vi.mocked(useCustomFonts).mockReturnValue(makeCustomFontsMock({ user: store }) as never)
    const library = useFontLibrary('user')

    await library.load()

    expect(store.fetchFonts).toHaveBeenCalled()
    expect(library.usageOf('__userfont_georgia')).toEqual({ books: 2, readers: 1, defaults: 0, hidden: 0 })
    expect(library.usageOf('__serverfont_courgette')).toEqual({ books: 0, readers: 0, defaults: 1, hidden: 0 })
  })

  it('renames a family through the personal route', async () => {
    apiMock.mockImplementation((url: string) => (url === '/api/v1/fonts/families' ? respond([mockFont(1, 'Georgia Pro')]) : respond({ fonts: [] })))
    const store = makeFontStore('user', [mockFont(1, 'Georgia')])
    vi.mocked(useCustomFonts).mockReturnValue(makeCustomFontsMock({ user: store }) as never)
    const library = useFontLibrary('user')

    await expect(library.renameFamily('Georgia', 'Georgia Pro')).resolves.toEqual({ ok: true })
    expect(store.fonts.value.map((font) => font.familyName)).toEqual(['Georgia Pro'])
  })

  it("shares the page's useCustomFonts state when given one", () => {
    const customFonts = makeCustomFontsMock()
    useFontLibrary('user', customFonts as never)

    expect(customFonts.scopeStore).toHaveBeenCalledWith('user')
    expect(useCustomFonts).not.toHaveBeenCalled()
  })
})
