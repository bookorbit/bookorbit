import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EmailServerRow from '../EmailServerRow.vue'
import type { EmailProvider } from '../../composables/useEmailProviders'

function provider(overrides: Partial<EmailProvider> = {}): EmailProvider {
  return {
    id: 2,
    userId: 1,
    name: 'Local mail catcher',
    host: 'localhost',
    port: 1025,
    username: null,
    fromName: null,
    fromAddress: 'books@example.test',
    auth: false,
    ssl: false,
    startTls: false,
    tlsRejectUnauthorized: true,
    isDefault: false,
    isShared: false,
    isSystemProvider: false,
    hasPassword: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    lastTestedAt: null,
    lastTestOk: null,
    lastTestError: null,
    ...overrides,
  }
}

describe('EmailServerRow', () => {
  it('says nothing about a working server', () => {
    const wrapper = mount(EmailServerRow, {
      props: { provider: provider({ lastTestOk: true, lastTestedAt: new Date().toISOString() }), isDefault: true, editable: true },
    })

    expect(wrapper.text()).toContain('localhost:1025')
    expect(wrapper.text()).toContain('No encryption')
    expect(wrapper.text()).not.toContain("Can't connect")
    expect(wrapper.text()).not.toContain('tested')
  })

  it('shows why a failing server cannot connect and when it was tested', () => {
    const wrapper = mount(EmailServerRow, {
      props: {
        provider: provider({ lastTestOk: false, lastTestError: 'connect ECONNREFUSED 127.0.0.1:1025', lastTestedAt: new Date().toISOString() }),
        isDefault: false,
        editable: true,
      },
    })

    expect(wrapper.text()).toContain("Can't connect")
    expect(wrapper.text()).toContain('connect ECONNREFUSED 127.0.0.1:1025')
    expect(wrapper.text()).toContain('tested')
  })

  it('names who else can use it', () => {
    const wrapper = mount(EmailServerRow, {
      props: { provider: provider({ isShared: true, isSystemProvider: true }), isDefault: false, editable: true },
    })

    expect(wrapper.text()).toContain('Shared with everyone')
    expect(wrapper.text()).toContain('Password resets')
  })

  it('tests and stars without opening the editor', async () => {
    const wrapper = mount(EmailServerRow, { props: { provider: provider(), isDefault: false, editable: true } })

    await wrapper.get('button[aria-label="Test Local mail catcher"]').trigger('click')
    await wrapper.get('button[aria-label="Make Local mail catcher the default server"]').trigger('click')
    expect(wrapper.emitted('test')).toHaveLength(1)
    expect(wrapper.emitted('makeDefault')).toHaveLength(1)
    expect(wrapper.emitted('edit')).toBeUndefined()
  })

  it("offers no edit or test on someone else's shared server", () => {
    const wrapper = mount(EmailServerRow, { props: { provider: provider({ userId: 9, isShared: true }), isDefault: false, editable: false } })

    expect(wrapper.find('button[aria-label="Edit Local mail catcher"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Test Local mail catcher"]').exists()).toBe(false)
  })

  it('hides the star from someone who cannot send', () => {
    const wrapper = mount(EmailServerRow, { props: { provider: provider(), isDefault: false, editable: true, canPickDefault: false } })

    expect(wrapper.find('button[aria-pressed]').exists()).toBe(false)
  })
})
