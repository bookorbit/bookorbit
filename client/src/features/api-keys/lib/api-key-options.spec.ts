import { describe, expect, it } from 'vitest'
import { apiKeyState, defaultExpiryChoice, expiryChoices, maskedToken } from './api-key-options'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-07T12:00:00.000Z')

describe('expiryChoices', () => {
  it('offers every preset, Never included, when the server sets no cap', () => {
    const choices = expiryChoices(null)
    expect(choices.map((choice) => choice.days)).toEqual([30, 90, 365, null])
    expect(defaultExpiryChoice(choices)).toBe('90')
    expect(choices.find((choice) => choice.id === 'never')?.request).toBeNull()
  })

  it('hides Never and every preset above the cap', () => {
    const choices = expiryChoices(365)
    expect(choices.map((choice) => choice.days)).toEqual([30, 90, 365])
    expect(defaultExpiryChoice(choices)).toBe('90')
  })

  it('offers the server default when a cap leaves no preset at the default lifetime', () => {
    const choices = expiryChoices(60)
    expect(choices.map((choice) => [choice.id, choice.days])).toEqual([
      ['30', 30],
      ['server-default', 60],
    ])
    expect(choices.find((choice) => choice.id === 'server-default')?.request).toBeUndefined()
    expect(defaultExpiryChoice(choices)).toBe('server-default')
  })

  it('still leaves something to choose under a cap shorter than every preset', () => {
    const choices = expiryChoices(7)
    expect(choices).toEqual([{ id: 'server-default', days: 7, request: undefined }])
    expect(defaultExpiryChoice(choices)).toBe('server-default')
  })
})

describe('apiKeyState', () => {
  it('reads revoked before anything about expiry', () => {
    expect(apiKeyState({ revokedAt: '2026-11-01T00:00:00.000Z', expiresAt: null }, NOW)).toBe('revoked')
  })

  it('marks a key expiring within a week as expiring soon', () => {
    expect(apiKeyState({ revokedAt: null, expiresAt: null }, NOW)).toBe('active')
    expect(apiKeyState({ revokedAt: null, expiresAt: new Date(NOW + 30 * DAY).toISOString() }, NOW)).toBe('active')
    expect(apiKeyState({ revokedAt: null, expiresAt: new Date(NOW + 6 * DAY).toISOString() }, NOW)).toBe('expiring')
    expect(apiKeyState({ revokedAt: null, expiresAt: new Date(NOW - 1000).toISOString() }, NOW)).toBe('expired')
  })
})

describe('maskedToken', () => {
  it('shows only the prefix and the hint', () => {
    expect(maskedToken('a1B2')).toBe('bok_…a1B2')
  })
})
