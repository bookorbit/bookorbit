import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ThemePicker from '../ThemePicker.vue'

const themeStore = reactive({
  theme: 'system',
  setTheme: vi.fn<(theme: string) => void>((theme: string) => {
    themeStore.theme = theme
  }),
})

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStore,
}))

describe('ThemePicker', () => {
  beforeEach(() => {
    themeStore.theme = 'system'
    themeStore.setTheme.mockClear()
  })

  it('renders light, dark, and system choices with system selected', () => {
    const wrapper = mount(ThemePicker)
    const buttons = wrapper.findAll('button')

    expect(buttons.map((button) => button.text())).toEqual(['Light', 'Dark', 'System'])
    expect(buttons[2]!.classes()).toContain('bg-background')
  })

  it.each([
    { label: 'Light', theme: 'light' },
    { label: 'Dark', theme: 'dark' },
    { label: 'System', theme: 'system' },
  ])('sets $theme when $label is selected', async ({ label, theme }) => {
    const wrapper = mount(ThemePicker)
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === label)

    await button!.trigger('click')

    expect(themeStore.setTheme).toHaveBeenCalledWith(theme)
    expect(themeStore.theme).toBe(theme)
  })
})
