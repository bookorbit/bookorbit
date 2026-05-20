import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BookCoverSurface from '../BookCoverSurface.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const { bookSpineOverlay, bookShadowStrength } = useDisplaySettings()

afterEach(() => {
  bookSpineOverlay.value = 'off'
  bookShadowStrength.value = 'default'
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
    expect(wrapper.attributes('data-cover-size')).toBe('default')
    expect(wrapper.attributes('data-cover-interactive')).toBe('false')
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
})
