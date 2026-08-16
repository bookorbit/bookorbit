import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'

import AccountActivityPage from '../AccountActivityPage.vue'

const apiMock = vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()

vi.mock('@/lib/api', () => ({ api: (input: string) => apiMock(input) }))

const componentStubs = {
  Button: { props: ['variant'], template: '<button :data-variant="variant"><slot /></button>' },
}

function mountPage() {
  return shallowMount(AccountActivityPage, { global: { stubs: componentStubs } })
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

  it('renders account activity without duplicating the settings page header', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Review account authentication activity without exposing reading history.')
    expect(wrapper.text()).toContain('Reader')
    expect(wrapper.text()).toContain('No recorded activity')
    expect(wrapper.text()).not.toContain('Details')
    const insightsButton = wrapper.find('button[aria-label="Open shared reading insights for Maya"]')
    expect(insightsButton.exists()).toBe(true)
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
