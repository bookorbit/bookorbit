import { describe, expect, it } from 'vitest'
import { SYSTEM_TABS, SYSTEM_TAB_INFO, normalizeSystemTab } from '../lib/system-tabs'

describe('system-tabs', () => {
  describe('SYSTEM_TABS', () => {
    it('contains exactly file-naming, book-dock, maintenance, audit-log', () => {
      expect(SYSTEM_TABS).toEqual(['file-naming', 'book-dock', 'maintenance', 'audit-log'])
    })

    it('has length 4', () => {
      expect(SYSTEM_TABS.length).toBe(4)
    })
  })

  describe('SYSTEM_TAB_INFO', () => {
    it('has an entry for every tab', () => {
      for (const tab of SYSTEM_TABS) {
        expect(SYSTEM_TAB_INFO[tab]).toBeDefined()
      }
    })

    it('every entry has a permission', () => {
      for (const tab of SYSTEM_TABS) {
        const info = SYSTEM_TAB_INFO[tab]
        expect(info.permission === null || typeof info.permission === 'string').toBe(true)
      }
    })

    it('file-naming has manage_app_settings permission', () => {
      expect(SYSTEM_TAB_INFO['file-naming'].permission).toBe('manage_app_settings')
    })

    it('book-dock has book_dock_access permission', () => {
      expect(SYSTEM_TAB_INFO['book-dock'].permission).toBe('book_dock_access')
    })

    it('maintenance has manage_app_settings permission', () => {
      expect(SYSTEM_TAB_INFO.maintenance.permission).toBe('manage_app_settings')
    })

    it('audit-log has null permission (superuser only)', () => {
      expect(SYSTEM_TAB_INFO['audit-log'].permission).toBeNull()
    })
  })

  describe('normalizeSystemTab', () => {
    it('returns file-naming for undefined', () => {
      expect(normalizeSystemTab(undefined)).toBe('file-naming')
    })

    it('returns file-naming for null', () => {
      expect(normalizeSystemTab(null)).toBe('file-naming')
    })

    it('returns file-naming for empty string', () => {
      expect(normalizeSystemTab('')).toBe('file-naming')
    })

    it('returns file-naming for unknown string', () => {
      expect(normalizeSystemTab('unknown')).toBe('file-naming')
    })

    it('returns file-naming for number input', () => {
      expect(normalizeSystemTab(42)).toBe('file-naming')
    })

    it('returns file-naming when given "file-naming"', () => {
      expect(normalizeSystemTab('file-naming')).toBe('file-naming')
    })

    it('returns book-dock when given "book-dock"', () => {
      expect(normalizeSystemTab('book-dock')).toBe('book-dock')
    })

    it('returns maintenance when given "maintenance"', () => {
      expect(normalizeSystemTab('maintenance')).toBe('maintenance')
    })

    it('returns audit-log when given "audit-log"', () => {
      expect(normalizeSystemTab('audit-log')).toBe('audit-log')
    })

    it('is case-sensitive (Maintenance is not valid)', () => {
      expect(normalizeSystemTab('Maintenance')).toBe('file-naming')
    })
  })
})
