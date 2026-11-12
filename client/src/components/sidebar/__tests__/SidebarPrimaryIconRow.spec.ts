import { describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { h, markRaw } from 'vue'
import type { ResolvedSidebarNavEntry, SidebarNavBadge } from '@/composables/useSidebarNav'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: { count?: string }) => (params?.count ? `${key}:${params.count}` : key) }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div data-testid="tooltip-content"><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))

const { default: SidebarPrimaryIconRow } = await import('../SidebarPrimaryIconRow.vue')

const Icon = markRaw({ name: 'Icon', render: () => h('svg') })

function entry(id: string, overrides: Partial<ResolvedSidebarNavEntry> = {}): ResolvedSidebarNavEntry {
  return { id, label: `${id} label`, icon: Icon, to: { name: id }, isActive: false, badge: null, returnsWithWork: false, ...overrides }
}

function accent(value: number, label?: string): SidebarNavBadge {
  return { value, label, tone: 'accent' }
}

function mountRow(entries: ResolvedSidebarNavEntry[]) {
  return mount(SidebarPrimaryIconRow, { props: { entries }, global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('SidebarPrimaryIconRow', () => {
  it('draws one labelled link per page, in the order given', () => {
    const wrapper = mountRow([entry('dashboard'), entry('book-dock', { tourId: 'book-dock-btn' }), entry('tools')])

    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.map((link) => link.attributes('aria-label'))).toEqual(['dashboard label', 'book-dock label', 'tools label'])
    expect(links[1]?.props('to')).toEqual({ name: 'book-dock' })
    expect(links[1]?.attributes('data-tour')).toBe('book-dock-btn')
  })

  it('marks the current page', () => {
    const wrapper = mountRow([entry('dashboard'), entry('ai', { isActive: true })])

    const [dashboard, ai] = wrapper.findAllComponents(RouterLinkStub)
    expect(dashboard?.attributes('aria-current')).toBeUndefined()
    expect(dashboard?.attributes('data-active')).toBe('false')
    expect(ai?.attributes('aria-current')).toBe('page')
    expect(ai?.attributes('data-active')).toBe('true')
  })

  it('puts a chip on work waiting and describes it to assistive tech', () => {
    const wrapper = mountRow([entry('book-requests', { badge: accent(3, '3 active requests of yours') })])

    const link = wrapper.findComponent(RouterLinkStub)
    expect(link.find('[aria-hidden="true"].rounded-full').text()).toBe('3')
    const describedBy = link.attributes('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe('3 active requests of yours')
    expect(wrapper.find('[data-testid="tooltip-content"]').text()).toContain('3 active requests of yours')
  })

  it('caps the chip so a large count still fits on the tile', () => {
    const wrapper = mountRow([entry('book-dock', { badge: accent(1234) })])

    expect(wrapper.find('.rounded-full[aria-hidden="true"]').text()).toBe('components.sidebar.iconBadgeOverflow:99')
    const describedBy = wrapper.findComponent(RouterLinkStub).attributes('aria-describedby')
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe('1,234')
  })

  it('leaves totals that are not work waiting off the tile', () => {
    const wrapper = mountRow([entry('authors', { badge: { value: 42 } }), entry('book-dock', { badge: accent(0) })])

    expect(wrapper.find('.rounded-full[aria-hidden="true"]').exists()).toBe(false)
    for (const link of wrapper.findAllComponents(RouterLinkStub)) expect(link.attributes('aria-describedby')).toBeUndefined()
  })

  it('tells the sidebar a page was chosen so the phone sheet can close', async () => {
    const wrapper = mountRow([entry('dashboard')])

    await wrapper.findComponent(RouterLinkStub).trigger('click')

    expect(wrapper.emitted('navigate')).toHaveLength(1)
  })
})
