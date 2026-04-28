import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useCustomFonts } from '../useCustomFonts'
import type { UserFont, FontUploadResult } from '@bookorbit/types'
import { fontCssFamilyGroupName } from '@bookorbit/types'

const mockFonts: UserFont[] = [
  {
    id: 1,
    familyName: 'Literata',
    originalFileName: 'Literata-Regular.ttf',
    format: 'ttf',
    weight: 400,
    style: 'normal',
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
    it('fetches fonts and pre-caches blob URLs for all font files', async () => {
      setupFetchMock(mockFonts)

      await composable.fetchFonts()

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts')
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/1/file')
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/2/file')
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/3/file')
      expect(URL.createObjectURL).toHaveBeenCalledTimes(3)
      expect(composable.fonts.value).toHaveLength(3)
    })

    it('handles failed list fetch gracefully', async () => {
      fetchMock.mockResolvedValue({ ok: false })

      await composable.fetchFonts()

      expect(composable.fonts.value).toHaveLength(0)
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('continues when individual font file fetch fails', async () => {
      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFonts.slice(0, 1)) })
        }
        return Promise.resolve({ ok: false })
      })

      await composable.fetchFonts()

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

      vi.clearAllMocks()

      // Second fetch returns only font 3 — fonts 1 and 2 have been removed on the server
      fetchMock.mockImplementation((url: unknown) => {
        if (url === '/api/v1/fonts') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([mockFonts[2]]) })
        }
        if (typeof url === 'string' && /\/api\/v1\/fonts\/(\d+)\/file/.test(url)) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['font'])) })
        }
        return Promise.resolve({ ok: false })
      })

      await composable.fetchFonts()

      // Blob URLs for fonts 1 and 2 are revoked for removal; font 3's URL is also
      // revoked and replaced because cacheFontBlobUrl always revokes before re-caching.
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
      expect(composable.fonts.value).toHaveLength(1)
      expect(composable.fonts.value[0]!.id).toBe(3)
    })
  })

  describe('uploadFont', () => {
    it('uploads a font, adds it to the list, and caches its blob URL', async () => {
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
        if (url === '/api/v1/fonts/1/file') {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['font'])) })
        }
        return Promise.resolve({ ok: false })
      })

      const file = new File(['font data'], 'Literata-Regular.ttf')
      const result = await composable.uploadFont(file)

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/upload', expect.objectContaining({ method: 'POST' }))
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fonts/1/file')
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
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

  describe('deleteFont', () => {
    it('removes a font from the list and revokes its blob URL on success', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()
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
    it('uses blob URLs when available after fetchFonts', async () => {
      setupFetchMock(mockFonts)
      await composable.fetchFonts()

      const css = composable.generateFontFaceCSS()

      expect(css).toContain('@font-face')
      expect(css).toContain(`"${fontCssFamilyGroupName('Literata')}"`)
      expect(css).toContain(`"${fontCssFamilyGroupName('Georgia Pro')}"`)
      // Blob URLs should be used instead of API URLs
      expect(css).toContain('blob:test/')
      expect(css).not.toContain('/api/v1/fonts/1/file')
      expect(css).toContain('font-weight: 400')
      expect(css).toContain('font-weight: 700')
      expect(css).toContain('format("truetype")')
      expect(css).toContain('format("woff2")')
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
})
