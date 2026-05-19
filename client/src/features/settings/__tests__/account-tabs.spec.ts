import { describe, expect, it } from 'vitest'
import { ACCOUNT_TABS, ACCOUNT_TAB_INFO, normalizeAccountTab } from '../lib/account-tabs'

describe('account-tabs', () => {
  describe('ACCOUNT_TABS', () => {
    it('contains exactly profile and notifications', () => {
      expect(ACCOUNT_TABS).toEqual(['profile', 'notifications'])
    })

    it('has length 2', () => {
      expect(ACCOUNT_TABS.length).toBe(2)
    })
  })

  describe('ACCOUNT_TAB_INFO', () => {
    it('has an entry for every tab', () => {
      for (const tab of ACCOUNT_TABS) {
        expect(ACCOUNT_TAB_INFO[tab]).toBeDefined()
      }
    })

    it('every entry has navLabel, titleLabel, and subtitle', () => {
      for (const tab of ACCOUNT_TABS) {
        const info = ACCOUNT_TAB_INFO[tab]
        expect(typeof info.navLabel).toBe('string')
        expect(info.navLabel.length).toBeGreaterThan(0)
        expect(typeof info.titleLabel).toBe('string')
        expect(info.titleLabel.length).toBeGreaterThan(0)
        expect(typeof info.subtitle).toBe('string')
        expect(info.subtitle.length).toBeGreaterThan(0)
      }
    })

    it('profile entry has correct labels', () => {
      expect(ACCOUNT_TAB_INFO.profile.navLabel).toBe('Profile')
      expect(ACCOUNT_TAB_INFO.profile.titleLabel).toBe('Account')
    })

    it('notifications entry has correct labels', () => {
      expect(ACCOUNT_TAB_INFO.notifications.navLabel).toBe('Notifications')
      expect(ACCOUNT_TAB_INFO.notifications.titleLabel).toBe('Notifications')
    })
  })

  describe('normalizeAccountTab', () => {
    it('returns profile for undefined', () => {
      expect(normalizeAccountTab(undefined)).toBe('profile')
    })

    it('returns profile for null', () => {
      expect(normalizeAccountTab(null)).toBe('profile')
    })

    it('returns profile for empty string', () => {
      expect(normalizeAccountTab('')).toBe('profile')
    })

    it('returns profile for unknown string', () => {
      expect(normalizeAccountTab('unknown')).toBe('profile')
    })

    it('returns profile for number input', () => {
      expect(normalizeAccountTab(42)).toBe('profile')
    })

    it('returns profile when given "profile"', () => {
      expect(normalizeAccountTab('profile')).toBe('profile')
    })

    it('returns notifications when given "notifications"', () => {
      expect(normalizeAccountTab('notifications')).toBe('notifications')
    })

    it('is case-sensitive (Profile is not valid)', () => {
      expect(normalizeAccountTab('Profile')).toBe('profile')
    })
  })
})
