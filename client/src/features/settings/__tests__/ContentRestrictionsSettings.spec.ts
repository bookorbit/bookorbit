import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ContentRestrictionsSettings from '../ContentRestrictionsSettings.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

describe('ContentRestrictionsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('contains the loading state on the standard settings surface', () => {
    apiMock.mockReturnValue(new Promise(() => undefined))

    const wrapper = mount(ContentRestrictionsSettings)

    expect(wrapper.get('[data-testid="restrictions-loading-state"]').classes()).toContain('settings-loading-state')
  })

  it('contains the unrestricted empty state on the standard settings surface', async () => {
    apiMock.mockResolvedValue({
      ok: true,
      json: async () => ({ includeTags: [], excludeTags: [], includeGenres: [], excludeGenres: [] }),
    })

    const wrapper = mount(ContentRestrictionsSettings)
    await flushPromises()

    expect(wrapper.get('[data-testid="restrictions-empty-state"]').classes()).toContain('settings-empty-state')
  })

  it('groups configured restriction rules into one surfaced card', async () => {
    apiMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        includeTags: [{ id: 1, name: 'Allowed tag' }],
        excludeTags: [{ id: 2, name: 'Blocked tag' }],
        includeGenres: [{ id: 3, name: 'Allowed genre' }],
        excludeGenres: [{ id: 4, name: 'Blocked genre' }],
      }),
    })

    const wrapper = mount(ContentRestrictionsSettings)
    await flushPromises()

    expect(wrapper.get('[data-testid="restrictions-rules-card"]').classes()).toContain('settings-card')
    expect(wrapper.text()).toContain('Allowed tag')
    expect(wrapper.text()).toContain('Blocked genre')
  })
})
