import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const routerState = vi.hoisted(() => ({
  currentQuery: {} as Record<string, string>,
  replacedQuery: null as Record<string, string> | null,
}))

// The real module builds the application router at import time, which jsdom has no history for.
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routerState.currentQuery }),
  useRouter: () => ({
    replace: vi.fn<(to: { name: string; query: Record<string, string> }) => void>((to) => {
      routerState.replacedQuery = to.query
      routerState.currentQuery = to.query
    }),
  }),
  createRouter: () => ({ beforeEach: vi.fn<() => void>(), afterEach: vi.fn<() => void>(), isReady: () => Promise.resolve() }),
  createWebHistory: () => ({}),
  createMemoryHistory: () => ({}),
  RouterLink: { template: '<a><slot /></a>' },
  RouterView: { template: '<div />' },
}))

import RequestsSettings from '../RequestsSettings.vue'

/** The panels fetch on mount; this page is only about which one of them is on screen. */
const stubs = {
  RequestIndexersPanel: { template: '<div>sources panel</div>' },
  DownloadClientsPanel: { template: '<div>clients panel</div>' },
  RequestAutomationPanel: { template: '<div>automation panel</div>' },
}

function mountPage(tab?: string) {
  routerState.currentQuery = tab ? { tab } : {}
  routerState.replacedQuery = null
  return mount(RequestsSettings, { props: { embedded: true }, global: { stubs } })
}

describe('RequestsSettings', () => {
  it('offers one tab per thing this page configures', () => {
    const wrapper = mountPage()

    const labels = wrapper.findAll('[role="tab"]').map((tab) => tab.text())
    expect(labels).toEqual(['Sources', 'Download clients', 'Automation'])
  })

  /** Only the panel being looked at, so three concurrent loads do not happen on every visit. */
  it('renders only the panel for the active tab', async () => {
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('sources panel')
    expect(wrapper.text()).not.toContain('clients panel')

    await wrapper.findAll('[role="tab"]')[1]?.trigger('click')

    expect(wrapper.text()).toContain('clients panel')
    expect(wrapper.text()).not.toContain('sources panel')
  })

  /** The tab is in the URL, so a link to one lands on it and a reload stays put. */
  it('opens the tab named in the query, and writes the chosen one back', async () => {
    const wrapper = mountPage('automation')
    expect(wrapper.text()).toContain('automation panel')

    await wrapper.findAll('[role="tab"]')[0]?.trigger('click')

    expect(routerState.replacedQuery).toEqual({ tab: 'sources' })
  })

  it('falls back to the first tab when the query names one that does not exist', () => {
    const wrapper = mountPage('nonsense')

    expect(wrapper.text()).toContain('sources panel')
  })
})
