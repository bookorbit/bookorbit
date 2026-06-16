import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BookCoverSurface from '../BookCoverSurface.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const { bookSpineOverlay, bookShadowStrength, bookCoverDisplayMode, showSpineOnComics } = useDisplaySettings()

afterEach(() => {
  bookSpineOverlay.value = 'off'
  bookShadowStrength.value = 'default'
  bookCoverDisplayMode.value = 'blurred-fit'
  showSpineOnComics.value = false
})

describe('BookCoverSurface', () => {
  it('applies base, size, and interactive classes', () => {
    const wrapper = mount(BookCoverSurface, {
      props: { size: 'mini', interactive: true },
      slots: { default: '<div class="content" />' },
    })

    expect(wrapper.classes()).toContain('book-cover-surface')
    expect(wrapper.classes()).toContain('book-cover-surface--mini')
    expect(wrapper.classes()).toContain('book-cover-surface--interactive')
    expect(wrapper.find('.content').exists()).toBe(true)
  })

  it('applies style mode data attributes from display settings', () => {
    bookSpineOverlay.value = 'strong'
    bookShadowStrength.value = 'strong'

    const wrapper = mount(BookCoverSurface)
    expect(wrapper.attributes('data-cover-spine')).toBe('strong')
    expect(wrapper.attributes('data-cover-shadow')).toBe('strong')
    expect(wrapper.attributes('data-cover-fit')).toBe('blurred-fit')
    expect(wrapper.attributes('data-cover-size')).toBe('default')
    expect(wrapper.attributes('data-cover-interactive')).toBe('false')
  })

  it('applies the selected cover display mode from display settings', async () => {
    const wrapper = mount(BookCoverSurface)
    bookCoverDisplayMode.value = 'natural-bottom'
    await wrapper.vm.$nextTick()

    expect(wrapper.attributes('data-cover-fit')).toBe('natural-bottom')
  })

  it('allows an explicit display mode override', () => {
    bookCoverDisplayMode.value = 'natural-bottom'
    const wrapper = mount(BookCoverSurface, {
      props: { displayMode: 'fill-crop' },
    })

    expect(wrapper.attributes('data-cover-fit')).toBe('fill-crop')
  })

  it('renders dynamic tag and forwards native attrs', () => {
    const wrapper = mount(BookCoverSurface, {
      props: { tag: 'button', interactive: true },
      attrs: { type: 'button', 'aria-label': 'cover' },
    })

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('aria-label')).toBe('cover')
  })

  it('forces spine overlay off when disableSpine is true', () => {
    bookSpineOverlay.value = 'strong'
    const wrapper = mount(BookCoverSurface, {
      props: { disableSpine: true },
    })

    expect(wrapper.attributes('data-cover-spine')).toBe('off')
  })

  it('forces spine overlay off for comics when showSpineOnComics is disabled', () => {
    bookSpineOverlay.value = 'strong'
    showSpineOnComics.value = false
    const wrapper = mount(BookCoverSurface, {
      props: { isComic: true },
    })

    expect(wrapper.attributes('data-cover-spine')).toBe('off')
  })

  it('keeps the spine overlay for comics when showSpineOnComics is enabled', () => {
    bookSpineOverlay.value = 'strong'
    showSpineOnComics.value = true
    const wrapper = mount(BookCoverSurface, {
      props: { isComic: true },
    })

    expect(wrapper.attributes('data-cover-spine')).toBe('strong')
  })

  it('does not affect non-comic covers when showSpineOnComics is disabled', () => {
    bookSpineOverlay.value = 'subtle'
    showSpineOnComics.value = false
    const wrapper = mount(BookCoverSurface, {
      props: { isComic: false },
    })

    expect(wrapper.attributes('data-cover-spine')).toBe('subtle')
  })
})
