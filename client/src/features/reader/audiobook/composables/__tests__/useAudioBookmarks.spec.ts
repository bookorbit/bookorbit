import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAudioBookmarks } from '../useAudioBookmarks'

const apiMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('useAudioBookmarks', () => {
  afterEach(() => {
    apiMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('creates a bookmark when randomUUID is unavailable on an insecure origin', async () => {
    const getRandomValues = vi.fn<(bytes: Uint8Array) => Uint8Array>((bytes) => {
      bytes.fill(0)
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })
    apiMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: '00000000-0000-4000-8000-000000000000',
          bookId: 7,
          positionMs: 12_500,
          chapterId: null,
          title: 'Chapter 1',
          note: null,
          createdAt: '2026-09-30T12:00:00.000Z',
          updatedAt: '2026-09-30T12:00:00.000Z',
        }),
    })
    const audioBookmarks = useAudioBookmarks(7)

    await expect(audioBookmarks.add(12.5, 'Chapter 1')).resolves.toMatchObject({ positionMs: 12_500 })

    const [, init] = apiMock.mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toMatchObject({
      clientId: '00000000-0000-4000-8000-000000000000',
      positionMs: 12_500,
    })
    expect(getRandomValues).toHaveBeenCalledOnce()
  })
})
