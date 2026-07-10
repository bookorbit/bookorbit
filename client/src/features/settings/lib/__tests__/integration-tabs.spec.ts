import { describe, expect, it } from 'vitest'
import { Permission } from '@bookorbit/types'
import { INTEGRATION_TAB_INFO, INTEGRATION_TABS, normalizeIntegrationTab } from '../integration-tabs'

describe('integration-tabs', () => {
  it('contains Hardcover, Readwise, and StoryGraph', () => {
    expect(INTEGRATION_TABS).toEqual(['hardcover', 'readwise', 'storygraph'])
  })

  it('associates each tab with its sync permission', () => {
    expect(INTEGRATION_TAB_INFO.hardcover.permission).toBe(Permission.HardcoverSync)
    expect(INTEGRATION_TAB_INFO.readwise.permission).toBe(Permission.ReadwiseSync)
    expect(INTEGRATION_TAB_INFO.storygraph.permission).toBe(Permission.StorygraphSync)
  })

  it('defaults to Hardcover for an invalid tab', () => {
    expect(normalizeIntegrationTab(undefined)).toBe('hardcover')
    expect(normalizeIntegrationTab('unknown')).toBe('hardcover')
  })

  it('accepts each integration tab', () => {
    expect(normalizeIntegrationTab('hardcover')).toBe('hardcover')
    expect(normalizeIntegrationTab('readwise')).toBe('readwise')
    expect(normalizeIntegrationTab('storygraph')).toBe('storygraph')
  })
})
