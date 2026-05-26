import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { Permission } from '@bookorbit/types'
import IntegrationsAllSettings from '../IntegrationsAllSettings.vue'

const permissionState = {
  isSuperuser: false,
  permissions: [] as string[],
}

const routerState = {
  currentQuery: {} as Record<string, string>,
  replaceCalls: [] as Array<{ name: string; query?: Record<string, string> }>,
}

vi.mock('vue-router', () => ({
  useRoute: () => ({
    query: routerState.currentQuery,
  }),
  useRouter: () => ({
    replace: vi.fn<(to: { name: string; query?: Record<string, string> }) => void>((to) => {
      routerState.replaceCalls.push(to)
    }),
  }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (name: string) => permissionState.isSuperuser || permissionState.permissions.includes(name),
  }),
}))

vi.mock('../KoboSettings.vue', () => ({ default: { template: '<div data-testid="kobo-settings" />' } }))
vi.mock('../KoreaderSettings.vue', () => ({ default: { template: '<div data-testid="koreader-settings" />' } }))
vi.mock('@/features/hardcover/components/HardcoverSettings.vue', () => ({
  default: { template: '<div data-testid="hardcover-settings" />' },
}))
vi.mock('../SettingsPageHeader.vue', () => ({ default: { template: '<div />' } }))

function mountComponent(opts?: { queryTab?: string; perms?: string[]; su?: boolean }) {
  permissionState.permissions = opts?.perms ?? []
  permissionState.isSuperuser = opts?.su ?? false
  routerState.currentQuery = opts?.queryTab ? { tab: opts.queryTab } : {}
  routerState.replaceCalls = []
  return mount(IntegrationsAllSettings)
}

function labels(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('button').map((button) => button.text())
}

function lastReplace() {
  if (routerState.replaceCalls.length === 0) return null
  return routerState.replaceCalls[routerState.replaceCalls.length - 1] ?? null
}

describe('IntegrationsAllSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to appearance when user has no integration permissions', () => {
    const wrapper = mountComponent()
    expect(labels(wrapper)).toEqual([])
    expect(lastReplace()).toEqual({ name: 'settings-appearance' })
  })

  it('shows only Kobo tab for kobo_sync users and defaults URL to ?tab=kobo', () => {
    const wrapper = mountComponent({ perms: [Permission.KoboSync] })
    expect(labels(wrapper)).toEqual(['Kobo'])
    expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(true)
    expect(lastReplace()).toEqual({ name: 'settings-integrations', query: { tab: 'kobo' } })
  })

  it('shows only KOReader tab for koreader_sync users and defaults URL to ?tab=koreader', () => {
    const wrapper = mountComponent({ perms: [Permission.KoreaderSync] })
    expect(labels(wrapper)).toEqual(['KOReader'])
    expect(wrapper.find('[data-testid="koreader-settings"]').exists()).toBe(true)
    expect(lastReplace()).toEqual({ name: 'settings-integrations', query: { tab: 'koreader' } })
  })

  it('shows only Hardcover tab for hardcover_sync users and defaults URL to ?tab=hardcover', () => {
    const wrapper = mountComponent({ perms: [Permission.HardcoverSync] })
    expect(labels(wrapper)).toEqual(['Hardcover'])
    expect(wrapper.find('[data-testid="hardcover-settings"]').exists()).toBe(true)
    expect(lastReplace()).toEqual({ name: 'settings-integrations', query: { tab: 'hardcover' } })
  })

  it('falls back to the first allowed tab when query tab is not permitted', () => {
    const wrapper = mountComponent({ queryTab: 'hardcover', perms: [Permission.KoreaderSync] })
    expect(wrapper.find('[data-testid="koreader-settings"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hardcover-settings"]').exists()).toBe(false)
    expect(lastReplace()).toEqual({ name: 'settings-integrations', query: { tab: 'koreader' } })
  })

  it('renders and switches all three tabs when user has all three permissions', async () => {
    const wrapper = mountComponent({
      queryTab: 'kobo',
      perms: [Permission.KoboSync, Permission.KoreaderSync, Permission.HardcoverSync],
    })

    expect(labels(wrapper)).toEqual(['Kobo', 'KOReader', 'Hardcover'])
    expect(wrapper.find('[data-testid="kobo-settings"]').exists()).toBe(true)

    const hardcoverButton = wrapper.findAll('button').find((button) => button.text() === 'Hardcover')
    await hardcoverButton!.trigger('click')

    expect(wrapper.find('[data-testid="hardcover-settings"]').exists()).toBe(true)
    expect(lastReplace()).toEqual({ name: 'settings-integrations', query: { tab: 'hardcover' } })
  })
})
