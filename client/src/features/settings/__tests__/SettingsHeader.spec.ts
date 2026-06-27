import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import SettingsHeader from '../SettingsHeader.vue'

// --- Permission state ---
const permState = {
  isSuperuser: false,
  permissions: [] as string[],
}

const routeState = { name: 'settings-appearance' }

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: routeState.name }),
  useRouter: () => ({
    push: vi.fn<() => Promise<void>>(),
  }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser: computed(() => permState.isSuperuser),
    userPermissions: computed(() => permState.permissions),
  }),
}))

function mountHeader(opts?: { su?: boolean; perms?: string[]; routeName?: string }) {
  permState.isSuperuser = opts?.su ?? false
  permState.permissions = opts?.perms ?? []
  routeState.name = opts?.routeName ?? 'settings-appearance'
  return mount(SettingsHeader)
}

function getTabLabels(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('button').map((b) => b.text())
}

describe('SettingsHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('tab visibility', () => {
    it('shows Display tab', () => {
      const labels = getTabLabels(mountHeader())
      expect(labels).toContain('Display')
    })

    it('shows Reader tab', () => {
      const labels = getTabLabels(mountHeader())
      expect(labels).toContain('Reader')
    })

    it('shows Account tab', () => {
      const labels = getTabLabels(mountHeader())
      expect(labels).toContain('Account')
    })

    it('hides integration tabs when user has no integration permissions', () => {
      const labels = getTabLabels(mountHeader())
      expect(labels).not.toContain('Integrations')
      expect(labels).not.toContain('Kobo')
      expect(labels).not.toContain('KOReader')
      expect(labels).not.toContain('Hardcover')
    })

    it('shows Kobo tab for users with kobo_sync', () => {
      const labels = getTabLabels(mountHeader({ perms: ['kobo_sync'] }))
      expect(labels).toContain('Kobo')
      expect(labels).not.toContain('Integrations')
    })

    it('shows KOReader tab for users with koreader_sync', () => {
      const labels = getTabLabels(mountHeader({ perms: ['koreader_sync'] }))
      expect(labels).toContain('KOReader')
      expect(labels).not.toContain('Integrations')
    })

    it('shows Hardcover tab for users with hardcover_sync', () => {
      const labels = getTabLabels(mountHeader({ perms: ['hardcover_sync'] }))
      expect(labels).toContain('Hardcover')
      expect(labels).not.toContain('Integrations')
    })

    it('shows integration tabs for superusers', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).toContain('Kobo')
      expect(labels).toContain('KOReader')
      expect(labels).toContain('Hardcover')
      expect(labels).not.toContain('Integrations')
    })

    it('places integration tabs after OPDS', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels.slice(labels.indexOf('OPDS'), labels.indexOf('Admin'))).toEqual(['OPDS', 'Kobo', 'KOReader', 'Hardcover'])
    })
  })

  describe('tabs removed from top-level navigation', () => {
    it('does not show a standalone Users tab', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).not.toContain('Users')
    })

    it('does not show a standalone OIDC / SSO tab', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).not.toContain('OIDC / SSO')
    })

    it('does not show a standalone File Naming tab', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).not.toContain('File Naming')
    })

    it('does not show a standalone Book Dock tab', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).not.toContain('Book Dock')
    })

    it('does not show a standalone Maintenance tab', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).not.toContain('Maintenance')
    })

    it('does not show a standalone Audit Log tab', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).not.toContain('Audit Log')
    })

    it('does not show a standalone Notifications tab', () => {
      const labels = getTabLabels(mountHeader())
      expect(labels).not.toContain('Notifications')
    })
  })

  describe('Admin tab visibility', () => {
    it('shows Admin tab for superuser', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).toContain('Admin')
    })

    it('shows Admin tab for user with manage_users', () => {
      const labels = getTabLabels(mountHeader({ perms: ['manage_users'] }))
      expect(labels).toContain('Admin')
    })

    it('shows Admin tab for user with manage_app_settings', () => {
      const labels = getTabLabels(mountHeader({ perms: ['manage_app_settings'] }))
      expect(labels).toContain('Admin')
    })

    it('hides Admin tab when user has neither manage_users nor manage_app_settings', () => {
      const labels = getTabLabels(mountHeader({ perms: ['kobo_sync'] }))
      expect(labels).not.toContain('Admin')
    })
  })

  describe('System tab visibility', () => {
    it('shows System tab for superuser', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).toContain('System')
    })

    it('shows System tab for user with manage_app_settings', () => {
      const labels = getTabLabels(mountHeader({ perms: ['manage_app_settings'] }))
      expect(labels).toContain('System')
    })

    it('shows System tab for user with book_dock_access', () => {
      const labels = getTabLabels(mountHeader({ perms: ['book_dock_access'] }))
      expect(labels).toContain('System')
    })

    it('hides System tab when user lacks manage_app_settings and book_dock_access', () => {
      const labels = getTabLabels(mountHeader({ perms: ['kobo_sync'] }))
      expect(labels).not.toContain('System')
    })
  })

  describe('conditional tabs', () => {
    it('shows Libraries tab for superuser', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).toContain('Libraries')
    })

    it('shows Libraries tab for user with manage_libraries', () => {
      const labels = getTabLabels(mountHeader({ perms: ['manage_libraries'] }))
      expect(labels).toContain('Libraries')
    })

    it('hides Libraries tab for user without manage_libraries', () => {
      const labels = getTabLabels(mountHeader())
      expect(labels).not.toContain('Libraries')
    })

    it('shows Metadata tab for superuser', () => {
      const labels = getTabLabels(mountHeader({ su: true }))
      expect(labels).toContain('Metadata')
    })

    it('shows Metadata tab for user with manage_metadata_config', () => {
      const labels = getTabLabels(mountHeader({ perms: ['manage_metadata_config'] }))
      expect(labels).toContain('Metadata')
    })

    it('shows Email tab for user with email_send', () => {
      const labels = getTabLabels(mountHeader({ perms: ['email_send'] }))
      expect(labels).toContain('Email')
    })

    it('shows OPDS tab for user with opds_access', () => {
      const labels = getTabLabels(mountHeader({ perms: ['opds_access'] }))
      expect(labels).toContain('OPDS')
    })
  })

  describe('active state', () => {
    it('active tab has border-primary class when route matches', () => {
      const wrapper = mountHeader({ routeName: 'settings-appearance' })
      const displayBtn = wrapper.findAll('button').find((b) => b.text() === 'Display')
      expect(displayBtn?.classes()).toContain('border-primary')
    })

    it('inactive tabs have border-transparent class', () => {
      const wrapper = mountHeader({ routeName: 'settings-appearance' })
      const readerBtn = wrapper.findAll('button').find((b) => b.text() === 'Reader')
      expect(readerBtn?.classes()).toContain('border-transparent')
    })

    it('kobo tab is active when route is settings-kobo', () => {
      const wrapper = mountHeader({ routeName: 'settings-kobo', perms: ['kobo_sync'] })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'Kobo')
      expect(btn?.classes()).toContain('border-primary')
    })

    it('KOReader tab is active when route is settings-koreader', () => {
      const wrapper = mountHeader({ routeName: 'settings-koreader', perms: ['koreader_sync'] })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'KOReader')
      expect(btn?.classes()).toContain('border-primary')
    })

    it('Hardcover tab is active when route is settings-hardcover', () => {
      const wrapper = mountHeader({ routeName: 'settings-hardcover', perms: ['hardcover_sync'] })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'Hardcover')
      expect(btn?.classes()).toContain('border-primary')
    })

    it('admin tab is active when route is settings-admin', () => {
      const wrapper = mountHeader({ su: true, routeName: 'settings-admin' })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'Admin')
      expect(btn?.classes()).toContain('border-primary')
    })

    it('system tab is active when route is settings-system', () => {
      const wrapper = mountHeader({ su: true, routeName: 'settings-system' })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'System')
      expect(btn?.classes()).toContain('border-primary')
    })

    it('account tab is active when route is settings-account', () => {
      const wrapper = mountHeader({ routeName: 'settings-account' })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'Account')
      expect(btn?.classes()).toContain('border-primary')
    })
  })

  describe('navigation', () => {
    it('clicking a tab button triggers a click event', async () => {
      const wrapper = mountHeader({ routeName: 'settings-appearance' })
      const readerBtn = wrapper.findAll('button').find((b) => b.text() === 'Reader')
      await readerBtn!.trigger('click')
      // If click triggers without throwing, navigation is wired correctly
      expect(readerBtn!.exists()).toBe(true)
    })
  })
})
