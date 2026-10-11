import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useThemeStore } from '@/stores/theme'
import AuthAppearanceToolbar from '../AuthAppearanceToolbar.vue'

let wrapper: VueWrapper | null = null

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mountToolbar(placement: 'top' | 'bottom') {
  return mount(TooltipProvider, {
    props: { delayDuration: 0 },
    slots: { default: () => h(AuthAppearanceToolbar, { placement }) },
    attachTo: document.body,
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal(
    'matchMedia',
    vi.fn<(query: string) => Pick<MediaQueryList, 'matches' | 'media' | 'addEventListener' | 'removeEventListener'>>((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn<MediaQueryList['addEventListener']>(),
      removeEventListener: vi.fn<MediaQueryList['removeEventListener']>(),
    })),
  )
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('AuthAppearanceToolbar', () => {
  it.each([
    { placement: 'top', edge: 'top-5' },
    { placement: 'bottom', edge: 'bottom-5' },
  ] as const)('pins to the $placement edge', ({ placement, edge }) => {
    wrapper = mountToolbar(placement)

    expect(wrapper.get('.fixed').classes()).toContain(edge)
  })

  it('toggles between light and dark', async () => {
    wrapper = mountToolbar('top')
    const store = useThemeStore()

    await wrapper.get('button[aria-label="Switch to dark"]').trigger('click')

    expect(store.resolvedTheme).toBe('dark')
    expect(wrapper.find('button[aria-label="Switch to light"]').exists()).toBe(true)
  })

  it('picks a corner radius from its popover', async () => {
    wrapper = mountToolbar('bottom')
    const store = useThemeStore()

    await wrapper.get('button[aria-label="Change corner radius"]').trigger('click')
    await flushPromises()
    const pill = document.body.querySelector<HTMLButtonElement>('button[aria-label="Pill-shaped corners"]')
    pill!.click()

    expect(store.radius).toBe('pill')
  })

  it('picks a background from its popover', async () => {
    wrapper = mountToolbar('bottom')
    const store = useThemeStore()

    await wrapper.get('button[aria-label="Change background"]').trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Aurora"]')!.click()

    expect(store.background).toBe('aurora')
  })
})
