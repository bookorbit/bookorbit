import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { computed } from 'vue'
import { Permission } from '@bookorbit/types'
import SettingsNav from '../components/SettingsNav.vue'

const permState = {
  isSuperuser: false,
  permissions: [] as string[],
  demoRestricted: false,
}

const routeState = { name: 'settings-appearance-theme' }

const push = vi.fn<(to: { name: string }) => void>()

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: routeState.name }),
  useRouter: () => ({ push }),
}))

const navStatus = vi.hoisted(() => ({ scanning: false }))

vi.mock('../composables/useSettingsNavStatus', async () => {
  const { computed: makeComputed } = await import('vue')
  return { useSettingsNavStatus: () => ({ isLibraryScanning: makeComputed(() => navStatus.scanning) }) }
})

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser: computed(() => permState.isSuperuser),
    userPermissions: computed(() => permState.permissions),
    isDemoRestrictedAccount: computed(() => permState.demoRestricted),
  }),
}))

function mountNav(opts?: { su?: boolean; perms?: string[]; demo?: boolean; routeName?: string; scanning?: boolean }) {
  permState.isSuperuser = opts?.su ?? false
  permState.permissions = opts?.perms ?? []
  permState.demoRestricted = opts?.demo ?? false
  navStatus.scanning = opts?.scanning ?? false
  routeState.name = opts?.routeName ?? 'settings-appearance-theme'
  return mount(SettingsNav, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

type Wrapper = ReturnType<typeof mountNav>

function itemLabels(wrapper: Wrapper): string[] {
  return wrapper.findAll('[data-testid="settings-nav-item"]').map((node) => node.text())
}

function childLabels(wrapper: Wrapper): string[] {
  return wrapper.findAll('[data-testid="settings-nav-child"]').map((node) => node.text())
}

function groupLabels(wrapper: Wrapper): string[] {
  return wrapper.findAll('[data-testid="settings-nav-group"]').map((node) => node.text())
}

async function search(wrapper: Wrapper, term: string): Promise<string[]> {
  await wrapper.get('[data-testid="settings-nav-search"]').setValue(term)
  return wrapper.findAll('[data-testid="settings-nav-result-label"]').map((node) => node.text())
}

describe('SettingsNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    push.mockClear()
  })

  it('places an icon-only back action beside search', () => {
    const wrapper = mountNav()
    const back = wrapper.get('[data-testid="settings-nav-back"]')

    expect(back.text()).toBe('')
    expect(back.attributes('aria-label')).toBe('Back to library')
    expect(wrapper.findAllComponents(RouterLinkStub)[0]?.props('to')).toBe('/')
  })

  describe('personal section', () => {
    it('always shows the personal destinations', () => {
      const labels = itemLabels(mountNav())
      expect(labels).toContain('Profile')
      expect(labels).toContain('Display')
      expect(labels).toContain('Reader')
      expect(labels).toContain('Privacy & Sharing')
      expect(labels).toContain('Restrictions')
    })

    it('hides notifications without notification access', () => {
      expect(itemLabels(mountNav())).not.toContain('Notifications')
    })

    it('shows notifications with notification access or superuser status', () => {
      expect(itemLabels(mountNav({ perms: [Permission.NotificationAccess] }))).toContain('Notifications')
      expect(itemLabels(mountNav({ su: true }))).toContain('Notifications')
    })

    it('hides notifications for a demo-restricted account even when otherwise allowed', () => {
      expect(itemLabels(mountNav({ perms: [Permission.NotificationAccess], demo: true }))).not.toContain('Notifications')
      expect(itemLabels(mountNav({ su: true, demo: true }))).not.toContain('Notifications')
    })
  })

  describe('group visibility', () => {
    it('shows only the personal group to a user without permissions', () => {
      expect(groupLabels(mountNav())).toEqual(['You'])
    })

    it('shows every group to a superuser', () => {
      expect(groupLabels(mountNav({ su: true }))).toEqual(['You', 'Library', 'Devices', 'Accounts', 'Server'])
    })

    it('shows the library group to a user who can manage libraries', () => {
      expect(groupLabels(mountNav({ perms: ['manage_libraries'] }))).toEqual(['You', 'Library'])
    })
  })

  describe('library section', () => {
    it('hides libraries without manage_libraries', () => {
      expect(itemLabels(mountNav({ perms: ['manage_metadata_config'] }))).not.toContain('Libraries')
    })

    it('shows libraries with manage_libraries', () => {
      expect(itemLabels(mountNav({ perms: ['manage_libraries'] }))).toContain('Libraries')
    })

    it('collapses the metadata destinations behind a single row', () => {
      const labels = itemLabels(mountNav({ perms: ['manage_metadata_config'] }))
      expect(labels).toContain('Metadata')
      expect(labels).not.toContain('Providers')
    })

    it('shows metadata destinations with manage_metadata_config', () => {
      const labels = childLabels(mountNav({ perms: ['manage_metadata_config'], routeName: 'settings-metadata-providers' }))
      expect(labels).toContain('Providers')
      expect(labels).toContain('Field Rules')
      expect(labels).toContain('Confidence Score')
    })

    it('keeps custom fields behind manage_libraries rather than metadata config', () => {
      expect(childLabels(mountNav({ perms: ['manage_metadata_config'], routeName: 'settings-metadata-providers' }))).not.toContain('Custom Fields')
      expect(childLabels(mountNav({ perms: ['manage_libraries'], routeName: 'settings-metadata-custom-fields' }))).toContain('Custom Fields')
    })

    it('drops the metadata row entirely when no child is reachable', () => {
      expect(itemLabels(mountNav({ perms: ['manage_app_settings'] }))).not.toContain('Metadata')
    })

    it('shows file naming and maintenance with manage_app_settings', () => {
      const labels = itemLabels(mountNav({ perms: ['manage_app_settings'] }))
      expect(labels).toContain('File Naming')
      expect(labels).toContain('Maintenance')
    })
  })

  describe('devices section', () => {
    it('shows Kobo only with kobo_sync', () => {
      expect(itemLabels(mountNav())).not.toContain('Kobo')
      expect(itemLabels(mountNav({ perms: ['kobo_sync'] }))).toContain('Kobo')
    })

    it('shows KOReader only with koreader_sync', () => {
      expect(itemLabels(mountNav({ perms: ['koreader_sync'] }))).toContain('KOReader')
    })

    it('shows OPDS only with opds_access', () => {
      expect(itemLabels(mountNav({ perms: ['opds_access'] }))).toContain('OPDS')
    })

    it('shows Email with email_send', () => {
      expect(itemLabels(mountNav({ perms: ['email_send'] }))).toContain('Email')
    })

    it('lists connected services under Accounts as their own destinations', () => {
      const wrapper = mountNav({ perms: ['hardcover_sync'] })
      expect(itemLabels(wrapper)).toContain('Hardcover')
      expect(itemLabels(wrapper)).not.toContain('Readwise')
      expect(groupLabels(wrapper)).toContain('Accounts')
    })
  })

  describe('server section', () => {
    it('shows users only with manage_users', () => {
      expect(itemLabels(mountNav())).not.toContain('Users & Access')
      expect(childLabels(mountNav({ perms: ['manage_users'], routeName: 'settings-admin-users' }))).toContain('Users')
    })

    it('shows account activity with view_user_activity', () => {
      const labels = childLabels(mountNav({ perms: ['view_user_activity'], routeName: 'settings-admin-account-activity' }))
      expect(labels).toContain('Account Activity')
    })

    it('keeps magic links and the audit log for superusers only', () => {
      const admin = mountNav({ perms: ['manage_app_settings'], routeName: 'settings-admin-oidc' })
      expect(childLabels(admin)).not.toContain('Magic Links')
      expect(itemLabels(admin)).not.toContain('Audit Log')

      const superuser = mountNav({ su: true, routeName: 'settings-admin-magic-links' })
      expect(childLabels(superuser)).toContain('Magic Links')
      expect(itemLabels(superuser)).toContain('Audit Log')
    })

    it('shows single sign-on and server fonts with manage_app_settings', () => {
      const wrapper = mountNav({ perms: ['manage_app_settings'], routeName: 'settings-admin-oidc' })
      expect(childLabels(wrapper)).toContain('OIDC / SSO')
      expect(itemLabels(wrapper)).toContain('Server Fonts')
    })

    it('drops the access row entirely when no child is reachable', () => {
      expect(itemLabels(mountNav({ perms: ['manage_book_dock'] }))).not.toContain('Users & Access')
    })

    it('shows the book dock with manage_book_dock', () => {
      expect(itemLabels(mountNav({ perms: ['manage_book_dock'] }))).toContain('Book Dock')
    })
  })

  describe('active state and nesting', () => {
    it('keeps inactive labels prominent while treating icons and headings as supporting content', () => {
      const wrapper = mountNav({ routeName: 'settings-account' })
      const display = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text() === 'Display')

      expect(display?.get('[data-testid="settings-nav-item-label"]').classes()).toContain('text-sidebar-foreground')
      expect(display?.get('[data-testid="settings-nav-item-icon"]').classes()).toContain('text-muted-foreground')
      expect(display?.classes()).toContain('font-normal')
      expect(display?.classes()).not.toContain('font-medium')
      expect(wrapper.get('[data-testid="settings-nav-group"]').classes()).toContain('text-muted-foreground')
    })

    it('expands the children of the active branch only', () => {
      expect(childLabels(mountNav({ routeName: 'settings-appearance-theme' }))).toContain('Theme')
      expect(childLabels(mountNav({ routeName: 'settings-reader-pdf' }))).not.toContain('Theme')
    })

    it('marks the active child with aria-current', () => {
      const wrapper = mountNav({ routeName: 'settings-appearance-layout' })
      const active = wrapper.findAll('[data-testid="settings-nav-child"]').find((node) => node.attributes('aria-current') === 'page')
      const activeBranch = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text() === 'Display')
      expect(active?.text()).toBe('Layout')
      expect(active?.classes()).toContain('bg-sidebar-accent')
      expect(active?.classes()).toContain('font-medium')
      expect(active?.classes()).not.toContain('font-normal')
      expect(active?.classes()).toContain('text-sidebar-accent-foreground')
      expect(activeBranch?.classes()).toContain('font-medium')
      expect(activeBranch?.classes()).not.toContain('font-normal')
    })

    it('marks a collapsible row with a chevron and leaves a destination without one', () => {
      const wrapper = mountNav({ perms: ['manage_libraries'] })
      const rows = wrapper.findAll('[data-testid="settings-nav-item"]')
      const metadata = rows.find((node) => node.text().includes('Metadata'))
      const libraries = rows.find((node) => node.text().includes('Libraries'))

      expect(metadata?.find('[data-testid="settings-nav-item-chevron"]').exists()).toBe(true)
      expect(libraries?.find('[data-testid="settings-nav-item-chevron"]').exists()).toBe(false)
    })

    it('turns the chevron only while the branch is open', async () => {
      const wrapper = mountNav({ routeName: 'settings-appearance-layout' })
      const display = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text().includes('Display'))
      const chevron = () => display?.get('[data-testid="settings-nav-item-chevron"]')

      expect(chevron()?.classes()).toContain('rotate-90')
      await display?.trigger('click')
      expect(chevron()?.classes()).not.toContain('rotate-90')
    })

    it('renders a grouping row as a disclosure button rather than a link', () => {
      const wrapper = mountNav({ routeName: 'settings-reader-pdf' })
      const display = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text().includes('Display'))

      expect(display?.element.tagName).toBe('BUTTON')
      expect(display?.attributes('aria-expanded')).toBe('false')
      expect(wrapper.findAllComponents(RouterLinkStub).some((link) => link.text() === 'Display')).toBe(false)
    })

    it('opens a closed branch and jumps to its first page', async () => {
      const wrapper = mountNav({ routeName: 'settings-reader-pdf' })
      const display = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text().includes('Display'))

      await display?.trigger('click')

      expect(push).toHaveBeenCalledWith({ name: 'settings-appearance-theme' })
      expect(childLabels(wrapper)).toContain('Theme')
    })

    it('closes an open branch again without navigating away', async () => {
      const wrapper = mountNav({ routeName: 'settings-appearance-layout' })
      const display = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text().includes('Display'))
      expect(childLabels(wrapper)).toContain('Layout')

      await display?.trigger('click')

      expect(childLabels(wrapper)).not.toContain('Layout')
      expect(display?.attributes('aria-expanded')).toBe('false')
      expect(push).not.toHaveBeenCalled()
    })

    it('keeps a closed branch highlighted while its page is still open', async () => {
      const wrapper = mountNav({ routeName: 'settings-appearance-layout' })
      const display = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text().includes('Display'))

      await display?.trigger('click')

      expect(display?.classes()).toContain('bg-sidebar-accent')
    })

    it('opens only one branch at a time', async () => {
      const wrapper = mountNav({ routeName: 'settings-appearance-layout' })
      const reader = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text().includes('Reader'))

      await reader?.trigger('click')

      expect(childLabels(wrapper)).toContain('eBook')
      expect(childLabels(wrapper)).not.toContain('Layout')
    })
  })

  describe('live status', () => {
    it('flags a running scan on the libraries row', () => {
      const wrapper = mountNav({ perms: ['manage_libraries'], scanning: true })
      const libraries = wrapper.findAll('[data-testid="settings-nav-item"]').find((node) => node.text().includes('Libraries'))
      const status = libraries?.get('[data-testid="settings-nav-item-status"]')

      expect(status?.text()).toBe('Scanning')
      expect(status?.attributes('role')).toBe('status')
    })

    it('shows no status while nothing is scanning', () => {
      const wrapper = mountNav({ perms: ['manage_libraries'] })
      expect(wrapper.find('[data-testid="settings-nav-item-status"]').exists()).toBe(false)
    })
  })

  describe('search', () => {
    it('finds a page by title', async () => {
      expect(await search(mountNav({ perms: ['manage_libraries'] }), 'libraries')).toContain('Libraries')
    })

    it('finds a page by concept rather than title', async () => {
      expect(await search(mountNav({ perms: ['email_send'] }), 'smtp')).toContain('Email')
    })

    it('matches every word of a multi word query', async () => {
      const results = await search(mountNav({ perms: ['kobo_sync'] }), 'kobo shelves')
      expect(results).toContain('Kobo')
    })

    it('returns leaf pages instead of parent rows', async () => {
      const results = await search(mountNav(), 'comics')
      expect(results).toContain('Comics')
      expect(results).not.toContain('Reader')
    })

    it('never returns a page the user cannot open', async () => {
      expect(await search(mountNav(), 'users')).toEqual([])
      expect(await search(mountNav(), 'notifications')).toEqual([])
      expect(await search(mountNav({ perms: [Permission.NotificationAccess] }), 'notifications')).toContain('Notifications')
    })

    it('shows an empty state when nothing matches', async () => {
      const wrapper = mountNav()
      await wrapper.get('[data-testid="settings-nav-search"]').setValue('zzzznotasetting')
      expect(wrapper.findAll('[data-testid="settings-nav-result"]')).toHaveLength(0)
      expect(wrapper.text()).toContain('No settings match')
    })
  })
})
