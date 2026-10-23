import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { EmailRecipient } from '@bookorbit/types'

import EmailRecipientRow from '../EmailRecipientRow.vue'

vi.mock('@/features/book/components/BookCoverImage.vue', () => ({ default: { template: '<img alt="" />' } }))

function recipient(overrides: Partial<EmailRecipient> = {}): EmailRecipient {
  return {
    id: 4,
    userId: 1,
    name: 'PocketBook Era',
    email: 'era@pbsync.com',
    isDefault: false,
    deviceType: 'other',
    preferredFormat: 'epub',
    defaultTemplateId: null,
    readAloudDelivery: 'original',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastSend: null,
    ...overrides,
  } as EmailRecipient
}

function lastSend(status: 'pending' | 'sent' | 'failed', extra: Record<string, unknown> = {}) {
  return {
    bookId: 8,
    bookTitle: 'Dune',
    status,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    failureCode: null,
    errorMessage: null,
    ...extra,
  }
}

describe('EmailRecipientRow', () => {
  it('shows the address, device, format and narration on one line', () => {
    const wrapper = mount(EmailRecipientRow, { props: { recipient: recipient(), isDefault: false } })

    expect(wrapper.text()).toContain('era@pbsync.com')
    expect(wrapper.text()).toContain('E-reader')
    expect(wrapper.text()).toContain('EPUB')
    expect(wrapper.text()).toContain('Narration')
    expect(wrapper.text()).toContain('Nothing sent yet')
  })

  it.each([
    ['failed', {}, 'failed'],
    ['pending', { attemptCount: 1 }, 'retrying'],
    ['failed', { failureCode: 'SMTP_OUTCOME_UNKNOWN' }, 'unconfirmed'],
  ] as const)('says when the last send is %s with %o', (status, extra, word) => {
    const wrapper = mount(EmailRecipientRow, { props: { recipient: recipient({ lastSend: lastSend(status, extra) }), isDefault: false } })

    expect(wrapper.text()).toContain('Dune')
    expect(wrapper.text()).toContain(word)
  })

  it('opens the editor from the row and stars without opening it', async () => {
    const wrapper = mount(EmailRecipientRow, { props: { recipient: recipient(), isDefault: false } })

    await wrapper.get('button[aria-label="Make PocketBook Era the default recipient"]').trigger('click')
    expect(wrapper.emitted('makeDefault')).toHaveLength(1)
    expect(wrapper.emitted('edit')).toBeUndefined()

    await wrapper.get('button[aria-label="Edit PocketBook Era"]').trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)
  })

  it('does nothing when the default is starred again', async () => {
    const wrapper = mount(EmailRecipientRow, { props: { recipient: recipient(), isDefault: true } })

    const star = wrapper.get('button[aria-pressed="true"]')
    expect(star.attributes('aria-label')).toBe('Default recipient')
    await star.trigger('click')
    expect(wrapper.emitted('makeDefault')).toBeUndefined()
  })
})
