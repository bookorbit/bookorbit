import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import BookCarousel, { type CarouselBook } from './BookCarousel.vue'
import { clearCoverLoadCache } from '@/features/book/lib/cover-load-cache'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const mockRouterPush = vi.fn<() => void>()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (id: number, size: string) => `/api/covers/${id}/${size}`,
  }),
}))

vi.mock('@/features/book/components/BookCoverPlaceholder.vue', () => ({
  default: defineComponent({
    name: 'BookCoverPlaceholder',
    props: ['title', 'authorLine', 'isAudio', 'seed'],
    setup(props) {
      return () =>
        h(
          'div',
          {
            'data-testid': 'placeholder',
            'data-title': props.title,
            'data-author': props.authorLine,
            'data-is-audio': props.isAudio === true ? 'true' : 'false',
          },
          [],
        )
    },
  }),
}))

vi.mock('@/features/book/lib/book-cover', () => ({
  bookCoverStyle: (seed: string) => ({ background: `linear-gradient(${seed})`, color: 'oklch(90% 0.05 200)' }),
}))

function makeBook(overrides: Partial<CarouselBook> = {}): CarouselBook {
  return {
    id: 1,
    title: 'Dune',
    hasCover: true,
    authors: ['Frank Herbert'],
    seriesIndex: null,
    isAudiobook: false,
    ...overrides,
  }
}

function mountCarousel(
  books: CarouselBook[],
  options: { loading?: boolean; showSeriesIndex?: boolean; currentBookId?: number | null; showHeader?: boolean } = {},
) {
  return mount(BookCarousel, {
    props: {
      books,
      loading: options.loading ?? false,
      showSeriesIndex: options.showSeriesIndex ?? false,
      currentBookId: options.currentBookId ?? null,
      showHeader: options.showHeader ?? true,
    },
    global: {
      stubs: { ChevronLeft: true, ChevronRight: true },
    },
  })
}

async function triggerCoverLoad(wrapper: ReturnType<typeof mountCarousel>, bookId: number, naturalWidth: number, naturalHeight: number) {
  const image = wrapper.find(`[data-book-id="${bookId}"] img`)
  if (!image.exists()) {
    throw new Error(`Expected cover image for book ${bookId}`)
  }
  Object.defineProperty(image.element, 'naturalWidth', { value: naturalWidth, configurable: true })
  Object.defineProperty(image.element, 'naturalHeight', { value: naturalHeight, configurable: true })
  await image.trigger('load')
}

const { bookSpineOverlay } = useDisplaySettings()

describe('BookCarousel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCoverLoadCache()
    bookSpineOverlay.value = 'off'
    mockRouterPush.mockReset()
  })

  afterEach(() => {
    bookSpineOverlay.value = 'off'
  })

  it('renders nothing when not loading and books array is empty', () => {
    const wrapper = mountCarousel([])
    expect(wrapper.find('[data-book-id]').exists()).toBe(false)
  })

  it('renders loading skeletons when loading is true', () => {
    const wrapper = mountCarousel([], { loading: true })
    const skeletons = wrapper.findAll('.animate-shimmer')
    expect(skeletons.length).toBe(10)
  })

  it('uses portrait ratio for loading skeletons', () => {
    const wrapper = mountCarousel([], { loading: true })
    const skeleton = wrapper.find('.animate-shimmer')
    expect(skeleton.attributes('style')).toContain('aspect-ratio: 2/3')
  })

  it('uses portrait ratio for rendered cards', () => {
    const wrapper = mountCarousel([makeBook()])
    const cover = wrapper.find('.book-cover-surface')
    expect(cover.attributes('style')).toContain('aspect-ratio: 2/3')
  })

  it('uses square ratio for audiobook cards', () => {
    const wrapper = mountCarousel([makeBook({ isAudiobook: true })])
    const cover = wrapper.find('.book-cover-surface')
    expect(cover.attributes('style')).toContain('aspect-ratio: 1/1')
  })

  it('renders audiobook cards wider than non-audiobook cards', () => {
    const wrapper = mountCarousel([makeBook({ id: 1, isAudiobook: false }), makeBook({ id: 2, isAudiobook: true })])
    const nonAudioCard = wrapper.find('[data-book-id="1"]')
    const audioCard = wrapper.find('[data-book-id="2"]')
    expect(nonAudioCard.classes()).toContain('w-30')
    expect(audioCard.classes()).toContain('w-38')
  })

  it('renders an img when book.hasCover is true', () => {
    const book = makeBook({ hasCover: true })
    const wrapper = mountCarousel([book])
    expect(wrapper.find('img').exists()).toBe(true)
  })

  it('renders BookCoverPlaceholder when book.hasCover is false', () => {
    const book = makeBook({ hasCover: false, title: 'Unknown', authors: [] })
    const wrapper = mountCarousel([book])
    expect(wrapper.find('[data-testid="placeholder"]').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('passes title to BookCoverPlaceholder', () => {
    const book = makeBook({ hasCover: false, title: 'Foundation', authors: [] })
    const wrapper = mountCarousel([book])
    const placeholder = wrapper.find('[data-testid="placeholder"]')
    expect(placeholder.attributes('data-title')).toBe('Foundation')
  })

  it('passes joined authors as authorLine to BookCoverPlaceholder', () => {
    const book = makeBook({ hasCover: false, authors: ['Isaac Asimov', 'Robert Heinlein'] })
    const wrapper = mountCarousel([book])
    const placeholder = wrapper.find('[data-testid="placeholder"]')
    expect(placeholder.attributes('data-author')).toBe('Isaac Asimov, Robert Heinlein')
  })

  it('passes null authorLine to BookCoverPlaceholder when authors array is empty', () => {
    const book = makeBook({ hasCover: false, authors: [] })
    const wrapper = mountCarousel([book])
    const placeholder = wrapper.find('[data-testid="placeholder"]')
    expect(placeholder.attributes('data-author')).toBeUndefined()
  })

  it('passes audiobook flag to BookCoverPlaceholder when recommendation is audiobook', () => {
    const wrapper = mountCarousel([makeBook({ hasCover: false, isAudiobook: true })])
    const placeholder = wrapper.find('[data-testid="placeholder"]')
    expect(placeholder.attributes('data-is-audio')).toBe('true')
  })

  it('defaults placeholder mode to non-audiobook when recommendation audiobook flag is missing', () => {
    const wrapper = mountCarousel([makeBook({ hasCover: false, isAudiobook: undefined })])
    const placeholder = wrapper.find('[data-testid="placeholder"]')
    expect(placeholder.attributes('data-is-audio')).toBe('false')
  })

  it('renders the correct cover image src when hasCover is true', () => {
    const book = makeBook({ id: 42, hasCover: true })
    const wrapper = mountCarousel([book])
    expect(wrapper.find('img').attributes('src')).toBe('/api/covers/42/thumbnail')
  })

  it('retries loading cover images for the same book id after a refresh', async () => {
    const wrapper = mountCarousel([makeBook({ id: 42, hasCover: true })])
    const image = wrapper.find('[data-book-id="42"] img')
    await image.trigger('error')
    expect(wrapper.find('[data-testid="placeholder"]').exists()).toBe(true)

    await wrapper.setProps({ books: [makeBook({ id: 42, hasCover: true, title: 'Retried' })] })
    expect(wrapper.find('[data-book-id="42"] img').exists()).toBe(true)
  })

  it('renders centered cover with blurred backdrop after non-audiobook cover image loads', async () => {
    const wrapper = mountCarousel([makeBook({ id: 42, hasCover: true, isAudiobook: false })])
    await triggerCoverLoad(wrapper, 42, 1000, 1000)

    const card = wrapper.find('[data-book-id="42"]')
    const images = card.findAll('img')
    expect(images).toHaveLength(2)
    const backdrop = images.at(0)
    const cover = images.at(1)
    expect(backdrop?.classes()).toContain('blur-md')
    expect(backdrop?.classes()).toContain('object-cover')
    expect(cover?.classes()).toContain('object-contain')
  })

  it('renders audiobook covers as square without blurred backdrop', async () => {
    const wrapper = mountCarousel([makeBook({ id: 42, hasCover: true, isAudiobook: true })])
    await triggerCoverLoad(wrapper, 42, 1000, 1000)

    const card = wrapper.find('[data-book-id="42"]')
    const images = card.findAll('img')
    expect(images).toHaveLength(1)
    expect(images[0]?.classes()).toContain('object-cover')
    expect(images[0]?.classes()).not.toContain('object-contain')
    expect(images[0]?.classes()).not.toContain('blur-md')
  })

  it('applies global spine overlay mode to non-audiobook recommendation covers', () => {
    bookSpineOverlay.value = 'strong'
    const wrapper = mountCarousel([makeBook({ hasCover: true, isAudiobook: false })])
    const cover = wrapper.find('.book-cover-surface')
    expect(cover.attributes('data-cover-spine')).toBe('strong')
  })

  it('forces spine overlay off for audiobook recommendation covers', () => {
    bookSpineOverlay.value = 'strong'
    const wrapper = mountCarousel([makeBook({ hasCover: true, isAudiobook: true })])
    const cover = wrapper.find('.book-cover-surface')
    expect(cover.attributes('data-cover-spine')).toBe('off')
  })

  it('defaults to global spine mode when recommendation audiobook flag is missing', () => {
    bookSpineOverlay.value = 'strong'
    const wrapper = mountCarousel([makeBook({ hasCover: true, isAudiobook: undefined })])
    const cover = wrapper.find('.book-cover-surface')
    expect(cover.attributes('data-cover-spine')).toBe('strong')
  })

  it('renders fitted spine layer only for non-audiobook covers with loaded artwork', async () => {
    const wrapper = mountCarousel([
      makeBook({ id: 1, hasCover: true, isAudiobook: false }),
      makeBook({ id: 2, hasCover: true, isAudiobook: true }),
      makeBook({ id: 3, hasCover: false, isAudiobook: false }),
    ])
    await triggerCoverLoad(wrapper, 1, 600, 900)
    await triggerCoverLoad(wrapper, 2, 900, 900)
    expect(wrapper.findAll('.book-cover-spine-layer')).toHaveLength(1)
  })

  it('shows series index badge when showSeriesIndex is true and seriesIndex is set', () => {
    const book = makeBook({ seriesIndex: 3 })
    const wrapper = mountCarousel([book], { showSeriesIndex: true })
    expect(wrapper.text()).toContain('#3')
  })

  it('does not show series index badge when showSeriesIndex is false', () => {
    const book = makeBook({ seriesIndex: 3 })
    const wrapper = mountCarousel([book], { showSeriesIndex: false })
    expect(wrapper.text()).not.toContain('#3')
  })

  it('does not show series index badge when seriesIndex is null', () => {
    const book = makeBook({ seriesIndex: null })
    const wrapper = mountCarousel([book], { showSeriesIndex: true })
    expect(wrapper.text()).not.toContain('#')
  })

  it('renders multiple books', () => {
    const books = [makeBook({ id: 1, hasCover: true }), makeBook({ id: 2, hasCover: false }), makeBook({ id: 3, hasCover: true })]
    const wrapper = mountCarousel(books)
    expect(wrapper.findAll('[data-book-id]').length).toBe(3)
    expect(wrapper.findAll('img').length).toBe(2)
    expect(wrapper.findAll('[data-testid="placeholder"]').length).toBe(3)
  })

  it('uses book id as seed when title is null', () => {
    const book = makeBook({ hasCover: false, title: null, id: 99 })
    const wrapper = mountCarousel([book])
    const placeholder = wrapper.find('[data-testid="placeholder"]')
    expect(placeholder.exists()).toBe(true)
  })

  it('applies data-book-id attribute for scroll-into-view behaviour', () => {
    const book = makeBook({ id: 77 })
    const wrapper = mountCarousel([book])
    expect(wrapper.find('[data-book-id="77"]').exists()).toBe(true)
  })

  it('navigates to book detail on card click', async () => {
    const wrapper = mountCarousel([makeBook({ id: 77 })])
    await wrapper.find('[data-book-id="77"]').trigger('click')
    expect(mockRouterPush).toHaveBeenCalledWith({ name: 'book-detail', params: { bookId: 77 } })
  })

  it('scrolls carousel left and right from header controls', async () => {
    const wrapper = mountCarousel([makeBook({ id: 1 }), makeBook({ id: 2 })])
    const scrollContainer = wrapper.find('.flex.gap-6.overflow-x-auto.pb-2')
    const scrollBy = vi.fn<(options: ScrollToOptions) => void>()
    Object.defineProperty(scrollContainer.element, 'scrollBy', { value: scrollBy, configurable: true })

    const buttons = wrapper.findAll('button')
    await buttons[0]?.trigger('click')
    await buttons[1]?.trigger('click')

    expect(scrollBy).toHaveBeenNthCalledWith(1, { left: -240, behavior: 'smooth' })
    expect(scrollBy).toHaveBeenNthCalledWith(2, { left: 240, behavior: 'smooth' })
  })

  it('auto-scrolls current book into view when currentBookId is provided', async () => {
    const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    })

    mountCarousel([makeBook({ id: 9 }), makeBook({ id: 10 })], { currentBookId: 10 })
    await Promise.resolve()
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'center', behavior: 'instant', block: 'nearest' })
  })
})
