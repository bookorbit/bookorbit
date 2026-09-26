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

  it('measures only covers whose provider states no shape, once per image', async () => {
    const unsized = candidate('unsized')
    const stated = candidate('stated', { coverShape: 'square' })
    const list = ref<MetadataCandidate[]>([unsized, stated])
    const { shapeOf } = useCoverShapes(list)

    expect(FakeImage.loads.map((image) => image.src)).toEqual(['/covers/unsized.jpg'])
    expect(shapeOf(unsized)).toBe('unknown')

    FakeImage.loads[0]!.finish(336, 500)
    expect(shapeOf(unsized)).toBe('portrait')
    expect(shapeOf(stated)).toBe('square')

    list.value = [...list.value, candidate('unsized')]
    await nextTick()
    expect(FakeImage.loads).toHaveLength(1)
  })

  it('leaves a cover that fails to load as unknown', () => {
    const broken = candidate('broken')
    const { shapeOf } = useCoverShapes([broken])

    FakeImage.loads[0]!.onerror?.()
    expect(shapeOf(broken)).toBe('unknown')
  })
})
