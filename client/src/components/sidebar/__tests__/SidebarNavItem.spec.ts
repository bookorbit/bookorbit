import { describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { defineComponent, h, markRaw, type Component } from 'vue'
import type { SidebarNavSignal } from '@/composables/useSidebarNav'

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: { template: '<li><slot /></li>' },
  SidebarMenuButton: defineComponent({
    props: { tooltip: { type: [String, Object, Function], default: undefined }, tooltipWhenExpanded: Boolean, isActive: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      return () =>
        h('div', { 'data-testid': 'menu-button', 'data-tooltip-when-expanded': String(props.tooltipWhenExpanded) }, [
          slots.default?.(),
          h('div', { 'data-testid': 'tooltip' }, typeof props.tooltip === 'string' ? props.tooltip : [h(props.tooltip as Component)]),
        ])
    },
  }),
}))

const { default: SidebarNavItem } = await import('../SidebarNavItem.vue')

const Icon = markRaw({ name: 'Icon', props: ['size'], render: () => h('svg') })

function signal(overrides: Partial<SidebarNavSignal> = {}): SidebarNavSignal {
  return { activity: null, failed: false, attention: false, details: [], description: '', ...overrides }
}

function mountItem(props: { signal?: SidebarNavSignal | null; tooltip?: string } = {}) {
  return mount(SidebarNavItem, {
    props: {
      isActive: false,
      tooltip: props.tooltip ?? 'Jobs',
      to: { name: 'jobs-activity' },
      icon: Icon,
      label: 'Jobs',
      signal: props.signal ?? null,
    },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('SidebarNavItem', () => {
  it('stays as it was without a signal', () => {
    const wrapper = mountItem()

    expect(wrapper.find('svg').attributes('data-signal')).toBeUndefined()
    expect(wrapper.find('.bg-destructive').exists()).toBe(false)
    expect(wrapper.findComponent(RouterLinkStub).attributes('aria-describedby')).toBeUndefined()
    expect(wrapper.find('[data-testid="menu-button"]').attributes('data-tooltip-when-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="tooltip"]').text()).toBe('Jobs')
  })

  it('glows the icon while work runs and tints it while it waits', () => {
    expect(
      mountItem({ signal: signal({ activity: 'running', details: ['2 running'] }) })
        .find('svg')
        .attributes('data-signal'),
    ).toBe('running')
    expect(
      mountItem({ signal: signal({ activity: 'waiting', details: ['3 waiting'] }) })
        .find('svg')
        .attributes('data-signal'),
    ).toBe('waiting')
  })

  it('marks failures and work waiting, and shows its details on hover even when expanded', () => {
    const details = ['2 running', '1 job needs you', '2 failed']
    const wrapper = mountItem({
      signal: signal({ activity: 'running', failed: true, attention: true, details, description: '2 running, 1 job needs you, 2 failed' }),
    })

    expect(wrapper.find('.bg-destructive').exists()).toBe(true)
    // The count sits in the badge; this dot only shows in the collapsed sidebar, where the badge is hidden.
    expect(wrapper.find('.bg-primary').classes()).toContain('group-data-[collapsible=icon]:block')
    expect(wrapper.find('[data-testid="menu-button"]').attributes('data-tooltip-when-expanded')).toBe('true')
    expect(wrapper.findAll('[data-testid="tooltip"] span').map((line) => line.text())).toEqual(['Jobs', ...details])
    const describedBy = wrapper.findComponent(RouterLinkStub).attributes('aria-describedby')
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe('2 running, 1 job needs you, 2 failed')
  })
})
