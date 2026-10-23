// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { normalizeEmailTab } from '../email-tabs'

describe('normalizeEmailTab', () => {
  it('keeps the four tabs the page has', () => {
    for (const tab of ['recipients', 'servers', 'templates', 'history']) expect(normalizeEmailTab(tab)).toBe(tab)
  })

  it('lands links to the old tabs where their content now lives', () => {
    expect(normalizeEmailTab('providers')).toBe('servers')
    expect(normalizeEmailTab('groups')).toBe('recipients')
    expect(normalizeEmailTab('preferences')).toBe('recipients')
  })

  it('falls back to recipients for anything else', () => {
    expect(normalizeEmailTab(undefined)).toBe('recipients')
    expect(normalizeEmailTab('outbox')).toBe('recipients')
    expect(normalizeEmailTab(['history'])).toBe('recipients')
  })
})
