import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import SettingsView from '@/views/SettingsView.vue'

const routeState = reactive<{ name: string; meta: Record<string, unknown> }>({
  name: 'settings-appearance-layout',
  meta: {},
})

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

function mountView(routeName: string, meta: Record<string, unknown> = {}) {
  routeState.name = routeName
  routeState.meta = meta
  return mount(SettingsView, {
    global: {
      stubs: {
        RouterView: { template: '<div data-testid="settings-outlet" />' },
      },
    },
  })
}

describe('SettingsView shell', () => {
  it('renders a single column page without a second navigation pane', () => {
    const wrapper = mountView('settings-appearance-layout')
    expect(wrapper.find('[data-testid="settings-page-header"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-outlet"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'SettingsNav' }).exists()).toBe(false)
  })

  it('builds a breadcrumb from the group and parent of the active page', () => {
    const text = mountView('settings-appearance-layout').text()
    expect(text).toContain('You')
    expect(text).toContain('Display')
  })

  it('shows the page title and description for pages without their own header', () => {
    const text = mountView('settings-metadata-providers').text()
    expect(text).toContain('Providers')
    expect(text).toContain('Enable external metadata sources')
  })

  it('uses compact, consistent spacing below the shared page header', () => {
    const content = mountView('settings-account-profile').get('[data-testid="settings-page-content"]')

    expect(content.classes()).toContain('pt-4')
    expect(content.classes()).toContain('md:pt-5')
    expect(content.classes()).toContain('pb-6')
  })

  it.each([
    ['settings-reader-fonts', 'Fonts available while reading.'],
    ['settings-libraries', 'Scan paths, watched folders, and ingest rules.'],
    ['settings-kobo', 'Sync endpoint, store proxy, and shelf mapping.'],
    ['settings-koreader', 'Progress sync and document matching.'],
    ['settings-opds', 'Catalog feeds for third-party reading apps.'],
    ['settings-email', 'SMTP delivery and send-to-device addresses.'],
  ])('renders the shared shell header for %s', (routeName, description) => {
    const wrapper = mountView(routeName)
    expect(wrapper.find('.settings-title').exists()).toBe(true)
    expect(wrapper.find('.settings-subtitle').text()).toBe(description)
  })

  it('applies the route width so wide pages are not squeezed', () => {
    const wrapper = mountView('settings-admin-audit-log', { maxWidth: 'max-w-[96rem]' })
    expect(wrapper.html()).toContain('max-w-[96rem]')
  })

  it('falls back to the default width when the route does not set one', () => {
    const wrapper = mountView('settings-appearance-layout')
    expect(wrapper.html()).toContain('max-w-3xl')
  })
})
