import { describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { computed } from 'vue'
import { Permission } from '@bookorbit/types'
import SettingsSidebar from '../components/SettingsSidebar.vue'

const permState = {
  isSuperuser: false,
  permissions: [] as string[],
  demoRestricted: false,
}

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'settings-appearance-theme' }),
  useRouter: () => ({ push: vi.fn<(to: { name: string }) => void>() }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser: computed(() => permState.isSuperuser),
    userPermissions: computed(() => permState.permissions),
    isDemoRestrictedAccount: computed(() => permState.demoRestricted),
  }),
}))

function mountSidebar(opts?: { rail?: boolean; su?: boolean; perms?: string[]; demo?: boolean }) {
  permState.isSuperuser = opts?.su ?? false
  permState.permissions = opts?.perms ?? []
  permState.demoRestricted = opts?.demo ?? false
  return mount(SettingsSidebar, {
    props: { isRail: opts?.rail ?? false },
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        SidebarSectionPopover: { props: ['label', 'icon', 'count'], template: '<div data-testid="rail-group"><slot /></div>' },
      },
    },
  })
}

describe('SettingsSidebar', () => {
  it('keeps the back action icon-only in rail mode', () => {
    expect(mountSidebar().find('[data-testid="settings-sidebar-back"]').exists()).toBe(false)

    const wrapper = mountSidebar({ rail: true })
    const back = wrapper.get('[data-testid="settings-sidebar-back"]')
    expect(back.text()).toBe('')
    expect(back.attributes('aria-label')).toBe('Back to library')
    expect(wrapper.findAllComponents(RouterLinkStub)[0]?.props('to')).toBe('/')
  })

  it('renders the full navigation when the sidebar is expanded', () => {
    const wrapper = mountSidebar()
    expect(wrapper.findComponent({ name: 'SettingsNav' }).exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="rail-group"]')).toHaveLength(0)
  })

  it('collapses to one popover per group when the sidebar is a rail', () => {
    const wrapper = mountSidebar({ rail: true, su: true })
    expect(wrapper.findComponent({ name: 'SettingsNav' }).exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="rail-group"]')).toHaveLength(5)
  })

  it('flattens nested destinations into the rail popovers', () => {
    const labels = mountSidebar({ rail: true })
      .findAll('[data-testid="settings-sidebar-rail-item"]')
      .map((node) => node.text())
    expect(labels).toContain('Theme')
    expect(labels).toContain('eBook')
    expect(labels).not.toContain('Display')
  })

  it('uses the same semantic active treatment in rail mode', () => {
    const active = mountSidebar({ rail: true })
      .findAll('[data-testid="settings-sidebar-rail-item"]')
      .find((node) => node.attributes('aria-current') === 'page')

    expect(active?.text()).toBe('Theme')
    expect(active?.classes()).toContain('bg-sidebar-accent')
    expect(active?.classes()).toContain('font-medium')
    expect(active?.classes()).not.toContain('font-normal')
  })

  it('only shows groups the user has access to', () => {
    expect(mountSidebar({ rail: true }).findAll('[data-testid="rail-group"]')).toHaveLength(1)
    expect(mountSidebar({ rail: true, perms: ['manage_libraries'] }).findAll('[data-testid="rail-group"]')).toHaveLength(2)
  })

  it('applies notification access rules in collapsed rail mode', () => {
    const labels = (opts?: Parameters<typeof mountSidebar>[0]) =>
      mountSidebar({ ...opts, rail: true })
        .findAll('[data-testid="settings-sidebar-rail-item"]')
        .map((node) => node.text())

    expect(labels()).not.toContain('Notifications')
    expect(labels({ perms: [Permission.NotificationAccess] })).toContain('Notifications')
    expect(labels({ su: true })).toContain('Notifications')
    expect(labels({ perms: [Permission.NotificationAccess], demo: true })).not.toContain('Notifications')
    expect(labels({ su: true, demo: true })).not.toContain('Notifications')
  })
})
