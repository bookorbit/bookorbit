import { describe, expect, it } from 'vitest'
import { ADMIN_TABS, ADMIN_TAB_INFO, normalizeAdminTab } from '../lib/admin-tabs'

describe('admin-tabs', () => {
  describe('ADMIN_TABS', () => {
    it('contains exactly users, oidc, and magic-links', () => {
      expect(ADMIN_TABS).toEqual(['users', 'oidc', 'magic-links'])
    })

    it('has length 3', () => {
      expect(ADMIN_TABS.length).toBe(3)
    })
  })

  describe('ADMIN_TAB_INFO', () => {
    it('has an entry for every tab', () => {
      for (const tab of ADMIN_TABS) {
        expect(ADMIN_TAB_INFO[tab]).toBeDefined()
      }
    })

    it('every entry has navLabel, titleLabel, subtitle, and permission', () => {
      for (const tab of ADMIN_TABS) {
        const info = ADMIN_TAB_INFO[tab]
        expect(typeof info.navLabel).toBe('string')
        expect(info.navLabel.length).toBeGreaterThan(0)
        expect(typeof info.titleLabel).toBe('string')
        expect(info.titleLabel.length).toBeGreaterThan(0)
        expect(typeof info.subtitle).toBe('string')
        expect(info.subtitle.length).toBeGreaterThan(0)
        expect(info.permission === null || typeof info.permission === 'string').toBe(true)
      }
    })

    it('users entry has manage_users permission', () => {
      expect(ADMIN_TAB_INFO.users.permission).toBe('manage_users')
    })

    it('oidc entry has manage_app_settings permission', () => {
      expect(ADMIN_TAB_INFO.oidc.permission).toBe('manage_app_settings')
    })

    it('magic-links entry is superuser-only', () => {
      expect(ADMIN_TAB_INFO['magic-links'].permission).toBeNull()
    })

    it('users entry has correct labels', () => {
      expect(ADMIN_TAB_INFO.users.navLabel).toBe('Users')
      expect(ADMIN_TAB_INFO.users.titleLabel).toBe('Users')
    })

    it('magic-links entry has correct labels', () => {
      expect(ADMIN_TAB_INFO['magic-links'].navLabel).toBe('Magic Links')
      expect(ADMIN_TAB_INFO['magic-links'].titleLabel).toBe('Magic Links')
    })

    it('oidc entry has correct labels', () => {
      expect(ADMIN_TAB_INFO.oidc.navLabel).toBe('OIDC / SSO')
      expect(ADMIN_TAB_INFO.oidc.titleLabel).toBe('OIDC / SSO')
    })
  })

  describe('normalizeAdminTab', () => {
    it('returns users for undefined', () => {
      expect(normalizeAdminTab(undefined)).toBe('users')
    })

    it('returns users for null', () => {
      expect(normalizeAdminTab(null)).toBe('users')
    })

    it('returns users for empty string', () => {
      expect(normalizeAdminTab('')).toBe('users')
    })

    it('returns users for unknown string', () => {
      expect(normalizeAdminTab('unknown')).toBe('users')
    })

    it('returns users for number input', () => {
      expect(normalizeAdminTab(42)).toBe('users')
    })

    it('returns users when given "users"', () => {
      expect(normalizeAdminTab('users')).toBe('users')
    })

    it('returns oidc when given "oidc"', () => {
      expect(normalizeAdminTab('oidc')).toBe('oidc')
    })

    it('returns magic-links when given "magic-links"', () => {
      expect(normalizeAdminTab('magic-links')).toBe('magic-links')
    })

    it('is case-sensitive (Users is not valid)', () => {
      expect(normalizeAdminTab('Users')).toBe('users')
    })
  })
})
