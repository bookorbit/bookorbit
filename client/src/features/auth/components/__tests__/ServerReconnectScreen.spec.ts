import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import ServerReconnectScreen from '../ServerReconnectScreen.vue'

const retryNowMock = vi.hoisted(() => vi.fn<() => Promise<void>>())

vi.mock('../../composables/useSessionBootstrap', () => ({
  useSessionBootstrap: () => ({ retryNow: retryNowMock }),
}))

vi.mock('../AuthAppearanceToolbar.vue', () => ({
  default: { name: 'AuthAppearanceToolbar', template: '<div />' },
}))

describe('ServerReconnectScreen', () => {
  it('names the wait and announces why', () => {
    const wrapper = mount(ServerReconnectScreen)

    expect(wrapper.get('h1').text()).toBe('Waiting for the server')
    expect(wrapper.get('[role="status"]').text()).toContain("can't reach its server")
  })

  it('asks the server again on demand and shows the attempt in progress', async () => {
    let finish!: () => void
    retryNowMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = mount(ServerReconnectScreen)

    await wrapper.get('form').trigger('submit')

    expect(retryNowMock).toHaveBeenCalledTimes(1)
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
    finish()
    await flushPromises()
    expect(wrapper.get('button').attributes('aria-busy')).toBeUndefined()
  })
})
