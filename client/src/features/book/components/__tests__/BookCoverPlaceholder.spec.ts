import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BookCoverPlaceholder from '../BookCoverPlaceholder.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const width = ref(134)
const height = ref(201)

vi.mock('@vueuse/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vueuse/core')>()),
  useElementSize: () => ({ width, height }),
}))

function mountPlaceholder(props: Partial<InstanceType<typeof BookCoverPlaceholder>['$props']> = {}) {
  return mount(BookCoverPlaceholder, { props: { title: 'Dune', authorLine: 'Frank Herbert', seed: 'dune', ...props } })
}

describe('BookCoverPlaceholder', () => {
  const settings = useDisplaySettings()

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    width.value = 134
    height.value = 201
    settings.placeholderCoverStyle.value = 'bauhaus'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('draws the style chosen in display settings', async () => {
    const wrapper = mountPlaceholder()
    const art = wrapper.get('[data-testid="cover-placeholder-art"]')
    expect(art.attributes('data-placeholder-style')).toBe('bauhaus')
    expect(art.find('svg').exists()).toBe(true)

    settings.placeholderCoverStyle.value = 'paperback'
    await nextTick()
    expect(art.attributes('data-placeholder-style')).toBe('paperback')
  })

  it('lets a preview override the setting', () => {
    const wrapper = mountPlaceholder({ variant: 'memphis' })
    expect(wrapper.get('[data-testid="cover-placeholder-art"]').attributes('data-placeholder-style')).toBe('memphis')
  })

  it('is hidden from assistive technology', () => {
    expect(mountPlaceholder().get('[data-testid="cover-placeholder-art"]').attributes('aria-hidden')).toBe('true')
  })

  it('escapes book text', () => {
    const wrapper = mountPlaceholder({ title: '<img src=x onerror=alert(1)>' })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img')
  })

  it('draws nothing until it has a size', () => {
    width.value = 0
    height.value = 0
    expect(mountPlaceholder().get('[data-testid="cover-placeholder-art"]').html()).not.toContain('<svg')
  })

  it('uses the untitled label when the title is missing', () => {
    expect(mountPlaceholder({ title: null }).text()).toContain('Untitled')
  })
})
