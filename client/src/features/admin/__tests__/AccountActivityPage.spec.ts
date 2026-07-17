import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'

import AccountActivityPage from '../AccountActivityPage.vue'

const apiMock = vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()

vi.mock('@/lib/api', () => ({ api: (input: string) => apiMock(input) }))

const tooltipStubs = {
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
}

function mountPage() {
  return shallowMount(AccountActivityPage, { global: { stubs: tooltipStubs } })
}

describe('AccountActivityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockImplementation(async (input: string) => {
      if (input === '/api/v1/account-activity/summary') {
        return { ok: true, json: async () => ({ recent: 1, dormant: 2, never: 3, disabled: 4 }) }
      }
      if (input.startsWith('/api/v1/account-activity?')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: 1,
                username: 'reader',
                name: 'Reader',
                active: true,
                isSuperuser: false,
                provisioningMethod: 'local',
                createdAt: '2026-01-01T00:00:00.000Z',
                lastLoginAt: null,
                lastAuthenticatedAt: null,
                state: 'never',
                readingInsightsSharingLevel: 'private',
              },
              {
                id: 2,
                username: 'maya',
                name: 'Maya',
                active: true,
                isSuperuser: false,
                provisioningMethod: 'oidc',
                createdAt: '2025-01-01T00:00:00.000Z',
                lastLoginAt: '2026-07-01T00:00:00.000Z',
                lastAuthenticatedAt: '2026-07-02T00:00:00.000Z',
                state: 'recent',
                readingInsightsSharingLevel: 'detailed',
              },
            ],
            total: 2,
            page: 1,
            pageSize: 50,
          }),
        }
      }
      return { ok: false, json: async () => ({}) }
    })
  })

  it('explains the authentication-only privacy boundary and renders account activity', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Account Activity')
    expect(wrapper.find('button[aria-label="About account activity privacy"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Reader')
    expect(wrapper.text()).toContain('No recorded activity')
    expect(wrapper.text()).not.toContain('Details')
    const insightsButton = wrapper.find('button[aria-label="Open shared reading insights for Maya"]')
    expect(insightsButton.exists()).toBe(true)
    expect(insightsButton.classes()).toContain('bg-primary/10')
    expect(wrapper.find('nav').exists()).toBe(false)
    expect(wrapper.find('table').classes()).toContain('table-fixed')
  })

  it('renders a localized empty state', async () => {
    apiMock.mockImplementation(async (input: string) => ({
      ok: true,
      json: async () =>
        input === '/api/v1/account-activity/summary'
          ? { recent: 0, dormant: 0, never: 0, disabled: 0 }
          : { items: [], total: 0, page: 1, pageSize: 50 },
    }))

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No accounts found')
  })
})
