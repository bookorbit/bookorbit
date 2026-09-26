// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { PODCAST_ERROR_CODES } from '@bookorbit/types'
import { api } from '@/lib/api'
import { jsonResponse } from '../test/fixtures'
import { usePodcastArtworkEditor } from './usePodcastArtworkEditor'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

const apiMock = vi.mocked(api)
const objectUrls = { created: [] as File[], revoked: [] as string[] }

const artwork = { id: 12, imageUrl: '/api/v1/podcasts/12/artwork?v=2', artworkUpdatedAt: '2026-08-01T00:00:00.000Z' }

beforeEach(() => {
  apiMock.mockReset()
  objectUrls.created = []
  objectUrls.revoked = []
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (file: File) => {
      objectUrls.created.push(file)
      return `blob:podcast-${objectUrls.created.length}`
    },
    revokeObjectURL: (value: string) => objectUrls.revoked.push(value),
  })
})

describe('usePodcastArtworkEditor', () => {
  it('previews a chosen file without writing anything until it is confirmed', async () => {
    apiMock.mockResolvedValue(jsonResponse(artwork))
    const editor = usePodcastArtworkEditor(ref(12))
    const file = new File(['bytes'], 'cover.png', { type: 'image/png' })

    editor.selectFile(file)

    expect(editor.previewSrc.value).toBe('blob:podcast-1')
    expect(apiMock).not.toHaveBeenCalled()

    await expect(editor.confirm()).resolves.toEqual(artwork)

    const [url, init] = apiMock.mock.calls[0]!
    expect(url).toBe('/api/v1/podcasts/12/artwork')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    // Confirming clears the pending state, so a second confirm has nothing left to send.
    expect(editor.pendingFile.value).toBeNull()
    expect(objectUrls.revoked).toContain('blob:podcast-1')
  })

  it('sends a pasted address to the from-url endpoint instead of uploading bytes', async () => {
    apiMock.mockResolvedValue(jsonResponse(artwork))
    const editor = usePodcastArtworkEditor(ref(12))

    editor.setUrl('  https://cdn.example/art.png  ')
    await editor.confirm()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcasts/12/artwork/from-url',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ url: 'https://cdn.example/art.png' }) }),
    )
  })

  it('does nothing when neither a file nor an address is pending', async () => {
    const editor = usePodcastArtworkEditor(ref(12))

    await expect(editor.confirm()).resolves.toBeNull()
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('surfaces a localized failure rather than the server message', async () => {
    apiMock.mockResolvedValue(jsonResponse({ errorCode: PODCAST_ERROR_CODES.storageFull, message: 'Payload Too Large' }, 413))
    const editor = usePodcastArtworkEditor(ref(12))
    editor.setUrl('https://cdn.example/art.png')

    await expect(editor.confirm()).resolves.toBeNull()

    expect(editor.error.value).not.toBe('Payload Too Large')
    expect(editor.error.value).toBeTruthy()
    // A failed confirm keeps the pending value so the user can retry it.
    expect(editor.pendingUrl.value).toBe('https://cdn.example/art.png')
  })

  it('reverts to the feed artwork through the delete endpoint', async () => {
    apiMock.mockResolvedValue(jsonResponse({ ...artwork, artworkUpdatedAt: null }))
    const editor = usePodcastArtworkEditor(ref(12))

    await expect(editor.revert()).resolves.toMatchObject({ artworkUpdatedAt: null })
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/artwork', { method: 'DELETE' })
  })

  it('releases the object URL when its scope goes away', () => {
    const scope = effectScope()
    scope.run(() => {
      const editor = usePodcastArtworkEditor(ref(12))
      editor.selectFile(new File(['bytes'], 'cover.png', { type: 'image/png' }))
    })

    scope.stop()

    expect(objectUrls.revoked).toContain('blob:podcast-1')
  })
})
