import { describe, expect, it } from 'vitest'
import { SYSTEM_TABS, normalizeSystemTab } from '../lib/system-tabs'

describe('system-tabs', () => {
  describe('SYSTEM_TABS', () => {
    it('contains exactly file-naming, book-dock, requests, maintenance, audit-log', () => {
      expect(SYSTEM_TABS).toEqual(['file-naming', 'book-dock', 'requests', 'maintenance', 'audit-log'])
    })

    it('has length 5', () => {
      expect(SYSTEM_TABS.length).toBe(5)
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

    it('returns requests when given "requests"', () => {
      expect(normalizeSystemTab('requests')).toBe('requests')
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
