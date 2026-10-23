// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { EmailSendLogEntry } from '@bookorbit/types'

import { deliveryKind, deliveryReason, needsAttention } from '../email-delivery'

type Fields = Pick<EmailSendLogEntry, 'status' | 'attemptCount' | 'failureCode' | 'errorMessage'>

function fields(overrides: Partial<Fields> = {}): Fields {
  return { status: 'failed', attemptCount: 3, failureCode: null, errorMessage: null, ...overrides }
}

describe('deliveryKind', () => {
  it('tells a first try from a retry while a send is pending', () => {
    expect(deliveryKind(fields({ status: 'pending', attemptCount: 0 }))).toBe('sending')
    expect(deliveryKind(fields({ status: 'pending', attemptCount: 1 }))).toBe('retrying')
  })

  it('marks a send whose fate the server cannot know as unconfirmed, not failed', () => {
    expect(deliveryKind(fields({ failureCode: 'SMTP_OUTCOME_UNKNOWN' }))).toBe('unconfirmed')
    expect(deliveryKind(fields({ failureCode: 'SMTP_ACCEPTED_LOG_FAILED' }))).toBe('unconfirmed')
    expect(deliveryKind(fields({ errorMessage: 'Server restarted before send completed' }))).toBe('unconfirmed')
    expect(deliveryKind(fields({ errorMessage: '552 Message size exceeds fixed limit' }))).toBe('failed')
  })

  it('asks for attention only for sends that ended badly', () => {
    expect(needsAttention(fields({ status: 'sent' }))).toBe(false)
    expect(needsAttention(fields({ status: 'pending', attemptCount: 2 }))).toBe(false)
    expect(needsAttention(fields())).toBe(true)
    expect(needsAttention(fields({ failureCode: 'SEND_INTERRUPTED' }))).toBe(true)
  })
})

describe('deliveryReason', () => {
  it.each([
    ['552 5.3.4 Message size exceeds fixed maximum message size', 'tooLarge'],
    ['535-5.7.8 Username and Password not accepted', 'signIn'],
    ['connect ECONNREFUSED 10.0.0.4:587', 'unreachable'],
    ['Greeting never received', 'unreachable'],
    ['550 Mailbox unavailable', 'other'],
  ] as const)('reads %s as %s', (errorMessage, reason) => {
    expect(deliveryReason(fields({ errorMessage }))).toBe(reason)
  })

  it('prefers the stored failure code over the message text', () => {
    expect(deliveryReason(fields({ failureCode: 'SEND_INTERRUPTED', errorMessage: 'auth failed' }))).toBe('interrupted')
    expect(deliveryReason(fields({ failureCode: 'SMTP_OUTCOME_UNKNOWN' }))).toBe('unconfirmed')
    expect(deliveryReason(fields({ failureCode: 'DELIVERY_PREPARATION_FAILED' }))).toBe('preparation')
  })

  it('has nothing to say about a sent email or a failure with no text', () => {
    expect(deliveryReason(fields({ status: 'sent', errorMessage: '535 auth' }))).toBeNull()
    expect(deliveryReason(fields())).toBeNull()
  })
})
