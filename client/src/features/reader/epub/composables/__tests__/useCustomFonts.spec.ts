import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useCustomFonts } from '../useCustomFonts'
import type { UserFont, FontUploadResult } from '@bookorbit/types'
import { fontCssFamilyGroupName } from '@bookorbit/types'

const serverCss = (name: string) => fontCssFamilyGroupName(name, 'server')

const mockFonts: UserFont[] = [
  {
    id: 1,
    familyName: 'Literata',
    originalFileName: 'Literata-Regular.ttf',
    format: 'ttf',
    weight: 400,
    style: 'normal',
    weightMin: null,
    weightMax: null,
    instances: null,
    fileSize: 50000,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    familyName: 'Literata',
    originalFileName: 'Literata-Bold.ttf',
    format: 'ttf',
    weight: 700,
    style: 'normal',
    weightMin: null,
    weightMax: null,
    instances: null,
    fileSize: 55000,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 3,
    familyName: 'Georgia Pro',
    originalFileName: 'GeorgiaPro.woff2',
    format: 'woff2',
    weight: 400,
    style: 'normal',
    weightMin: null,
    weightMax: null,
    instances: null,
    fileSize: 30000,
    createdAt: '2026-01-02T00:00:00.000Z',
  },
]

const fetchMock = vi.fn<(...args: unknown[]) => unknown>()

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => fetchMock(...args),
}))

function setupFetchMock(fonts: UserFont[]) {
  fetchMock.mockImplementation((url: unknown) => {
    if (url === '/api/v1/fonts') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fonts) })
    }
    if (typeof url === 'string' && /\/api\/v1\/fonts\/(\d+)\/file/.test(url)) {
      const id = Number(url.match(/\/api\/v1\/fonts\/(\d+)\/file/)![1])
      return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob([`font-data-${id}`])) })
    }
    return Promise.resolve({ ok: false })
  })
}

describe('useCustomFonts', () => {
  let composable: ReturnType<typeof useCustomFonts>

  beforeEach(() => {
    vi.clearAllMocks()
    let blobCounter = 0
    URL.createObjectURL = vi.fn<(obj: Blob | MediaSource) => string>().mockImplementation(() => `blob:test/font-${++blobCounter}`)
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    composable = useCustomFonts()
  })

  describe('fetchFonts', () => {
    it('fetches the font list without downloading any font file', async () => {
      setupFetchMock(mockFonts)

      await composable.fetchFonts()

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/fonts')
      // Fonts can be tens of megabytes each; downloading the whole library on open
      // would put gigabytes in tab memory.
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(composable.fonts.value).toHaveLength(3)
    })

    it('handles failed list fetch gracefully', async () => {
      fetchMock.mockResolvedValue({ ok: false })

      await composable.fetchFonts()

      expect(composable.fonts.value).toHaveLength(0)
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('keeps the list usable when a font file fetch fails', async () => {
      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFonts.slice(0, 1)) })
        }
        return Promise.resolve({ ok: false })
      })

      await composable.fetchFonts()
      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))

      expect(composable.fonts.value).toHaveLength(1)
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('sets loading state correctly', async () => {
      let resolveList!: () => void
      fetchMock.mockReturnValue(
        new Promise<{ ok: boolean; json: () => Promise<UserFont[]> }>((resolve) => {
          resolveList = () => resolve({ ok: true, json: () => Promise.resolve([]) })
        }),
      )

      const promise = composable.fetchFonts()
      expect(composable.loading.value).toBe(true)

      resolveList()
      await promise

      expect(composable.loading.value).toBe(false)
    })
    it('revokes blob URLs for fonts removed between fetches', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))

      vi.clearAllMocks()

      // Second fetch returns only font 3 — fonts 1 and 2 have been removed on the server
      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([mockFonts[2]]) })
        }
        return Promise.resolve({ ok: false })
      })

      await composable.fetchFonts()

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
      expect(composable.fonts.value).toHaveLength(1)
      expect(composable.fonts.value[0]!.id).toBe(3)
    })
  })

  describe('uploadFont', () => {
    it('uploads a font and adds it to the list without downloading it back', async () => {
      const uploadResult: FontUploadResult = {
        font: mockFonts[0]!,
        suggestedFamilyName: 'Literata',
        suggestedWeight: 400,
        suggestedStyle: 'normal',
      }

      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts/upload') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(uploadResult) })
        }
        return Promise.resolve({ ok: false })
      })

      const file = new File(['font data'], 'Literata-Regular.ttf')
      const result = await composable.uploadFont(file)

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/upload', expect.objectContaining({ method: 'POST' }))
      // The client just sent these bytes; pulling them straight back wastes the transfer.
      expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/fonts/1/file')
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(result).toEqual(uploadResult)
      expect(composable.fonts.value).toHaveLength(1)
    })

    it('throws on upload failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: 'Too large' }),
      })

      const file = new File(['font data'], 'big.ttf')
      await expect(composable.uploadFont(file)).rejects.toThrow('Too large')
    })

    it('sets uploading state correctly', async () => {
      let resolvePromise!: () => void
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = () =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ font: mockFonts[0], suggestedFamilyName: 'Test', suggestedWeight: 400, suggestedStyle: 'normal' }),
            })
        }),
      )

      const promise = composable.uploadFont(new File(['data'], 'test.ttf'))
      expect(composable.uploading.value).toBe(true)

      resolvePromise()
      await promise

      expect(composable.uploading.value).toBe(false)
    })
  })

  describe('ensureCssFamilyLoaded', () => {
    it('downloads only the requested family', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      vi.clearAllMocks()

      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/1/file')
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/2/file')
      expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/fonts/3/file')
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    })

    it('releases the previous family when switching, bounding memory to one family', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))
      vi.clearAllMocks()

      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Georgia Pro'))

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/3/file')

      const css = composable.generateFontFaceCSS()
      expect(css).toContain('/api/v1/fonts/1/file')
      expect(css).toContain('/api/v1/fonts/2/file')
      expect(css).not.toContain('/api/v1/fonts/3/file')
    })

    it('does not re-download a family that is already loaded', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))
      vi.clearAllMocks()

      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))

      expect(fetchMock).not.toHaveBeenCalled()
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('releases everything when the selection is cleared', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))
      vi.clearAllMocks()

      await composable.ensureCssFamilyLoaded(null)

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
      expect(composable.generateFontFaceCSS()).not.toContain('blob:')
    })

    it('ignores a family name that matches no font', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      vi.clearAllMocks()

      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Nonexistent'))

      expect(fetchMock).not.toHaveBeenCalled()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('keeps only the newest family when a switch interrupts an in-flight load', async () => {
      const listResponse = { ok: true, json: () => Promise.resolve(mockFonts) }
      const releaseFontFile = new Map<string, () => void>()

      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts') return Promise.resolve(listResponse)
        return new Promise((resolve) => {
          releaseFontFile.set(url as string, () => resolve({ ok: true, blob: () => Promise.resolve(new Blob(['font'])) }))
        })
      })

      await composable.fetchFonts()

      // Start loading Literata, then switch to Georgia Pro before its files arrive.
      const literata = composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))
      const georgia = composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Georgia Pro'))

      releaseFontFile.get('/api/v1/fonts/3/file')!()
      releaseFontFile.get('/api/v1/fonts/1/file')!()
      releaseFontFile.get('/api/v1/fonts/2/file')!()
      await Promise.all([literata, georgia])

      // The abandoned family must not stay resident just because it finished late.
      const css = composable.generateFontFaceCSS()
      expect(css).toContain('/api/v1/fonts/1/file')
      expect(css).toContain('/api/v1/fonts/2/file')
      expect(css).not.toContain('/api/v1/fonts/3/file')
    })

    it('survives a failed font file download', async () => {
      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFonts) })
        }
        if (url === '/api/v1/fonts/1/file') {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['font'])) })
        }
        return Promise.resolve({ ok: false })
      })

      await composable.fetchFonts()
      await expect(composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))).resolves.toBeUndefined()

      const css = composable.generateFontFaceCSS()
      expect(css).toContain('blob:test/')
      expect(css).toContain('/api/v1/fonts/2/file')
    })
  })

  describe('deleteFont', () => {
    it('removes a font from the list and revokes its blob URL on success', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))
      vi.clearAllMocks()

      fetchMock.mockResolvedValue({ ok: true })

      const result = await composable.deleteFont(1)

      expect(result).toBe(true)
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
      expect(composable.fonts.value).toHaveLength(2)
      expect(composable.fonts.value.find((f) => f.id === 1)).toBeUndefined()
    })

    it('returns false on failure without modifying list or revoking blob URL', async () => {
      composable.fonts.value = [...mockFonts]
      fetchMock.mockResolvedValue({ ok: false })

      const result = await composable.deleteFont(1)

      expect(result).toBe(false)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      expect(composable.fonts.value).toHaveLength(3)
    })
  })

  describe('updateFont', () => {
    it('updates a font in the list', async () => {
      composable.fonts.value = [...mockFonts]
      const updated = { ...mockFonts[0]!, familyName: 'Updated' }
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(updated),
      })

      const result = await composable.updateFont(1, { familyName: 'Updated' })

      expect(result).toEqual(updated)
      expect(composable.fonts.value.find((f) => f.id === 1)?.familyName).toBe('Updated')
    })

    it('returns null on failure', async () => {
      composable.fonts.value = [...mockFonts]
      fetchMock.mockResolvedValue({ ok: false })

      const result = await composable.updateFont(1, { familyName: 'Fail' })

      expect(result).toBeNull()
    })
  })

  describe('families', () => {
    it('groups fonts by family name', () => {
      composable.fonts.value = [...mockFonts]

      const families = composable.families.value

      expect(families).toHaveLength(2)
      expect(families[0]!.name).toBe('Literata')
      expect(families[0]!.cssFamilyName).toBe(fontCssFamilyGroupName('Literata'))
      expect(families[0]!.variants).toHaveLength(2)
      expect(families[1]!.name).toBe('Georgia Pro')
      expect(families[1]!.cssFamilyName).toBe(fontCssFamilyGroupName('Georgia Pro'))
      expect(families[1]!.variants).toHaveLength(1)
    })

    it('returns empty array when no fonts', () => {
      expect(composable.families.value).toHaveLength(0)
    })
  })

  describe('generateFontFaceCSS', () => {
    it('uses blob URLs for the loaded family and API URLs for the rest', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
      await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))

      const css = composable.generateFontFaceCSS()

      expect(css).toContain('@font-face')
      expect(css).toContain(`"${fontCssFamilyGroupName('Literata')}"`)
      expect(css).toContain(`"${fontCssFamilyGroupName('Georgia Pro')}"`)
      // The loaded family resolves through blobs so the reader iframe can fetch it
      // without auth headers; the unloaded one stays on its cookie-authenticated URL.
      expect(css).toContain('blob:test/')
      expect(css).not.toContain('/api/v1/fonts/1/file')
      expect(css).not.toContain('/api/v1/fonts/2/file')
      expect(css).toContain('/api/v1/fonts/3/file')
      expect(css).toContain('font-weight: 400')
      expect(css).toContain('font-weight: 700')
      expect(css).toContain('format("truetype")')
      expect(css).toContain('format("woff2")')
    })

    it('declares a variable font as a weight range, so every weight renders from the axis', () => {
      composable.fonts.value = [
        {
          id: 9,
          familyName: 'Inter',
          originalFileName: 'Inter-Variable.ttf',
          format: 'ttf',
          weight: 400,
          style: 'normal',
          weightMin: 100,
          weightMax: 900,
          instances: [{ name: 'Bold', weight: 700, style: 'normal' }],
          fileSize: 60000,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]

      const css = composable.generateFontFaceCSS()

      expect(css).toContain('font-weight: 100 900;')
      expect(css).toContain('font-style: normal;')
    })

    it('registers every style axis exposed by a variable font', () => {
      composable.fonts.value = [
        {
          id: 9,
          familyName: 'Recursive',
          originalFileName: 'Recursive-Variable.ttf',
          format: 'ttf',
          weight: 400,
          style: 'normal',
          weightMin: 300,
          weightMax: 1000,
          instances: [
            { name: 'Regular', weight: 400, style: 'normal' },
            { name: 'Italic', weight: 400, style: 'italic' },
          ],
          fileSize: 60000,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]

      const css = composable.generateFontFaceCSS()

      expect(css.match(/@font-face/g)).toHaveLength(2)
      expect(css).toContain('font-style: normal;')
      expect(css).toContain('font-style: italic;')
      expect(css.match(/font-weight: 300 1000;/g)).toHaveLength(2)
    })

    it('keeps a static font pinned to its single weight', () => {
      composable.fonts.value = [mockFonts[1]!]

      expect(composable.generateFontFaceCSS()).toContain('font-weight: 700;')
    })

    it('falls back to API URL when blob cache is missing', () => {
      composable.fonts.value = [...mockFonts]

      const css = composable.generateFontFaceCSS()

      expect(css).toContain('/api/v1/fonts/1/file')
      expect(css).toContain('/api/v1/fonts/2/file')
      expect(css).toContain('/api/v1/fonts/3/file')
      expect(css).not.toContain('blob:')
    })

    it('generates @font-face rules using family-level CSS names shared across variants', () => {
      composable.fonts.value = [...mockFonts]
      const css = composable.generateFontFaceCSS()

      expect(css).toContain('@font-face')
      expect(css).toContain(`"${fontCssFamilyGroupName('Literata')}"`)
      expect(css).toContain(`"${fontCssFamilyGroupName('Georgia Pro')}"`)
      expect(css).not.toContain('"__userfont_1"')
      expect(css).not.toContain('"__userfont_2"')
    })

    it('returns empty string when no fonts', () => {
      expect(composable.generateFontFaceCSS()).toBe('')
    })
  })

  describe('isFontFamilySelected', () => {
    it('returns true when currentFontFamily matches the family group CSS name', () => {
      composable.fonts.value = [...mockFonts]
      expect(composable.isFontFamilySelected('Literata', fontCssFamilyGroupName('Literata'))).toBe(true)
    })

    it('returns false when currentFontFamily is a different family', () => {
      composable.fonts.value = [...mockFonts]
      expect(composable.isFontFamilySelected('Literata', fontCssFamilyGroupName('Georgia Pro'))).toBe(false)
    })

    it('returns false when currentFontFamily is null', () => {
      composable.fonts.value = [...mockFonts]
      expect(composable.isFontFamilySelected('Literata', null)).toBe(false)
    })
  })

  describe('getCssFamilyForDisplay', () => {
    it('returns the group CSS family name for a known family', () => {
      composable.fonts.value = [...mockFonts]
      expect(composable.getCssFamilyForDisplay('Literata')).toBe(fontCssFamilyGroupName('Literata'))
      expect(composable.getCssFamilyForDisplay('Georgia Pro')).toBe(fontCssFamilyGroupName('Georgia Pro'))
    })

    it('returns null when family not found', () => {
      composable.fonts.value = [...mockFonts]
      expect(composable.getCssFamilyForDisplay('Unknown')).toBeNull()
    })
  })

  describe('server fonts', () => {
    const mockServerFonts: UserFont[] = [
      {
        id: 1,
        familyName: 'OpenDyslexic',
        originalFileName: 'OpenDyslexic-Regular.otf',
        format: 'otf',
        weight: 400,
        style: 'normal',
        weightMin: null,
        weightMax: null,
        instances: null,
        fileSize: 60000,
        createdAt: '2026-01-03T00:00:00.000Z',
      },
      {
        id: 2,
        familyName: 'Literata',
        originalFileName: 'Literata-Server.ttf',
        format: 'ttf',
        weight: 400,
        style: 'normal',
        weightMin: null,
        weightMax: null,
        instances: null,
        fileSize: 51000,
        createdAt: '2026-01-03T00:00:00.000Z',
      },
    ]

    function setupBothScopes(userFonts = mockFonts, serverFonts = mockServerFonts) {
      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts') return Promise.resolve({ ok: true, json: () => Promise.resolve(userFonts) })
        if (url === '/api/v1/server-fonts') return Promise.resolve({ ok: true, json: () => Promise.resolve(serverFonts) })
        if (typeof url === 'string' && url.endsWith('/file')) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob([url])) })
        }
        return Promise.resolve({ ok: false })
      })
    }

    describe('fetching', () => {
      it('reads the server collection from its own endpoint', async () => {
        setupBothScopes()

        await composable.fetchServerFonts()

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/server-fonts')
        expect(composable.serverFonts.value).toHaveLength(2)
        expect(composable.fonts.value).toHaveLength(0)
      })

      it('leaves the user collection untouched when only server fonts are fetched', async () => {
        setupBothScopes()
        await composable.fetchFonts()
        await composable.fetchServerFonts()

        expect(composable.fonts.value).toHaveLength(3)
        expect(composable.serverFonts.value).toHaveLength(2)
      })

      it('loads both collections for the reader', async () => {
        setupBothScopes()

        await composable.fetchAllFonts()

        expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts')
        expect(fetchMock).toHaveBeenCalledWith('/api/v1/server-fonts')
        expect(composable.fonts.value).toHaveLength(3)
        expect(composable.serverFonts.value).toHaveLength(2)
      })

      it('keeps the user collection when the server request fails', async () => {
        fetchMock.mockImplementation((url: unknown) => {
          if (url === '/api/v1/fonts') return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFonts) })
          return Promise.resolve({ ok: false })
        })

        await composable.fetchAllFonts()

        expect(composable.fonts.value).toHaveLength(3)
        expect(composable.serverFonts.value).toHaveLength(0)
      })

      it('tracks loading state per scope', async () => {
        let resolveServer!: () => void
        fetchMock.mockImplementation((url: unknown) => {
          if (url !== '/api/v1/server-fonts') return Promise.resolve({ ok: false })
          return new Promise((resolve) => {
            resolveServer = () => resolve({ ok: true, json: () => Promise.resolve([]) })
          })
        })

        const promise = composable.fetchServerFonts()
        expect(composable.serverLoading.value).toBe(true)
        expect(composable.loading.value).toBe(false)

        resolveServer()
        await promise

        expect(composable.serverLoading.value).toBe(false)
      })
    })

    describe('family independence', () => {
      it('keeps same-named user and server families apart', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        const userLiterata = composable.families.value.find((f) => f.name === 'Literata')
        const serverLiterata = composable.serverFamilies.value.find((f) => f.name === 'Literata')

        expect(userLiterata!.cssFamilyName).toBe(fontCssFamilyGroupName('Literata'))
        expect(serverLiterata!.cssFamilyName).toBe(serverCss('Literata'))
        expect(userLiterata!.cssFamilyName).not.toBe(serverLiterata!.cssFamilyName)
      })

      it('tags every family with the scope it came from', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        expect(composable.families.value.every((f) => f.scope === 'user')).toBe(true)
        expect(composable.serverFamilies.value.every((f) => f.scope === 'server')).toBe(true)
      })

      it('emits a separate @font-face group per scope so neither overrides the other', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        const css = composable.generateFontFaceCSS()

        expect(css).toContain(`"${fontCssFamilyGroupName('Literata')}"`)
        expect(css).toContain(`"${serverCss('Literata')}"`)
        expect(css).toContain('/api/v1/fonts/1/file')
        expect(css).toContain('/api/v1/server-fonts/1/file')
      })

      it('selects and reports selection per scope', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        expect(composable.getCssFamilyForDisplay('Literata', 'server')).toBe(serverCss('Literata'))
        expect(composable.getCssFamilyForDisplay('Literata', 'user')).toBe(fontCssFamilyGroupName('Literata'))
        expect(composable.getCssFamilyForDisplay('Georgia Pro', 'server')).toBeNull()

        expect(composable.isFontFamilySelected('Literata', serverCss('Literata'), 'server')).toBe(true)
        expect(composable.isFontFamilySelected('Literata', serverCss('Literata'), 'user')).toBe(false)
      })

      it('resolves ids against the right scope when both use the same id', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        // Both collections contain a font with id 1.
        await composable.ensureCssFamilyLoaded(serverCss('OpenDyslexic'))

        expect(fetchMock).toHaveBeenCalledWith('/api/v1/server-fonts/1/file')
        expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/fonts/1/file')
      })
    })

    describe('blob lifetime across scopes', () => {
      it('releases a loaded user family when switching to a server family', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()
        await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))
        vi.clearAllMocks()

        await composable.ensureCssFamilyLoaded(serverCss('OpenDyslexic'))

        // Both Literata variants must be freed; leaving them resident is the leak this guards.
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
        const css = composable.generateFontFaceCSS()
        expect(css).toContain('/api/v1/fonts/1/file')
        expect(css).toContain('/api/v1/fonts/2/file')
      })

      it('releases a loaded server family when switching back to a user family', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()
        await composable.ensureCssFamilyLoaded(serverCss('OpenDyslexic'))
        vi.clearAllMocks()

        await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Georgia Pro'))

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        expect(composable.generateFontFaceCSS()).toContain('/api/v1/server-fonts/1/file')
      })

      it('does not revoke the user font that shares an id with a deleted server font', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()
        await composable.ensureCssFamilyLoaded(fontCssFamilyGroupName('Literata'))
        vi.clearAllMocks()
        fetchMock.mockResolvedValue({ ok: true })

        await composable.deleteServerFont(1)

        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        expect(composable.generateFontFaceCSS()).toContain('blob:test/')
      })

      it('drops blobs for server fonts removed between fetches', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()
        await composable.ensureCssFamilyLoaded(serverCss('OpenDyslexic'))
        vi.clearAllMocks()

        fetchMock.mockImplementation((url: unknown) => {
          if (url === '/api/v1/server-fonts') return Promise.resolve({ ok: true, json: () => Promise.resolve([mockServerFonts[1]]) })
          return Promise.resolve({ ok: false })
        })

        await composable.fetchServerFonts()

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        expect(composable.serverFonts.value).toHaveLength(1)
      })
    })

    describe('mutations', () => {
      it('uploads to the server endpoint and appends to the server list', async () => {
        const uploadResult: FontUploadResult = {
          font: mockServerFonts[0]!,
          suggestedFamilyName: 'OpenDyslexic',
          suggestedWeight: 400,
          suggestedStyle: 'normal',
        }
        fetchMock.mockImplementation((url: unknown) =>
          url === '/api/v1/server-fonts/upload'
            ? Promise.resolve({ ok: true, json: () => Promise.resolve(uploadResult) })
            : Promise.resolve({ ok: false }),
        )

        const result = await composable.uploadServerFont(new File(['data'], 'OpenDyslexic.otf'))

        expect(result).toEqual(uploadResult)
        expect(composable.serverFonts.value).toHaveLength(1)
        expect(composable.fonts.value).toHaveLength(0)
      })

      it('tracks server upload state separately from user uploads', async () => {
        let resolveUpload!: () => void
        fetchMock.mockReturnValue(
          new Promise((resolve) => {
            resolveUpload = () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ font: mockServerFonts[0], suggestedFamilyName: null, suggestedWeight: 400, suggestedStyle: 'normal' }),
              })
          }),
        )

        const promise = composable.uploadServerFont(new File(['data'], 'x.otf'))
        expect(composable.serverUploading.value).toBe(true)
        expect(composable.uploading.value).toBe(false)

        resolveUpload()
        await promise

        expect(composable.serverUploading.value).toBe(false)
      })

      it('patches and deletes through the server endpoint', async () => {
        composable.serverFonts.value = [...mockServerFonts]
        const updated = { ...mockServerFonts[0]!, familyName: 'Open Dyslexic' }
        fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })

        await composable.updateServerFont(1, { familyName: 'Open Dyslexic' })

        expect(fetchMock).toHaveBeenCalledWith('/api/v1/server-fonts/1', expect.objectContaining({ method: 'PATCH' }))
        expect(composable.serverFonts.value.find((f) => f.id === 1)?.familyName).toBe('Open Dyslexic')

        await composable.deleteServerFont(1)

        expect(fetchMock).toHaveBeenCalledWith('/api/v1/server-fonts/1', { method: 'DELETE' })
        expect(composable.serverFonts.value).toHaveLength(1)
      })
    })

    describe('cssFamilyExists', () => {
      it('recognises families in either scope', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        expect(composable.cssFamilyExists(fontCssFamilyGroupName('Georgia Pro'))).toBe(true)
        expect(composable.cssFamilyExists(serverCss('OpenDyslexic'))).toBe(true)
      })

      it('rejects a family that only exists in the other scope', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        expect(composable.cssFamilyExists(serverCss('Georgia Pro'))).toBe(false)
      })

      it('rejects built-in stacks and empty selections', () => {
        expect(composable.cssFamilyExists('serif')).toBe(false)
        expect(composable.cssFamilyExists(null)).toBe(false)
      })
    })

    describe('scopeStore', () => {
      it('exposes the matching collection and cap for each scope', () => {
        expect(composable.scopeStore('user').maxFonts).toBe(50)
        expect(composable.scopeStore('server').maxFonts).toBe(200)
        expect(composable.scopeStore('server').scope).toBe('server')
      })

      it('routes writes to the scope it was created for', async () => {
        composable.serverFonts.value = [...mockServerFonts]
        fetchMock.mockResolvedValue({ ok: true })

        await composable.scopeStore('server').deleteFont(1)

        expect(fetchMock).toHaveBeenCalledWith('/api/v1/server-fonts/1', { method: 'DELETE' })
        expect(composable.serverFonts.value).toHaveLength(1)
      })

      it('emits CSS for only its own scope', async () => {
        setupBothScopes()
        await composable.fetchAllFonts()

        const serverOnly = composable.scopeStore('server').generateFontFaceCSS()

        expect(serverOnly).toContain('/api/v1/server-fonts/1/file')
        expect(serverOnly).not.toContain('/api/v1/fonts/')
      })
    })
  })

  describe('server font visibility', () => {
    const serverFonts: UserFont[] = [
      {
        id: 1,
        familyName: 'OpenDyslexic',
        originalFileName: 'OpenDyslexic.otf',
        format: 'otf',
        weight: 400,
        style: 'normal',
        weightMin: null,
        weightMax: null,
        instances: null,
        fileSize: 60000,
        createdAt: '2026-01-03T00:00:00.000Z',
      },
      {
        id: 2,
        familyName: 'Atkinson Hyperlegible',
        originalFileName: 'Atkinson.otf',
        format: 'otf',
        weight: 400,
        style: 'normal',
        weightMin: null,
        weightMax: null,
        instances: null,
        fileSize: 61000,
        createdAt: '2026-01-03T00:00:00.000Z',
      },
    ]

    const PREFS_URL = '/api/v1/user-preferences/server-fonts'

    function setupWithVisibility(hiddenFamilies: string[] = [], prefsOk = true) {
      fetchMock.mockImplementation((url: unknown, init?: unknown) => {
        if (url === '/api/v1/fonts') return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFonts) })
        if (url === '/api/v1/server-fonts') return Promise.resolve({ ok: true, json: () => Promise.resolve(serverFonts) })
        if (url === PREFS_URL && (init as { method?: string } | undefined)?.method === 'PUT') return Promise.resolve({ ok: prefsOk })
        if (url === PREFS_URL) {
          return prefsOk
            ? Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: { hiddenFamilies } }) })
            : Promise.resolve({ ok: false })
        }
        return Promise.resolve({ ok: false })
      })
    }

    describe('loading', () => {
      it('reads the opt-out list alongside the font collections', async () => {
        setupWithVisibility(['OpenDyslexic'])

        await composable.fetchAllFonts()

        expect(fetchMock).toHaveBeenCalledWith(PREFS_URL)
        expect(composable.hiddenServerFamilies.value).toEqual(['OpenDyslexic'])
      })

      it('shows everything when the preference has never been set', async () => {
        setupWithVisibility([])

        await composable.fetchAllFonts()

        expect(composable.visibleServerFamilies.value).toHaveLength(2)
      })

      it('falls back to showing everything when the preference cannot be read', async () => {
        fetchMock.mockImplementation((url: unknown) => {
          if (url === '/api/v1/server-fonts') return Promise.resolve({ ok: true, json: () => Promise.resolve(serverFonts) })
          return Promise.resolve({ ok: false })
        })

        await composable.fetchAllFonts()

        expect(composable.hiddenServerFamilies.value).toEqual([])
        expect(composable.visibleServerFamilies.value).toHaveLength(2)
      })
    })

    describe('filtering', () => {
      it('keeps hidden families out of the picker list but in the full list', async () => {
        setupWithVisibility(['OpenDyslexic'])
        await composable.fetchAllFonts()

        expect(composable.serverFamilies.value.map((f) => f.name)).toEqual(['OpenDyslexic', 'Atkinson Hyperlegible'])
        expect(composable.visibleServerFamilies.value.map((f) => f.name)).toEqual(['Atkinson Hyperlegible'])
      })

      it("never filters the user's own fonts", async () => {
        setupWithVisibility(['Literata'])
        await composable.fetchAllFonts()

        // 'Literata' is also a user family here; hiding is server-scoped only.
        expect(composable.families.value.map((f) => f.name)).toContain('Literata')
      })

      it('reports a hidden family by name', async () => {
        setupWithVisibility(['OpenDyslexic'])
        await composable.fetchAllFonts()

        expect(composable.isServerFamilyHidden('OpenDyslexic')).toBe(true)
        expect(composable.isServerFamilyHidden('Atkinson Hyperlegible')).toBe(false)
      })

      it('still emits @font-face rules for hidden families, so nothing breaks mid-read', async () => {
        setupWithVisibility(['OpenDyslexic'])
        await composable.fetchAllFonts()

        expect(composable.generateFontFaceCSS()).toContain(serverCss('OpenDyslexic'))
      })
    })

    describe('cssFamilyAvailable', () => {
      it('treats a hidden server family as unavailable while it still exists', async () => {
        setupWithVisibility(['OpenDyslexic'])
        await composable.fetchAllFonts()

        expect(composable.cssFamilyExists(serverCss('OpenDyslexic'))).toBe(true)
        expect(composable.cssFamilyAvailable(serverCss('OpenDyslexic'))).toBe(false)
      })

      it('treats a kept server family as available', async () => {
        setupWithVisibility(['OpenDyslexic'])
        await composable.fetchAllFonts()

        expect(composable.cssFamilyAvailable(serverCss('Atkinson Hyperlegible'))).toBe(true)
      })

      it('is unaffected by server opt-outs for user fonts', async () => {
        setupWithVisibility(['Literata'])
        await composable.fetchAllFonts()

        expect(composable.cssFamilyAvailable(fontCssFamilyGroupName('Literata'))).toBe(true)
      })

      it('is false for a family that does not exist at all', async () => {
        setupWithVisibility([])
        await composable.fetchAllFonts()

        expect(composable.cssFamilyAvailable(serverCss('Nonexistent'))).toBe(false)
      })
    })

    describe('setServerFamilyHidden', () => {
      it('persists the whole opt-out list on hide', async () => {
        setupWithVisibility([])
        await composable.fetchAllFonts()
        vi.clearAllMocks()
        fetchMock.mockResolvedValue({ ok: true })

        await expect(composable.setServerFamilyHidden('OpenDyslexic', true)).resolves.toBe(true)

        expect(fetchMock).toHaveBeenCalledWith(
          PREFS_URL,
          expect.objectContaining({ method: 'PUT', body: JSON.stringify({ settings: { hiddenFamilies: ['OpenDyslexic'] } }) }),
        )
        expect(composable.visibleServerFamilies.value.map((f) => f.name)).toEqual(['Atkinson Hyperlegible'])
      })

      it('removes the entry on restore', async () => {
        setupWithVisibility(['OpenDyslexic', 'Atkinson Hyperlegible'])
        await composable.fetchAllFonts()
        vi.clearAllMocks()
        fetchMock.mockResolvedValue({ ok: true })

        await composable.setServerFamilyHidden('OpenDyslexic', false)

        expect(fetchMock).toHaveBeenCalledWith(
          PREFS_URL,
          expect.objectContaining({ body: JSON.stringify({ settings: { hiddenFamilies: ['Atkinson Hyperlegible'] } }) }),
        )
        expect(composable.hiddenServerFamilies.value).toEqual(['Atkinson Hyperlegible'])
      })

      it('does not add a duplicate when hiding twice', async () => {
        setupWithVisibility(['OpenDyslexic'])
        await composable.fetchAllFonts()
        fetchMock.mockResolvedValue({ ok: true })

        await composable.setServerFamilyHidden('OpenDyslexic', true)

        expect(composable.hiddenServerFamilies.value).toEqual(['OpenDyslexic'])
      })

      it('rolls back the optimistic change when the write is rejected', async () => {
        setupWithVisibility([])
        await composable.fetchAllFonts()
        fetchMock.mockResolvedValue({ ok: false })

        await expect(composable.setServerFamilyHidden('OpenDyslexic', true)).resolves.toBe(false)

        expect(composable.hiddenServerFamilies.value).toEqual([])
        expect(composable.visibleServerFamilies.value).toHaveLength(2)
      })

      it('rolls back when the write throws', async () => {
        setupWithVisibility([])
        await composable.fetchAllFonts()
        fetchMock.mockRejectedValue(new Error('offline'))

        await expect(composable.setServerFamilyHidden('OpenDyslexic', true)).resolves.toBe(false)

        expect(composable.hiddenServerFamilies.value).toEqual([])
      })
    })
  })
})
