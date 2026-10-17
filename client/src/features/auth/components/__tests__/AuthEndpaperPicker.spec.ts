import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<span hidden><slot /></span>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

async function mountPicker() {
  const { default: AuthEndpaperPicker } = await import('../AuthEndpaperPicker.vue')
  return mount(AuthEndpaperPicker)
}

describe('AuthEndpaperPicker', () => {
  it('offers every endpaper by name and marks waves as the default', async () => {
    const wrapper = await mountPicker()
    const buttons = wrapper.findAll('button')

    expect(buttons.map((b) => b.attributes('aria-label'))).toEqual([
      'Waves',
      'Linked circles',
      'Hemp leaf',
      'Quatrefoil',
      'Ogee',
      'Harlequin',
      'Greek key',
      'Plain',
    ])
    expect(wrapper.get('button[aria-label="Waves"]').attributes('aria-pressed')).toBe('true')
  })

  it('remembers the chosen endpaper in this browser', async () => {
    const wrapper = await mountPicker()

    await wrapper.get('button[aria-label="Hemp leaf"]').trigger('click')

    expect(wrapper.get('button[aria-label="Hemp leaf"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('button[aria-label="Waves"]').attributes('aria-pressed')).toBe('false')
    expect(JSON.parse(localStorage.getItem('authEndpaper') ?? 'null')).toBe('asanoha')
  })

  it('falls back to waves when the stored endpaper is unknown', async () => {
    localStorage.setItem('authEndpaper', JSON.stringify('marbled'))
    const { useEndpaper } = await import('../../composables/useEndpaper')

    expect(useEndpaper().endpaper.value).toBe('seigaiha')
  })
})
