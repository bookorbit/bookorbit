import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GlowReachPicker from '../GlowReachPicker.vue'

const themeStore = reactive({
  glowReach: 100,
  setGlowReach: vi.fn<(reach: number) => void>((reach: number) => {
    themeStore.glowReach = reach
  }),
})

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStore,
}))

describe('GlowReachPicker', () => {
  beforeEach(() => {
    themeStore.glowReach = 100
    themeStore.setGlowReach.mockClear()
  })

  it('shows the reach as a percentage', () => {
    const wrapper = mount(GlowReachPicker)

    expect(wrapper.get('input').attributes('aria-valuetext')).toBe('100%')
    expect(wrapper.text()).toContain('100%')
  })

  it('sets the reach from the slider and reads Off at zero', async () => {
    const wrapper = mount(GlowReachPicker)
    const input = wrapper.get('input')

    await input.setValue('0')

    expect(themeStore.setGlowReach).toHaveBeenCalledWith(0)
    expect(wrapper.text()).toContain('Off')
    expect(input.attributes('aria-valuetext')).toBe('Off')
  })
})
