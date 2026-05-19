import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import SystemAllSettings from '../SystemAllSettings.vue'

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

vi.mock('../FileNamingSettings.vue', () => ({ default: { template: '<div data-testid="file-naming" />' } }))
vi.mock('../BookDockSettings.vue', () => ({ default: { template: '<div data-testid="book-dock" />' } }))
vi.mock('../MaintenanceSettings.vue', () => ({ default: { template: '<div data-testid="maintenance" />' } }))
vi.mock('@/features/audit/AuditLogPage.vue', () => ({ default: { template: '<div data-testid="audit-log" />' } }))
vi.mock('../SettingsPageHeader.vue', () => ({ default: { template: '<div />' } }))

function mountComponent(queryTab?: string, opts?: { su?: boolean; perms?: string[] }) {
  permState.isSuperuser = opts?.su ?? false
  permState.permissions = opts?.perms ?? []
  routerState.currentQuery = queryTab ? { tab: queryTab } : {}
  routerState.replacedQuery = null
  return mount(SystemAllSettings)
}

describe('SystemAllSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('superuser', () => {
    it('sees all four tabs', () => {
      const wrapper = mountComponent(undefined, { su: true })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('File Naming')
      expect(labels).toContain('Book Dock')
      expect(labels).toContain('Maintenance')
      expect(labels).toContain('Audit Log')
    })

    it('defaults to file-naming and shows FileNamingSettings', () => {
      const wrapper = mountComponent(undefined, { su: true })
      expect(wrapper.find('[data-testid="file-naming"]').exists()).toBe(true)
    })

    it('renders BookDockSettings when tab=book-dock', () => {
      const wrapper = mountComponent('book-dock', { su: true })
      expect(wrapper.find('[data-testid="book-dock"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="file-naming"]').exists()).toBe(false)
    })

    it('renders MaintenanceSettings when tab=maintenance', () => {
      const wrapper = mountComponent('maintenance', { su: true })
      expect(wrapper.find('[data-testid="maintenance"]').exists()).toBe(true)
    })

    it('renders AuditLogPage when tab=audit-log', () => {
      const wrapper = mountComponent('audit-log', { su: true })
      expect(wrapper.find('[data-testid="audit-log"]').exists()).toBe(true)
    })
  })

  describe('user with manage_app_settings', () => {
    it('sees file-naming and maintenance but not book-dock or audit-log', () => {
      const wrapper = mountComponent(undefined, { perms: ['manage_app_settings'] })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('File Naming')
      expect(labels).toContain('Maintenance')
      expect(labels).not.toContain('Book Dock')
      expect(labels).not.toContain('Audit Log')
    })
  })

  describe('user with book_dock_access only', () => {
    it('sees book-dock tab only', () => {
      const wrapper = mountComponent(undefined, { perms: ['book_dock_access'] })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).toContain('Book Dock')
      expect(labels).not.toContain('File Naming')
      expect(labels).not.toContain('Maintenance')
      expect(labels).not.toContain('Audit Log')
    })

    it('defaults to book-dock', () => {
      const wrapper = mountComponent(undefined, { perms: ['book_dock_access'] })
      expect(wrapper.find('[data-testid="book-dock"]').exists()).toBe(true)
    })
  })

  describe('non-superuser cannot access audit-log', () => {
    it('does not see audit-log even with manage_app_settings', () => {
      const wrapper = mountComponent(undefined, { perms: ['manage_app_settings'] })
      const labels = wrapper.findAll('button').map((b) => b.text())
      expect(labels).not.toContain('Audit Log')
    })

    it('falls back when audit-log requested without superuser', () => {
      const wrapper = mountComponent('audit-log', { perms: ['manage_app_settings'] })
      expect(wrapper.find('[data-testid="audit-log"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="file-naming"]').exists()).toBe(true)
    })
  })

  describe('tab navigation', () => {
    it('active tab button has border-primary class', () => {
      const wrapper = mountComponent('maintenance', { su: true })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'Maintenance')
      expect(btn?.classes()).toContain('border-primary')
    })

    it('inactive tab button has border-transparent class', () => {
      const wrapper = mountComponent('maintenance', { su: true })
      const btn = wrapper.findAll('button').find((b) => b.text() === 'File Naming')
      expect(btn?.classes()).toContain('border-transparent')
    })

    it('clicking a tab switches content', async () => {
      permState.isSuperuser = true
      routerState.currentQuery = { tab: 'file-naming' }
      const wrapper = mount(SystemAllSettings)

      const btn = wrapper.findAll('button').find((b) => b.text() === 'Audit Log')
      await btn!.trigger('click')

      expect(wrapper.find('[data-testid="audit-log"]').exists()).toBe(true)
    })

    it('replaces URL with default tab when no tab param present', () => {
      mountComponent(undefined, { su: true })
      expect(routerState.replacedQuery!['tab']).toBe('file-naming')
    })
  })
})
