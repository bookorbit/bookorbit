import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { CurrentlyReadingWidgetData } from '@bookorbit/types'
import CurrentlyReadingWidget from '../CurrentlyReadingWidget.vue'

const fetchCurrentlyReading = vi.fn<() => Promise<CurrentlyReadingWidgetData>>()

vi.mock('@/features/dashboard/api/dashboard-widget.api', () => ({
  fetchCurrentlyReading: () => fetchCurrentlyReading(),
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

function book(fileFormat: string | null) {
  return { bookId: 1, title: 'Saga', authors: ['Brian K. Vaughan'], progress: 40, hasCover: true, fileId: 9, fileFormat }
}

function mountWidget(fileFormat: string | null) {
  fetchCurrentlyReading.mockResolvedValue({ books: [book(fileFormat)] })
  return mount(CurrentlyReadingWidget, {
    global: { stubs: { BookCoverSurface: CoverSurfaceStub, BookCoverArtwork: CoverArtworkStub } },
  })
}

describe('CurrentlyReadingWidget comic spine flag', () => {
  it('marks comic books as comics for the cover surface and artwork', async () => {
    const wrapper = mountWidget('cbz')
    await flushPromises()

    expect(wrapper.find('[data-testid="surface"]').attributes('data-comic')).toBe('true')
    expect(wrapper.find('[data-testid="artwork"]').attributes('data-comic')).toBe('true')
  })

  it('does not mark non-comic books as comics', async () => {
    const wrapper = mountWidget('epub')
    await flushPromises()

    expect(wrapper.find('[data-testid="surface"]').attributes('data-comic')).toBe('false')
  })

  it('treats a null file format as non-comic', async () => {
    const wrapper = mountWidget(null)
    await flushPromises()

    expect(wrapper.find('[data-testid="surface"]').attributes('data-comic')).toBe('false')
  })
})
