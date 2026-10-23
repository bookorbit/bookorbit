import { mount } from '@vue/test-utils'
import { h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SURFACE_PALETTE_IDS } from '@bookorbit/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import SurfacePalettePicker from '../SurfacePalettePicker.vue'

const themeStore = reactive({
  surfacePalette: 'ash',
  setSurfacePalette: vi.fn<(palette: string) => void>((palette: string) => {
    themeStore.surfacePalette = palette
  }),
})

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStore,
}))

function mountPicker() {
  return mount(TooltipProvider, { slots: { default: () => h(SurfacePalettePicker) } })
}

describe('SurfacePalettePicker', () => {
  beforeEach(() => {
    themeStore.surfacePalette = 'ash'
    themeStore.setSurfacePalette.mockClear()
  })

  it('renders one labelled swatch per palette, each previewing its own palette', () => {
    const swatches = mountPicker().findAll('button')

    expect(swatches.map((swatch) => swatch.attributes('data-surface'))).toEqual([...SURFACE_PALETTE_IDS])
    const ash = swatches.find((swatch) => swatch.attributes('data-surface') === 'ash')!
    expect(ash.attributes('aria-label')).toBe('Ash')
    expect(ash.attributes('aria-pressed')).toBe('true')
    expect(ash.classes()).toContain('outline-primary')
    expect(ash.find('svg').exists()).toBe(true)
    expect(swatches.filter((swatch) => swatch.classes().includes('outline-primary'))).toHaveLength(1)
    expect(swatches.filter((swatch) => swatch.find('svg').exists())).toHaveLength(1)
  })

  it('selects a palette', async () => {
    const wrapper = mountPicker()

    await wrapper.get('button[data-surface="sepia"]').trigger('click')

    expect(themeStore.setSurfacePalette).toHaveBeenCalledWith('sepia')
    expect(wrapper.get('button[data-surface="sepia"]').classes()).toContain('outline-primary')
    expect(wrapper.get('button[data-surface="ash"]').classes()).not.toContain('outline-primary')
    expect(wrapper.text()).toContain('Sepia')
  })
})
