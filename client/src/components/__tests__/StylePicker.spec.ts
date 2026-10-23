import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StylePicker from '../StylePicker.vue'

const themeStore = reactive({
  style: 'bookorbit',
  setStyle: vi.fn<(style: string) => void>((style: string) => {
    themeStore.style = style
  }),
})

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStore,
}))

describe('StylePicker', () => {
  beforeEach(() => {
    themeStore.style = 'bookorbit'
    themeStore.setStyle.mockClear()
  })

  it('offers every style with the current one pressed', () => {
    const wrapper = mount(StylePicker)
    const buttons = wrapper.findAll('button')

    expect(buttons.map((button) => button.text())).toEqual(['BookOrbit', 'Nostalgia'])
    expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('selects a style', async () => {
    const wrapper = mount(StylePicker)

    await wrapper.findAll('button')[1]!.trigger('click')

    expect(themeStore.setStyle).toHaveBeenCalledWith('nostalgia')
    expect(wrapper.findAll('button')[1]!.attributes('aria-pressed')).toBe('true')
  })
})
