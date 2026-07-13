import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import AccountAllSettings from '../AccountAllSettings.vue'

// --- Permission state ---
const permState = { isDemo: false }

const routerState = {
  currentQuery: {} as Record<string, string>,
  replacedQuery: null as Record<string, string> | null,
}

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routerState.currentQuery }),
  useRouter: () => ({
    replace: vi.fn<(to: { name: string; query: Record<string, string> }) => void>((to) => {
      routerState.replacedQuery = to.query
    }),
  }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isDemoRestrictedAccount: computed(() => permState.isDemo),
  }),
}))

vi.mock('../AccountSettings.vue', () => ({ default: { template: '<div data-testid="account-settings" />' } }))
vi.mock('../PrivacySharingSettings.vue', () => ({ default: { template: '<div data-testid="privacy-sharing-settings" />' } }))
vi.mock('@/features/notifications/components/NotificationPreferences.vue', () => ({
  default: { template: '<div data-testid="notification-preferences" />' },
}))

function mountComponent(queryTab?: string, isDemo = false) {
  permState.isDemo = isDemo
  routerState.currentQuery = queryTab ? { tab: queryTab } : {}
  routerState.replacedQuery = null
  return mount(AccountAllSettings)
}

describe('AccountAllSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('non-demo user', () => {
    it('sees Profile, Privacy, and Notifications tabs', () => {
      const wrapper = mountComponent()
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('Profile')
      expect(labels).toContain('Privacy & Sharing')
      expect(labels).toContain('Notifications')
    })

    it('defaults to profile tab and shows AccountSettings', () => {
      const wrapper = mountComponent()
      expect(wrapper.find('[data-testid="account-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="notification-preferences"]').exists()).toBe(false)
    })

    it('replaces URL with ?tab=profile on mount when no param', () => {
      mountComponent()
      expect(routerState.replacedQuery?.tab).toBe('profile')
    })

    it('shows NotificationPreferences when tab=notifications', () => {
      const wrapper = mountComponent('notifications')
      expect(wrapper.find('[data-testid="notification-preferences"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="account-settings"]').exists()).toBe(false)
    })

    it('shows AccountSettings when tab=profile', () => {
      const wrapper = mountComponent('profile')
      expect(wrapper.find('[data-testid="account-settings"]').exists()).toBe(true)
    })

    it('shows PrivacySharingSettings when tab=privacy', () => {
      const wrapper = mountComponent('privacy')
      expect(wrapper.find('[data-testid="privacy-sharing-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="account-settings"]').exists()).toBe(false)
    })

    it('falls back to profile for unknown tab', () => {
      const wrapper = mountComponent('unknown')
      expect(wrapper.find('[data-testid="account-settings"]').exists()).toBe(true)
    })
  })

  describe('demo-restricted user', () => {
    it('keeps Privacy available while hiding Notifications', () => {
      const wrapper = mountComponent(undefined, true)
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('Profile')
      expect(labels).toContain('Privacy & Sharing')
      expect(labels).not.toContain('Notifications')
    })

    it('defaults to profile', () => {
      const wrapper = mountComponent(undefined, true)
      expect(wrapper.find('[data-testid="account-settings"]').exists()).toBe(true)
    })

    it('falls back to profile when notifications tab is requested', () => {
      const wrapper = mountComponent('notifications', true)
      expect(wrapper.find('[data-testid="account-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="notification-preferences"]').exists()).toBe(false)
    })
  })

  describe('tab navigation', () => {
    it('active tab button has border-primary class', () => {
      const wrapper = mountComponent('profile')
      const profileBtn = wrapper.findAll('button').find((b) => b.text() === 'Profile')
      expect(profileBtn?.classes()).toContain('border-primary')
    })

    it('inactive tab button has border-transparent class', () => {
      const wrapper = mountComponent('profile')
      const notifBtn = wrapper.findAll('button').find((b) => b.text() === 'Notifications')
      expect(notifBtn?.classes()).toContain('border-transparent')
    })

    it('clicking Notifications tab switches to NotificationPreferences', async () => {
      permState.isDemo = false
      routerState.currentQuery = { tab: 'profile' }
      const wrapper = mount(AccountAllSettings)

      const notifBtn = wrapper.findAll('button').find((b) => b.text() === 'Notifications')
      await notifBtn!.trigger('click')

      expect(wrapper.find('[data-testid="notification-preferences"]').exists()).toBe(true)
    })

    it('clicking a tab calls router.replace with the correct tab', async () => {
      permState.isDemo = false
      routerState.currentQuery = { tab: 'profile' }
      routerState.replacedQuery = null
      const wrapper = mount(AccountAllSettings)

      const notifBtn = wrapper.findAll('button').find((b) => b.text() === 'Notifications')
      await notifBtn!.trigger('click')

      expect(routerState.replacedQuery!['tab']).toBe('notifications')
    })

    it('does not replace URL when tab param already set', () => {
      mountComponent('notifications')
      expect(routerState.replacedQuery).toBeNull()
    })
  })
})
