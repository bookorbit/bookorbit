import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import AdminAllSettings from '../AdminAllSettings.vue'

// --- Permission state ---
const permState = {
  isSuperuser: false,
  permissions: [] as string[],
}

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
    isSuperuser: computed(() => permState.isSuperuser),
    userPermissions: computed(() => permState.permissions),
  }),
}))

vi.mock('@/features/admin/UsersPage.vue', () => ({ default: { template: '<div data-testid="users-page" />' } }))
vi.mock('@/features/admin/AccountActivityPage.vue', () => ({ default: { template: '<div data-testid="account-activity-page" />' } }))
vi.mock('../MagicLinksSettings.vue', () => ({
  default: {
    name: 'MagicLinksSettings',
    props: {
      withHeader: Boolean,
      withEmbeddedCreateAction: Boolean,
    },
    template: '<div data-testid="magic-links-settings" />',
  },
}))
vi.mock('../OidcSettings.vue', () => ({ default: { template: '<div data-testid="oidc-settings" />' } }))
vi.mock('../SettingsPageHeader.vue', () => ({ default: { template: '<div />' } }))

function mountComponent(queryTab?: string, opts?: { su?: boolean; perms?: string[] }) {
  permState.isSuperuser = opts?.su ?? false
  permState.permissions = opts?.perms ?? []
  routerState.currentQuery = queryTab ? { tab: queryTab } : {}
  routerState.replacedQuery = null
  return mount(AdminAllSettings)
}

describe('AdminAllSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('superuser', () => {
    it('sees Users, Account Activity, Magic Links, and OIDC tabs', () => {
      const wrapper = mountComponent(undefined, { su: true })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('Users')
      expect(labels).toContain('Account Activity')
      expect(labels).toContain('Magic Links')
      expect(labels).toContain('OIDC / SSO')
    })

    it('defaults to users tab', () => {
      const wrapper = mountComponent(undefined, { su: true })
      expect(wrapper.find('[data-testid="users-page"]').exists()).toBe(true)
    })

    it('renders OidcSettings when tab=oidc', () => {
      const wrapper = mountComponent('oidc', { su: true })
      expect(wrapper.find('[data-testid="oidc-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="users-page"]').exists()).toBe(false)
    })

    it('renders UsersPage when tab=users', () => {
      const wrapper = mountComponent('users', { su: true })
      expect(wrapper.find('[data-testid="users-page"]').exists()).toBe(true)
    })

    it('renders MagicLinksSettings when tab=magic-links', () => {
      const wrapper = mountComponent('magic-links', { su: true })
      expect(wrapper.find('[data-testid="magic-links-settings"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="users-page"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="oidc-settings"]').exists()).toBe(false)
    })

    it('enables MagicLinksSettings embedded create action in the admin tab', () => {
      const wrapper = mountComponent('magic-links', { su: true })
      const magicLinksSettings = wrapper.findComponent({ name: 'MagicLinksSettings' })

      expect(magicLinksSettings.props('withHeader')).toBe(false)
      expect(magicLinksSettings.props('withEmbeddedCreateAction')).toBe(true)
    })
  })

  describe('user with manage_users only', () => {
    it('sees only Users tab', () => {
      const wrapper = mountComponent(undefined, { perms: ['manage_users'] })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('Users')
      expect(labels).not.toContain('Magic Links')
      expect(labels).not.toContain('OIDC / SSO')
      expect(labels).not.toContain('Account Activity')
    })

    it('defaults to users tab and shows UsersPage', () => {
      const wrapper = mountComponent(undefined, { perms: ['manage_users'] })
      expect(wrapper.find('[data-testid="users-page"]').exists()).toBe(true)
    })

    it('falls back to users when oidc tab is requested but not permitted', () => {
      const wrapper = mountComponent('oidc', { perms: ['manage_users'] })
      expect(wrapper.find('[data-testid="users-page"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="oidc-settings"]').exists()).toBe(false)
    })
  })

  describe('user with view_user_activity only', () => {
    it('sees and defaults to only the Account Activity tab', () => {
      const wrapper = mountComponent(undefined, { perms: ['view_user_activity'] })
      const labels = wrapper.findAll('button').map((button) => button.text())

      expect(labels).toEqual(['Account Activity'])
      expect(wrapper.find('[data-testid="account-activity-page"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="users-page"]').exists()).toBe(false)
    })
  })

  describe('user with manage_app_settings only', () => {
    it('sees only OIDC tab', () => {
      const wrapper = mountComponent(undefined, { perms: ['manage_app_settings'] })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).not.toContain('Users')
      expect(labels).toContain('OIDC / SSO')
    })

    it('defaults to oidc and shows OidcSettings', () => {
      const wrapper = mountComponent(undefined, { perms: ['manage_app_settings'] })
      expect(wrapper.find('[data-testid="oidc-settings"]').exists()).toBe(true)
    })
  })

  describe('user with both manage_users and manage_app_settings', () => {
    it('sees both tabs', () => {
      const wrapper = mountComponent(undefined, { perms: ['manage_users', 'manage_app_settings'] })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('Users')
      expect(labels).not.toContain('Magic Links')
      expect(labels).toContain('OIDC / SSO')
    })
  })

  describe('tab navigation', () => {
    it('active tab button has border-primary class', () => {
      const wrapper = mountComponent('users', { su: true })
      const usersBtn = wrapper.findAll('button').find((b) => b.text() === 'Users')
      expect(usersBtn?.classes()).toContain('border-primary')
    })

    it('inactive tab button has border-transparent class', () => {
      const wrapper = mountComponent('users', { su: true })
      const oidcBtn = wrapper.findAll('button').find((b) => b.text() === 'OIDC / SSO')
      expect(oidcBtn?.classes()).toContain('border-transparent')
    })

    it('clicking a tab switches content', async () => {
      permState.isSuperuser = true
      routerState.currentQuery = { tab: 'users' }
      const wrapper = mount(AdminAllSettings)

      const oidcBtn = wrapper.findAll('button').find((b) => b.text() === 'OIDC / SSO')
      await oidcBtn!.trigger('click')

      expect(wrapper.find('[data-testid="oidc-settings"]').exists()).toBe(true)
    })

    it('replaces URL with default tab when no tab param present', () => {
      mountComponent(undefined, { su: true })
      expect(routerState.replacedQuery!['tab']).toBe('users')
    })

    it('does not replace URL when tab param is present', () => {
      mountComponent('oidc', { su: true })
      expect(routerState.replacedQuery).toBeNull()
    })
  })
})
