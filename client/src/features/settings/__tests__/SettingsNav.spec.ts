import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { computed } from 'vue'
import SettingsNav from '../components/SettingsNav.vue'

const permState = {
  isSuperuser: false,
  permissions: [] as string[],
  demoRestricted: false,
}

const routeState = { name: 'settings-appearance-theme' }

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: routeState.name }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser: computed(() => permState.isSuperuser),
    userPermissions: computed(() => permState.permissions),
    isDemoRestrictedAccount: computed(() => permState.demoRestricted),
  }),
}))

function mountNav(opts?: { su?: boolean; perms?: string[]; demo?: boolean; routeName?: string }) {
  permState.isSuperuser = opts?.su ?? false
  permState.permissions = opts?.perms ?? []
  permState.demoRestricted = opts?.demo ?? false
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

    it('shows notifications for a normal account', () => {
      expect(itemLabels(mountNav())).toContain('Notifications')
    })

    it('hides notifications for a demo restricted account', () => {
      expect(itemLabels(mountNav({ demo: true }))).not.toContain('Notifications')
    })
  })

  describe('group visibility', () => {
    it('shows only the personal group to a user without permissions', () => {
      expect(groupLabels(mountNav())).toEqual(['You'])
    })

    it('shows every group to a superuser', () => {
      expect(groupLabels(mountNav({ su: true }))).toEqual(['You', 'Library', 'Devices & sync', 'Server'])
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

    it('shows metadata destinations with manage_metadata_config', () => {
      const labels = itemLabels(mountNav({ perms: ['manage_metadata_config'] }))
      expect(labels).toContain('Providers')
      expect(labels).toContain('Field Rules')
      expect(labels).toContain('Score')
    })

    it('keeps custom fields behind manage_libraries rather than metadata config', () => {
      expect(itemLabels(mountNav({ perms: ['manage_metadata_config'] }))).not.toContain('Custom Fields')
      expect(itemLabels(mountNav({ perms: ['manage_libraries'] }))).toContain('Custom Fields')
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

    it('lists connected services as their own destinations', () => {
      const labels = itemLabels(mountNav({ perms: ['hardcover_sync'] }))
      expect(labels).toContain('Hardcover')
      expect(labels).not.toContain('Readwise')
    })
  })

  describe('server section', () => {
    it('shows users only with manage_users', () => {
      expect(itemLabels(mountNav())).not.toContain('Users')
      expect(itemLabels(mountNav({ perms: ['manage_users'] }))).toContain('Users')
    })

    it('shows account activity with view_user_activity', () => {
      expect(itemLabels(mountNav({ perms: ['view_user_activity'] }))).toContain('Account Activity')
    })

    it('keeps magic links and the audit log for superusers only', () => {
      const adminLabels = itemLabels(mountNav({ perms: ['manage_app_settings'] }))
      expect(adminLabels).not.toContain('Magic Links')
      expect(adminLabels).not.toContain('Audit Log')

      const superuserLabels = itemLabels(mountNav({ su: true }))
      expect(superuserLabels).toContain('Magic Links')
      expect(superuserLabels).toContain('Audit Log')
    })

    it('shows single sign-on and server fonts with manage_app_settings', () => {
      const labels = itemLabels(mountNav({ perms: ['manage_app_settings'] }))
      expect(labels).toContain('OIDC / SSO')
      expect(labels).toContain('Server Fonts')
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

    it('points a parent row at its first child', () => {
      const wrapper = mountNav()
      const display = wrapper.findAllComponents(RouterLinkStub).find((link) => link.text() === 'Display')
      expect(display?.props('to')).toEqual({ name: 'settings-appearance-theme' })
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
    })

    it('shows an empty state when nothing matches', async () => {
      const wrapper = mountNav()
      await wrapper.get('[data-testid="settings-nav-search"]').setValue('zzzznotasetting')
      expect(wrapper.findAll('[data-testid="settings-nav-result"]')).toHaveLength(0)
      expect(wrapper.text()).toContain('No settings match')
    })
  })
})
