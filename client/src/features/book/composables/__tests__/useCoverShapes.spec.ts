// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { MetadataCandidate } from '@bookorbit/types'
import { useCoverShapes } from '../useCoverShapes'

class FakeImage {
  static loads: FakeImage[] = []
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''

  constructor() {
    FakeImage.loads.push(this)
  }

  finish(width: number, height: number) {
    this.naturalWidth = width
    this.naturalHeight = height
    this.onload?.()
  }
}

function candidate(id: string, data: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return { provider: 'hardcover', providerId: id, title: 'The Silver Chair', coverUrl: `/covers/${id}.jpg`, ...data }
}

describe('useCoverShapes', () => {
  beforeEach(() => {
    FakeImage.loads = []
    vi.stubGlobal('Image', FakeImage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('measures each cover once, and trusts a shape the provider states', async () => {
    const unsized = candidate('unsized')
    const stated = candidate('stated', { coverShape: 'square' })
    const list = ref<MetadataCandidate[]>([unsized, stated])
    const { shapeOf } = useCoverShapes(list)

    expect(FakeImage.loads.map((image) => image.src)).toEqual(['/covers/unsized.jpg', '/covers/stated.jpg'])
    expect(shapeOf(unsized)).toBe('unknown')

    FakeImage.loads[0]!.finish(336, 500)
    FakeImage.loads[1]!.finish(300, 500)
    expect(shapeOf(unsized)).toBe('portrait')
    expect(shapeOf(stated)).toBe('square')

    list.value = [...list.value, candidate('unsized')]
    await nextTick()
    expect(FakeImage.loads).toHaveLength(2)
  })

  it('reports the measured size over a stated one, which can describe a thumbnail', () => {
    const thumb = candidate('thumb', { coverWidth: 355, coverHeight: 522 })
    const { sizeOf } = useCoverShapes([thumb])

    expect(sizeOf(thumb)).toEqual({ width: 355, height: 522 })
    FakeImage.loads[0]!.finish(1740, 2560)
    expect(sizeOf(thumb)).toEqual({ width: 1740, height: 2560 })
  })

  it('leaves a cover that fails to load as unknown', () => {
    const broken = candidate('broken')
    const { shapeOf, sizeOf } = useCoverShapes([broken])

    FakeImage.loads[0]!.onerror?.()
    expect(shapeOf(broken)).toBe('unknown')
    expect(sizeOf(broken)).toBeNull()
  })
})
