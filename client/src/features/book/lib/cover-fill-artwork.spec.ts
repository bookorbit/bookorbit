import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCoverFillArtworkUrl } from './cover-fill-artwork'

describe('createCoverFillArtworkUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('draws a blurred fill and a contained foreground into a square blob', async () => {
    class LoadedImage {
      decoding = ''
      naturalWidth = 200
      naturalHeight = 400
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    const drawImage = vi.fn<(image: CanvasImageSource, ...coordinates: number[]) => void>()
    const context = {
      drawImage,
      fillRect: vi.fn<(x: number, y: number, width: number, height: number) => void>(),
      restore: vi.fn<() => void>(),
      save: vi.fn<() => void>(),
      fillStyle: '',
      filter: '',
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn<() => typeof context>().mockReturnValue(context),
      toBlob: vi.fn<(callback: BlobCallback) => void>().mockImplementation((callback) => callback(new Blob(['artwork'], { type: 'image/jpeg' }))),
    }
    const createElement = document.createElement.bind(document)

    vi.stubGlobal('Image', LoadedImage)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') return canvas as unknown as HTMLCanvasElement
      return createElement(tagName, options)
    })
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn<(object: Blob | MediaSource) => string>().mockReturnValue('blob:cover-artwork'),
      revokeObjectURL: vi.fn<(url: string) => void>(),
    })

    await expect(createCoverFillArtworkUrl('/api/v1/books/42/cover', 512)).resolves.toBe('blob:cover-artwork')
    expect(canvas).toMatchObject({ width: 512, height: 512 })
    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(drawImage.mock.calls[0]?.[1]).toBeLessThan(0)
    expect(drawImage.mock.calls[1]?.slice(1)).toEqual([128, 0, 256, 512])
  })
})
