import { describe, expect, it } from 'vitest'
import { Permission } from '@bookorbit/types'
import { INTEGRATIONS_TABS, INTEGRATIONS_TAB_INFO, normalizeIntegrationsTab } from '../lib/integrations-tabs'

describe('integrations-tabs', () => {
  describe('INTEGRATIONS_TABS', () => {
    it('contains exactly kobo, koreader, hardcover', () => {
      expect(INTEGRATIONS_TABS).toEqual(['kobo', 'koreader', 'hardcover'])
    })

    it('is readonly (length is 3)', () => {
      expect(INTEGRATIONS_TABS.length).toBe(3)
    })
  })

  describe('INTEGRATIONS_TAB_INFO', () => {
    it('has an entry for every tab', () => {
      for (const tab of INTEGRATIONS_TABS) {
        expect(INTEGRATIONS_TAB_INFO[tab]).toBeDefined()
      }
    })

    it('every entry has navLabel, titleLabel, subtitle, and permission', () => {
      for (const tab of INTEGRATIONS_TABS) {
        const info = INTEGRATIONS_TAB_INFO[tab]
        expect(typeof info.navLabel).toBe('string')
        expect(info.navLabel.length).toBeGreaterThan(0)
        expect(typeof info.titleLabel).toBe('string')
        expect(info.titleLabel.length).toBeGreaterThan(0)
        expect(typeof info.subtitle).toBe('string')
        expect(info.subtitle.length).toBeGreaterThan(0)
        expect(typeof info.permission).toBe('string')
      }
    })

    it('kobo entry has correct labels', () => {
      expect(INTEGRATIONS_TAB_INFO.kobo.navLabel).toBe('Kobo')
      expect(INTEGRATIONS_TAB_INFO.kobo.titleLabel).toBe('Kobo Sync')
      expect(INTEGRATIONS_TAB_INFO.kobo.permission).toBe(Permission.KoboSync)
    })

    it('koreader entry has correct labels', () => {
      expect(INTEGRATIONS_TAB_INFO.koreader.navLabel).toBe('KOReader')
      expect(INTEGRATIONS_TAB_INFO.koreader.titleLabel).toBe('KOReader Sync')
      expect(INTEGRATIONS_TAB_INFO.koreader.permission).toBe(Permission.KoreaderSync)
    })

    it('hardcover entry has correct labels', () => {
      expect(INTEGRATIONS_TAB_INFO.hardcover.navLabel).toBe('Hardcover')
      expect(INTEGRATIONS_TAB_INFO.hardcover.titleLabel).toBe('Hardcover')
      expect(INTEGRATIONS_TAB_INFO.hardcover.permission).toBe(Permission.HardcoverSync)
    })
  })

  describe('normalizeIntegrationsTab', () => {
    it('returns kobo for undefined', () => {
      expect(normalizeIntegrationsTab(undefined)).toBe('kobo')
    })

    it('returns kobo for null', () => {
      expect(normalizeIntegrationsTab(null)).toBe('kobo')
    })

    it('returns kobo for empty string', () => {
      expect(normalizeIntegrationsTab('')).toBe('kobo')
    })

    it('returns kobo for unknown string', () => {
      expect(normalizeIntegrationsTab('unknown')).toBe('kobo')
    })

    it('returns kobo for number input', () => {
      expect(normalizeIntegrationsTab(42)).toBe('kobo')
    })

    it('returns kobo for object input', () => {
      expect(normalizeIntegrationsTab({})).toBe('kobo')
    })

    it('returns kobo when given "kobo"', () => {
      expect(normalizeIntegrationsTab('kobo')).toBe('kobo')
    })

    it('returns koreader when given "koreader"', () => {
      expect(normalizeIntegrationsTab('koreader')).toBe('koreader')
    })

    it('returns hardcover when given "hardcover"', () => {
      expect(normalizeIntegrationsTab('hardcover')).toBe('hardcover')
    })

    it('is case-sensitive (Kobo is not a valid tab)', () => {
      expect(normalizeIntegrationsTab('Kobo')).toBe('kobo')
    })

    it('falls back to first allowed tab when current tab is not allowed', () => {
      expect(normalizeIntegrationsTab('kobo', ['koreader', 'hardcover'])).toBe('koreader')
    })

    it('returns the allowed tab when current tab is allowed', () => {
      expect(normalizeIntegrationsTab('hardcover', ['koreader', 'hardcover'])).toBe('hardcover')
    })
  })
})
