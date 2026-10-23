import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { h, markRaw, nextTick, reactive } from 'vue'
import type { SidebarLayout } from '@bookorbit/types'
import type { ResolvedSidebarNavEntry } from '@/composables/useSidebarNav'
import type { SidebarCustomizeGroup } from '../SidebarCustomizer.vue'

const layout = reactive<SidebarLayout>({ hidden: [], groupOrder: [], rowOrder: {} })

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: { name?: string }) => (params?.name ? `${key}:${params.name}` : key) }),
}))

vi.mock('@/composables/useSidebarPrefs', () => ({
  useSidebarPrefs: () => ({ layout }),
  defaultSidebarLayout: () => ({ hidden: [], groupOrder: [], rowOrder: {} }),
}))

vi.mock('@/composables/useSidebarSections', () => ({
  SIDEBAR_SECTIONS: [{ id: 'libraries' }, { id: 'smartScopes' }, { id: 'collections' }],
}))

vi.mock('@/composables/useSidebarNav', () => ({
  SIDEBAR_NAV_REGISTRY: [
    { id: 'dashboard', zone: 'primary' },
    { id: 'book-dock', zone: 'primary' },
    { id: 'tools', zone: 'primary' },
    { id: 'authors', zone: 'browse' },
    { id: 'series', zone: 'browse' },
    { id: 'statistics', zone: 'reading' },
  ],
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: { name: 'SidebarGroup', template: '<section><slot /></section>' },
  SidebarSeparator: { name: 'SidebarSeparator', template: '<hr data-testid="separator" />' },
}))

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: { name: 'VueDraggable', template: '<div><slot /></div>' },
}))

vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ radius: 'rounded' }) }))

const { default: SidebarCustomizer } = await import('../SidebarCustomizer.vue')
const { useSidebarCustomizeMode } = await import('@/composables/useSidebarCustomizeMode')

const Icon = markRaw({ name: 'Icon', render: () => h('svg') })

function entry(id: string, returnsWithWork = false): ResolvedSidebarNavEntry {
  return { id, label: id, icon: Icon, to: { name: id }, isActive: false, badge: null, returnsWithWork }
}

const primaryEntries = [entry('dashboard'), entry('book-dock', true), entry('tools')]

function groups(order = ['browse', 'libraries', 'reading']): SidebarCustomizeGroup[] {
  const all: Record<string, SidebarCustomizeGroup> = {
    browse: { id: 'browse', kind: 'nav', label: 'Browse', count: null, entries: [entry('authors'), entry('series')] },
    libraries: { id: 'libraries', kind: 'list', label: 'Libraries', count: 6, entries: [] },
    reading: { id: 'reading', kind: 'nav', label: 'Reading', count: null, entries: [entry('statistics')] },
  }
  return order.map((id) => all[id] as SidebarCustomizeGroup)
}

let wrapper: VueWrapper | null = null

function mountCustomizer(order?: string[]) {
  wrapper = mount(SidebarCustomizer, { props: { primaryEntries, groups: groups(order) }, attachTo: document.body })
  return wrapper
}

function eyeFor(name: string) {
  return wrapper!.find(`button[aria-label="components.sidebar.customize.showInSidebar:${name}"]`)
}

describe('SidebarCustomizer', () => {
  beforeEach(() => {
    wrapper?.unmount()
    wrapper = null
    Object.assign(layout, { hidden: [], groupOrder: [], rowOrder: {} })
    useSidebarCustomizeMode().startCustomizing()
  })

  it('locks Search and Dashboard and gives every other row an eye', () => {
    mountCustomizer()

    expect(wrapper!.text()).toContain('components.sidebar.customize.alwaysShown:common.search')
    expect(wrapper!.text()).toContain('components.sidebar.customize.alwaysShown:dashboard')
    expect(eyeFor('dashboard').exists()).toBe(false)
    for (const name of ['book-dock', 'tools', 'Browse', 'authors', 'series', 'Libraries', 'Reading', 'statistics']) {
      expect(eyeFor(name).attributes('aria-pressed')).toBe('true')
    }
  })

  it('hides a row in place and marks it unpressed', async () => {
    mountCustomizer()

    await eyeFor('series').trigger('click')

    expect(layout.hidden).toEqual(['series'])
    expect(eyeFor('series').attributes('aria-pressed')).toBe('false')
  })

  it('tells the user a hidden Book Dock comes back when work is waiting', async () => {
    mountCustomizer()
    expect(wrapper!.text()).not.toContain('components.sidebar.customize.returnsWithWork')

    await eyeFor('book-dock').trigger('click')

    expect(wrapper!.text()).toContain('components.sidebar.customize.returnsWithWork')
  })

  it('folds a hidden nav group to its header', async () => {
    mountCustomizer()
    expect(eyeFor('authors').exists()).toBe(true)

    await eyeFor('Browse').trigger('click')

    expect(layout.hidden).toEqual(['browse'])
    expect(eyeFor('authors').exists()).toBe(false)
  })

  it('shows list sections as a header with their row count', () => {
    mountCustomizer()

    const header = wrapper!.findAll('.sidebar-section-label').find((label) => label.text() === 'Libraries')
    expect(header?.element.nextElementSibling?.textContent?.trim()).toBe('6')
  })

  it('draws a separator only where nav groups meet list sections', () => {
    mountCustomizer(['browse', 'libraries', 'reading'])
    expect(wrapper!.findAll('[data-testid="separator"]')).toHaveLength(2)
    wrapper!.unmount()

    mountCustomizer(['reading', 'browse', 'libraries'])
    expect(wrapper!.findAll('[data-testid="separator"]')).toHaveLength(1)
  })

  it('leaves edit mode on Escape unless a grip already claimed it', async () => {
    const { isCustomizing } = useSidebarCustomizeMode()
    mountCustomizer()

    const claimed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    claimed.preventDefault()
    window.dispatchEvent(claimed)
    expect(isCustomizing.value).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await nextTick()
    expect(isCustomizing.value).toBe(false)
  })

  it('moves focus into the editor when it opens', () => {
    mountCustomizer()

    expect(document.activeElement?.textContent?.trim()).toBe('components.sidebar.customize.title')
  })
})
