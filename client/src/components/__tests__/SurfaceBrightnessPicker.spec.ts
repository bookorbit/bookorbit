import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SurfaceBrightnessPicker from '../SurfaceBrightnessPicker.vue'

const themeStore = reactive({
  brightness: 35,
  setBrightness: vi.fn<(brightness: number) => void>((brightness: number) => {
    themeStore.brightness = brightness
  }),
})

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStore,
}))

describe('SurfaceBrightnessPicker', () => {
  beforeEach(() => {
    themeStore.brightness = 35
    themeStore.setBrightness.mockClear()
  })

  it('renders the current brightness as an accessible percentage', () => {
    const wrapper = mount(SurfaceBrightnessPicker)
    const input = wrapper.get('input[type="range"]')

    expect(input.attributes('min')).toBe('0')
    expect(input.attributes('max')).toBe('100')
    expect(input.attributes('step')).toBe('5')
    expect(input.attributes('aria-label')).toBe('Surface brightness')
    expect(input.attributes('aria-valuetext')).toBe('35%')
    expect(wrapper.text()).toBe('35%')
  })

  it('updates the shared theme brightness preference', async () => {
    const wrapper = mount(SurfaceBrightnessPicker)

    await wrapper.get('input[type="range"]').setValue(60)

    expect(themeStore.setBrightness).toHaveBeenCalledWith(60)
    expect(wrapper.text()).toBe('60%')
  })
})
