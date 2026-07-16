import { describe, expect, it } from 'vitest'
import { ACCOUNT_TABS, normalizeAccountTab } from '../lib/account-tabs'

describe('account-tabs', () => {
  describe('ACCOUNT_TABS', () => {
    it('contains the account settings tabs in display order', () => {
      expect(ACCOUNT_TABS).toEqual(['profile', 'privacy', 'notifications', 'restrictions'])
    })

    it('has length 4', () => {
      expect(ACCOUNT_TABS.length).toBe(4)
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

    it('returns privacy when given "privacy"', () => {
      expect(normalizeAccountTab('privacy')).toBe('privacy')
    })

    it('returns restrictions when given "restrictions"', () => {
      expect(normalizeAccountTab('restrictions')).toBe('restrictions')
    })

    it('is case-sensitive (Profile is not valid)', () => {
      expect(normalizeAccountTab('Profile')).toBe('profile')
    })
  })
})
