// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { coverTintVars, extractCoverTint } from './cover-tint'

type Pixel = [number, number, number]

const SIZE = 32

function imageDataFrom(pixels: Pixel[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const [r, g, b] = pixels[i % pixels.length]!
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return data
}

function stubCanvas(result: { data: Uint8ClampedArray } | Error) {
  const getImageData = vi.fn<() => { data: Uint8ClampedArray }>(() => {
    if (result instanceof Error) throw result
    return result
  })
  const context = { drawImage: vi.fn<() => void>(), getImageData }
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  })
  return context
}

function image(): HTMLImageElement {
  return { naturalWidth: 400, naturalHeight: 600 } as HTMLImageElement
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractCoverTint', () => {
  it('returns the hue of the dominant saturated colour', () => {
    stubCanvas({ data: imageDataFrom([[204, 0, 0]]) })
    expect(extractCoverTint(image())).toEqual({ primary: { hue: 0, saturation: 70 }, secondary: null })
  })

  it('ignores near-black and near-white pixels that carry no hue', () => {
    // Three quarters of the cover is black or white; the blue quarter must win.
    stubCanvas({
      data: imageDataFrom([
        [0, 0, 0],
        [255, 255, 255],
        [8, 8, 8],
        [0, 102, 204],
      ]),
    })
    expect(extractCoverTint(image())?.primary.hue).toBe(210)
  })

  it('clamps saturation into the usable band', () => {
    stubCanvas({ data: imageDataFrom([[140, 110, 110]]) })
    expect(extractCoverTint(image())?.primary.saturation).toBe(35)

    stubCanvas({ data: imageDataFrom([[0, 255, 0]]) })
    expect(extractCoverTint(image())?.primary.saturation).toBe(70)
  })

  it('keeps shades of one colour together instead of letting a flat minority hue win', () => {
    // Three quarters of the cover is red across shadow, midtone and highlight;
    // the remaining quarter is a single flat green. Red has to win.
    stubCanvas({
      data: imageDataFrom([
        [92, 12, 14],
        [178, 26, 24],
        [232, 74, 60],
        [46, 168, 92],
      ]),
    })
    expect(extractCoverTint(image())?.primary.hue).toBeLessThan(20)
  })

  it('averages hues circularly so colours either side of zero stay red', () => {
    stubCanvas({
      data: imageDataFrom([
        [204, 10, 30],
        [204, 30, 10],
      ]),
    })
    const hue = extractCoverTint(image())!.primary.hue
    expect(hue > 350 || hue < 10).toBe(true)
  })

  it('picks up a second tone when the cover carries a distinct accent hue', () => {
    stubCanvas({
      data: imageDataFrom([
        [204, 0, 0],
        [0, 102, 204],
      ]),
    })
    const tint = extractCoverTint(image())
    expect(tint?.primary.hue).toBe(0)
    expect(tint?.secondary?.hue).toBe(210)
  })

  it('ignores a runner-up that is only a neighbouring shade of the first', () => {
    stubCanvas({
      data: imageDataFrom([
        [204, 0, 0],
        [214, 20, 12],
      ]),
    })
    expect(extractCoverTint(image())?.secondary).toBeNull()
  })

  it('ignores a distinct hue that holds too little of the cover', () => {
    const pixels: Pixel[] = Array.from({ length: 40 }, () => [204, 0, 0] as Pixel)
    pixels[0] = [0, 102, 204]
    stubCanvas({ data: imageDataFrom(pixels) })
    expect(extractCoverTint(image())?.secondary).toBeNull()
  })

  it('returns null for a greyscale cover', () => {
    stubCanvas({ data: imageDataFrom([[128, 128, 128]]) })
    expect(extractCoverTint(image())).toBeNull()
  })

  it('returns null when a whole cover of near-grey adds up to the weight of a real accent', () => {
    stubCanvas({ data: imageDataFrom([[130, 128, 126]]) })
    expect(extractCoverTint(image())).toBeNull()
  })

  it('still tints a pale cover whose colour survives in only a small share of pixels', () => {
    // A white field with one accent, the O'Reilly shape: most pixels are dropped
    // by the lightness band, so the accent carries very little total weight.
    const pixels: Pixel[] = Array.from({ length: 8 }, () => [252, 252, 250] as Pixel)
    pixels[0] = [196, 132, 40]
    stubCanvas({ data: imageDataFrom(pixels) })
    expect(extractCoverTint(image())?.primary.hue).toBe(35)
  })

  it('returns null when the image has not decoded', () => {
    stubCanvas({ data: imageDataFrom([[204, 0, 0]]) })
    expect(extractCoverTint({ naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement)).toBeNull()
  })

  it('returns null when the canvas is tainted', () => {
    stubCanvas(new Error('SecurityError'))
    expect(extractCoverTint(image())).toBeNull()
  })
})

describe('coverTintVars', () => {
  it('exposes only hue and saturation to CSS', () => {
    expect(coverTintVars({ primary: { hue: 201, saturation: 70 }, secondary: null })).toEqual({
      '--cover-tint-hue': '201',
      '--cover-tint-saturation': '70%',
    })
  })

  it('adds the second tone variables when the cover has one', () => {
    expect(coverTintVars({ primary: { hue: 201, saturation: 70 }, secondary: { hue: 34, saturation: 55 } })).toEqual({
      '--cover-tint-hue': '201',
      '--cover-tint-saturation': '70%',
      '--cover-tint-hue-2': '34',
      '--cover-tint-saturation-2': '55%',
    })
  })

  it('returns undefined when there is no tint', () => {
    expect(coverTintVars(null)).toBeUndefined()
  })
})
