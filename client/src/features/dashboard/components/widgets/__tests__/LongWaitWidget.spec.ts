import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { LongWaitWidgetData } from '@bookorbit/types'
import LongWaitWidget from '../LongWaitWidget.vue'

const fetchLongWait = vi.fn<() => Promise<LongWaitWidgetData | null>>()

vi.mock('@/features/dashboard/api/dashboard-widget.api', () => ({
  fetchLongWait: () => fetchLongWait(),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn<(...args: unknown[]) => void>() }) }))
vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: () => '/cover.jpg' }),
}))

const CoverSurfaceStub = {
  name: 'BookCoverSurface',
  props: ['isComic'],
  template: '<div data-testid="surface" :data-comic="isComic"><slot /></div>',
}
const CoverArtworkStub = {
  name: 'BookCoverArtwork',
  props: ['isComic'],
  template: '<div data-testid="artwork" :data-comic="isComic" />',
}

function data(fileFormat: string | null): LongWaitWidgetData {
  return {
    bookId: 1,
    title: 'Bone',
    hasCover: true,
    addedAt: '2024-01-01',
    waitingDays: 120,
    pageCount: 200,
    genre: 'comic',
    fileId: 9,
    fileFormat,
  }
}

function mountWidget(fileFormat: string | null) {
  fetchLongWait.mockResolvedValue(data(fileFormat))
  return mount(LongWaitWidget, {
    global: { stubs: { BookCoverSurface: CoverSurfaceStub, BookCoverArtwork: CoverArtworkStub } },
  })
}

describe('LongWaitWidget comic spine flag', () => {
  it('marks comic books as comics for the cover surface and artwork', async () => {
    const wrapper = mountWidget('cb7')
    await flushPromises()

    expect(wrapper.find('[data-testid="surface"]').attributes('data-comic')).toBe('true')
    expect(wrapper.find('[data-testid="artwork"]').attributes('data-comic')).toBe('true')
  })

  it('does not mark non-comic books as comics', async () => {
    const wrapper = mountWidget('pdf')
    await flushPromises()

    expect(wrapper.find('[data-testid="surface"]').attributes('data-comic')).toBe('false')
  })
})
