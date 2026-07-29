import { describe, expect, it } from 'vitest'
import { AuditAction, type AuditLogEntry } from '@bookorbit/types'
import { getAuditCategory, getAuditTarget, isDestructiveAuditAction } from '../audit-display'

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    userId: 7,
    actorUsername: 'reader',
    action: AuditAction.BookDelete,
    resource: 'book',
    resourceId: 10,
    description: 'Deleted book',
    ip: null,
    meta: null,
    createdAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('audit display helpers', () => {
  it.each([
    [AuditAction.AuthLogin, 'authentication'],
    [AuditAction.BookDelete, 'books'],
    [AuditAction.UserUpdate, 'users'],
    [AuditAction.LibraryUpdate, 'libraries'],
    [AuditAction.CollectionUpdate, 'collections'],
    [AuditAction.KoboDeviceRename, 'integrations'],
    [AuditAction.AppSettingsUpdate, 'settings'],
  ])('classifies %s as %s', (action, category) => {
    expect(getAuditCategory(action)).toBe(category)
  })

  it('marks destructive and failed actions', () => {
    expect(isDestructiveAuditAction(AuditAction.BookDelete)).toBe(true)
    expect(isDestructiveAuditAction(AuditAction.AuthLoginFailed)).toBe(true)
    expect(isDestructiveAuditAction(AuditAction.BookMetadataUpdate)).toBe(false)
  })

  it('uses deletion titles as the target and summarizes remaining books', () => {
    const entry = makeEntry({
      action: AuditAction.BookBulkDelete,
      meta: {
        total: 5,
        books: [
          { id: 1, title: 'Dune' },
          { id: 2, title: null },
          { id: 3, title: 'Hyperion' },
        ],
        omitted: 2,
      },
    })

    expect(getAuditTarget(entry, 'Untitled', (count) => `and ${count} more`)).toBe('Dune, Untitled, Hyperion and 2 more')
  })

  it('falls back to the structured resource target', () => {
    expect(getAuditTarget(makeEntry(), 'Untitled', String, () => 'Book')).toBe('Book #10')
  })
})
