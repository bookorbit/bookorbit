import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import IntegrationsAllSettings from '../IntegrationsAllSettings.vue'

// --- Router mock state ---
const routerState = {
  currentQuery: {} as Record<string, string>,
  replacedQuery: null as Record<string, string> | null,
}

vi.mock('vue-router', () => ({
  useRoute: () => ({
    query: routerState.currentQuery,
  }),
  useRouter: () => ({
    replace: vi.fn<(to: { name: string; query: Record<string, string> }) => void>((to) => {
      routerState.replacedQuery = to.query
    }),
  }),
}))

vi.mock('../KoboSettings.vue', () => ({ default: { template: '<div data-testid="kobo-settings" />' } }))
vi.mock('../KoreaderSettings.vue', () => ({ default: { template: '<div data-testid="koreader-settings" />' } }))
vi.mock('@/features/hardcover/components/HardcoverSettings.vue', () => ({
  default: { template: '<div data-testid="hardcover-settings" />' },
}))
vi.mock('../SettingsPageHeader.vue', () => ({ default: { template: '<div />' } }))

function mountComponent(queryTab?: string) {
  routerState.currentQuery = queryTab ? { tab: queryTab } : {}
  routerState.replacedQuery = null
  return mount(IntegrationsAllSettings)
}

describe('IntegrationsAllSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('default tab', () => {
    it('shows kobo tab content when no ?tab param is present', () => {
      const wrapper = mountComponent()
      expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(true)
    })

    it('replaces URL with ?tab=kobo when no tab param is present', () => {
      mountComponent()
      expect(routerState.replacedQuery?.tab).toBe('kobo')
    })

    it('does not replace URL when tab param is already set', () => {
      mountComponent('koreader')
      expect(routerState.replacedQuery).toBeNull()
    })
  })

  describe('tab rendering', () => {
    it('renders KoboSettings when tab=kobo', () => {
      const wrapper = mountComponent('kobo')
      expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="koreader-settings"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="hardcover-settings"]').exists()).toBe(false)
    })

    it('renders KoreaderSettings when tab=koreader', () => {
      const wrapper = mountComponent('koreader')
      expect(wrapper.find('[data-testid="koreader-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(false)
    })

    it('renders HardcoverSettings when tab=hardcover', () => {
      const wrapper = mountComponent('hardcover')
      expect(wrapper.find('[data-testid="hardcover-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(false)
    })

    it('falls back to kobo for unknown tab value', () => {
      const wrapper = mountComponent('unknown-tab')
      expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(true)
    })
  })

  describe('tab navigation', () => {
    it('renders three tab buttons', () => {
      const wrapper = mountComponent('kobo')
      const buttons = wrapper.findAll('button')
      expect(buttons).toHaveLength(3)
    })

    it('tab buttons have correct labels', () => {
      const wrapper = mountComponent('kobo')
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('Kobo')
      expect(labels).toContain('KOReader')
      expect(labels).toContain('Hardcover')
    })

    it('active tab button has border-primary class', () => {
      const wrapper = mountComponent('kobo')
      const koboBtn = wrapper.findAll('button').find((b) => b.text() === 'Kobo')
      expect(koboBtn?.classes()).toContain('border-primary')
    })

    it('inactive tab buttons have border-transparent class', () => {
      const wrapper = mountComponent('kobo')
      const koreaderBtn = wrapper.findAll('button').find((b) => b.text() === 'KOReader')
      expect(koreaderBtn?.classes()).toContain('border-transparent')
    })

    it('clicking a tab button calls router.replace with the correct tab', async () => {
      routerState.currentQuery = { tab: 'kobo' }
      routerState.replacedQuery = null
      const wrapper = mount(IntegrationsAllSettings)

      const koreaderBtn = wrapper.findAll('button').find((b) => b.text() === 'KOReader')
      await koreaderBtn!.trigger('click')

      expect(routerState.replacedQuery!['tab']).toBe('koreader')
    })

    it('clicking a tab updates the displayed component', async () => {
      routerState.currentQuery = { tab: 'kobo' }
      const wrapper = mount(IntegrationsAllSettings)

      expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(true)

      const hardcoverBtn = wrapper.findAll('button').find((b) => b.text() === 'Hardcover')
      await hardcoverBtn!.trigger('click')

      expect(wrapper.find('[data-testid="hardcover-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(false)
    })
  })

  describe('tab nav sticky bar', () => {
    it('tab nav container has sticky class', () => {
      const wrapper = mountComponent('kobo')
      const nav = wrapper.find('div.sticky')
      expect(nav.exists()).toBe(true)
    })

    it('tab nav container has z-20 class', () => {
      const wrapper = mountComponent('kobo')
      const nav = wrapper.find('div.z-20')
      expect(nav.exists()).toBe(true)
    })
  })
})
