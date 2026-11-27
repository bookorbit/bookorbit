import { mount } from '@vue/test-utils'
import { h, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GLOW_TEXTURE_IDS, type GlowTexture } from '@bookorbit/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import GlowTexturePicker from '../GlowTexturePicker.vue'

const themeStore = reactive({
  glowTexture: 'galaxy' as GlowTexture,
  setGlowTexture: vi.fn<(texture: GlowTexture) => void>((texture: GlowTexture) => {
    themeStore.glowTexture = texture
  }),
})

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStore,
}))

describe('GlowTexturePicker', () => {
  beforeEach(() => {
    themeStore.glowTexture = 'galaxy'
    themeStore.setGlowTexture.mockClear()
  })

  it('renders one named option per texture, each tile previewing its own texture', () => {
    const wrapper = mount(GlowTexturePicker)
    const options = wrapper.findAll('button')

    expect(options.map((option) => option.get('.glow-texture-tile').attributes('data-glow-texture'))).toEqual([...GLOW_TEXTURE_IDS])
    expect(options.map((option) => option.attributes('aria-label'))).toEqual([
      'Galaxy',
      'Warp',
      'Starfield',
      'Constellations',
      'Star trails',
      'Milky Way',
      'Squares',
      'None',
    ])
    expect(options.filter((option) => option.attributes('aria-pressed') === 'true').map((option) => option.text())).toEqual(['Galaxy'])
  })

  it('selects a texture', async () => {
    const wrapper = mount(GlowTexturePicker)

    await wrapper.get('button[aria-label="Warp"]').trigger('click')

    expect(themeStore.setGlowTexture).toHaveBeenCalledWith('warp')
    expect(wrapper.get('button[aria-label="Warp"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('button[aria-label="Galaxy"]').attributes('aria-pressed')).toBe('false')
  })

  it('drops the visible names in compact menus but keeps every option labelled and selectable', async () => {
    const wrapper = mount(TooltipProvider, { slots: { default: () => h(GlowTexturePicker, { compact: true }) } })
    const options = wrapper.findAll('button')

    expect(options).toHaveLength(GLOW_TEXTURE_IDS.length)
    expect(options.every((option) => option.text() === '')).toBe(true)
    expect(options.map((option) => option.attributes('aria-label'))).toContain('Star trails')

    await wrapper.get('button[aria-label="Squares"]').trigger('click')

    expect(themeStore.setGlowTexture).toHaveBeenCalledWith('squares')
    expect(wrapper.get('button[aria-label="Squares"]').attributes('aria-pressed')).toBe('true')
  })
})
