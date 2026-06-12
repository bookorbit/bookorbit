import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { BookCoverDisplayMode } from '@bookorbit/types'
import { COVER_ASPECT_RATIO_KEY } from '@/features/book/lib/cover-aspect-ratio'
import { clearCoverLoadCache } from '@/features/book/lib/cover-load-cache'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import BookCoverArtwork from '../BookCoverArtwork.vue'

const { bookCoverDisplayMode } = useDisplaySettings()

function mountArtwork(
  options: {
    mode?: BookCoverDisplayMode
    hasCover?: boolean
    src?: string | null
    frameAspectRatio?: string
    spine?: boolean
  } = {},
) {
  return mount(BookCoverArtwork, {
    props: {
      src: options.src ?? '/cover.jpg',
      hasCover: options.hasCover ?? true,
      title: 'Dune',
      authorLine: 'Frank Herbert',
      isAudio: false,
      seed: 'Dune',
      alt: 'Dune cover',
      mode: options.mode,
      frameAspectRatio: options.frameAspectRatio,
      spine: options.spine,
    },
    global: {
      provide: {
        [COVER_ASPECT_RATIO_KEY as symbol]: ref('2/3'),
      },
      stubs: {
        BookCoverPlaceholder: {
          name: 'BookCoverPlaceholder',
          props: ['title', 'authorLine', 'isAudio', 'seed'],
          template: '<div data-testid="placeholder" :data-title="title" :data-author="authorLine" />',
        },
      },
    },
  })
}

async function triggerMainImageLoad(wrapper: ReturnType<typeof mountArtwork>, naturalWidth: number, naturalHeight: number) {
  const image = wrapper.findAll('img').find((img) => img.attributes('alt') === 'Dune cover')
  if (!image) throw new Error('Expected main cover image')
  Object.defineProperty(image.element, 'naturalWidth', { value: naturalWidth, configurable: true })
  Object.defineProperty(image.element, 'naturalHeight', { value: naturalHeight, configurable: true })
  await image.trigger('load')
  await nextTick()
  return image
}

beforeEach(() => {
  clearCoverLoadCache()
})

afterEach(() => {
  bookCoverDisplayMode.value = 'blurred-fit'
})

describe('BookCoverArtwork', () => {
  it('renders a placeholder when the book has no cover', () => {
    const wrapper = mountArtwork({ hasCover: false })

    expect(wrapper.find('[data-testid="placeholder"]').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('renders blurred-fit covers with an object-contain image and backdrop after load', async () => {
    const wrapper = mountArtwork({ mode: 'blurred-fit' })

    const image = await triggerMainImageLoad(wrapper, 600, 900)

    expect(image.classes()).toContain('object-contain')
    expect(wrapper.emitted('load')?.[0]).toEqual([600 / 900])
    const images = wrapper.findAll('img')
    expect(images).toHaveLength(2)
    expect(images[0]?.classes()).toContain('blur-md')
    expect(wrapper.find('.book-cover-spine-layer').exists()).toBe(true)
  })

  it('renders fill-crop covers without a blurred backdrop', async () => {
    const wrapper = mountArtwork({ mode: 'fill-crop' })

    const image = await triggerMainImageLoad(wrapper, 600, 900)

    expect(image.classes()).toContain('object-cover')
    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.find('.book-cover-artwork-frame--full').exists()).toBe(true)
  })

  it('bottom-aligns landscape natural covers inside the slot', async () => {
    const wrapper = mountArtwork({ mode: 'natural-bottom' })

    await triggerMainImageLoad(wrapper, 1200, 600)

    const frame = wrapper.find('.book-cover-artwork-frame--natural')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('style')).toContain('height:')
    expect(frame.attributes('style')).toContain('bottom: 0')
    expect(frame.attributes('style')).not.toContain('translateY')
  })

  it('centers narrow natural covers while preserving full height', async () => {
    const wrapper = mountArtwork({ mode: 'natural-bottom' })

    await triggerMainImageLoad(wrapper, 400, 800)

    const frame = wrapper.find('.book-cover-artwork-frame--natural')
    expect(frame.attributes('style')).toContain('width: 75%')
    expect(frame.attributes('style')).toContain('height: 100%')
    expect(frame.attributes('style')).toContain('translateX(-50%)')
  })

  it('uses the global display mode when no explicit mode is provided', async () => {
    bookCoverDisplayMode.value = 'fill-crop'
    const wrapper = mountArtwork()

    const image = await triggerMainImageLoad(wrapper, 600, 900)

    expect(image.classes()).toContain('object-cover')
    expect(wrapper.findAll('img')).toHaveLength(1)
  })

  it('falls back to the placeholder on image error and retries after resetKey changes', async () => {
    const wrapper = mountArtwork()
    const image = wrapper.find('img[alt="Dune cover"]')

    await image.trigger('error')
    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.find('[data-testid="placeholder"]').exists()).toBe(true)

    await wrapper.setProps({ resetKey: 'retry-1' })
    expect(wrapper.find('img[alt="Dune cover"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="placeholder"]').exists()).toBe(true)
  })

  it('does not render the fitted spine layer when spine is disabled', async () => {
    const wrapper = mountArtwork({ spine: false })

    await triggerMainImageLoad(wrapper, 600, 900)

    expect(wrapper.find('.book-cover-spine-layer').exists()).toBe(false)
  })

  describe('cover load cache (anti-flicker)', () => {
    it('shows the skeleton and fade-in for a cover that has never loaded', () => {
      const wrapper = mountArtwork({ src: '/fresh-cover.jpg' })
      const image = wrapper.find('img[alt="Dune cover"]')

      expect(image.classes()).toContain('opacity-0')
      expect(image.classes()).toContain('transition-opacity')
      expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    })

    it('skips the skeleton and fade for a cached cover after pool reassignment', async () => {
      const first = mountArtwork({ src: '/cached-cover.jpg' })
      await triggerMainImageLoad(first, 600, 900)

      const second = mountArtwork({ src: '/cached-cover.jpg' })
      const image = second.find('img[alt="Dune cover"]')

      expect(image.classes()).toContain('opacity-100')
      expect(image.classes()).not.toContain('transition-opacity')
      expect(second.find('.animate-pulse').exists()).toBe(false)
    })

    it('restores instantly when src changes to an already-loaded cover', async () => {
      const warm = mountArtwork({ src: '/warm.jpg' })
      await triggerMainImageLoad(warm, 600, 900)

      const wrapper = mountArtwork({ src: '/cold.jpg' })
      expect(wrapper.find('img[alt="Dune cover"]').classes()).toContain('opacity-0')

      await wrapper.setProps({ src: '/warm.jpg' })
      const image = wrapper.find('img[alt="Dune cover"]')
      expect(image.classes()).toContain('opacity-100')
      expect(wrapper.find('.animate-pulse').exists()).toBe(false)
    })

    it('still shows the skeleton when src changes to an unseen cover', async () => {
      const wrapper = mountArtwork({ src: '/seen.jpg' })
      await triggerMainImageLoad(wrapper, 600, 900)

      await wrapper.setProps({ src: '/never-seen.jpg' })
      const image = wrapper.find('img[alt="Dune cover"]')
      expect(image.classes()).toContain('opacity-0')
      expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    })
  })
})
