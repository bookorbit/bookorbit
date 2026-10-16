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

function mountToolbar() {
  return mount(TooltipProvider, {
    props: { delayDuration: 0 },
    slots: { default: () => h(AuthAppearanceToolbar) },
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
  it('names the current language on its picker button', () => {
    wrapper = mountToolbar()

    expect(wrapper.get('[data-testid="auth-language-control"]').attributes('aria-label')).toBe('Language')
    expect(wrapper.get('[data-testid="auth-language-control"]').text()).toContain('English')
  })

  it('offers an endpaper picker in place of the app background and corner pickers', async () => {
    wrapper = mountToolbar()

    expect(wrapper.find('button[aria-label="Change background"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Change corner radius"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="Change endpaper"]').trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Greek key"]')!.click()
    await flushPromises()

    expect(JSON.parse(localStorage.getItem('authEndpaper') ?? 'null')).toBe('greek-key')
  })

  it('toggles between light and dark', async () => {
    wrapper = mountToolbar()
    const store = useThemeStore()

    await wrapper.get('button[aria-label="Switch to dark"]').trigger('click')

    expect(store.resolvedTheme).toBe('dark')
    expect(wrapper.find('button[aria-label="Switch to light"]').exists()).toBe(true)
  })
})
