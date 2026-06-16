import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BookTableCoverCell from '../BookTableCoverCell.vue'

vi.mock('../../../composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: () => '/cover.jpg' }),
}))
vi.mock('@/features/book/composables/useRefreshingBooks', () => ({
  useRefreshingBooks: () => ({ isRefreshing: () => false }),
}))

const CoverSurfaceStub = {
  name: 'BookCoverSurface',
  props: ['isComic', 'disableSpine'],
  template: '<div data-testid="surface" :data-comic="isComic" :data-audio="disableSpine"><slot /></div>',
}
const CoverArtworkStub = {
  name: 'BookCoverArtwork',
  props: ['isComic', 'spine'],
  template: '<div data-testid="artwork" :data-comic="isComic" :data-spine="spine" />',
}

function mountCell(props: { isAudio?: boolean; isComic?: boolean } = {}) {
  return mount(BookTableCoverCell, {
    props: { bookId: 1, title: 'Saga', hasCover: true, isAudio: props.isAudio ?? false, isComic: props.isComic ?? false },
    global: {
      stubs: { BookCoverSurface: CoverSurfaceStub, BookCoverArtwork: CoverArtworkStub, BookCoverImage: true, Teleport: true },
    },
  })
}

describe('BookTableCoverCell comic flag', () => {
  it('forwards isComic to the cover surface and artwork', () => {
    const wrapper = mountCell({ isComic: true })

    expect(wrapper.find('[data-testid="surface"]').attributes('data-comic')).toBe('true')
    expect(wrapper.find('[data-testid="artwork"]').attributes('data-comic')).toBe('true')
  })

  it('does not flag non-comic covers', () => {
    const wrapper = mountCell({ isComic: false })

    expect(wrapper.find('[data-testid="surface"]').attributes('data-comic')).toBe('false')
  })
})
