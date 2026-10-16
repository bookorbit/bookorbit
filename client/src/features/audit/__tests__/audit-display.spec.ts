// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AuditAction, AuditResource, type AuditLogEntry } from '@bookorbit/types'
import {
  getAuditCategory,
  getAuditFacts,
  getAuditPerson,
  getAuditSourceKind,
  getAuditTargetView,
  getAuditTone,
  isDestructiveAuditAction,
} from '../audit-display'

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    userId: 7,
    actorUsername: 'reader',
    action: AuditAction.LibraryUpdate,
    resource: AuditResource.Library,
    resourceId: 88,
    description: 'Updated library #88',
    ip: '127.0.0.1',
    meta: null,
    createdAt: '2026-10-16T06:15:23.000Z',
    targetLabel: 'Novels',
    targetExists: true,
    ...overrides,
  }
}

const labels = {
  untitled: 'Untitled',
  resource: (resource: string) => (resource === 'book_request' ? 'Book request' : resource === 'library' ? 'Library' : resource),
  withId: (resource: string, id: number) => `${resource === 'library' ? 'Library' : resource} #${id}`,
}

describe('audit display helpers', () => {
  it.each([
    [AuditAction.AuthLogin, 'access'],
    [AuditAction.BookRequestImport, 'requests'],
    [AuditAction.BookDockFinalize, 'books'],
    [AuditAction.MaintenanceMissingBooksClean, 'settings'],
    [AuditAction.KoboDeviceRename, 'devices'],
    ['club.create', 'other'],
  ])('places %s in %s', (action, category) => {
    expect(getAuditCategory(action)).toBe(category)
  })

  it('marks removals red, and failed sign-ins and permission changes amber', () => {
    expect(getAuditTone(AuditAction.LibraryDelete)).toBe('danger')
    expect(getAuditTone(AuditAction.LibraryAccessRevoke)).toBe('danger')
    expect(getAuditTone(AuditAction.BookBulkDelete)).toBe('danger')
    expect(getAuditTone(AuditAction.AuthLoginFailed)).toBe('warning')
    expect(getAuditTone(AuditAction.UserPermissionSet)).toBe('warning')
    expect(getAuditTone(AuditAction.LibraryUpdate)).toBeNull()
    expect(isDestructiveAuditAction(AuditAction.BookRequestRemoveDownload)).toBe(true)
    expect(isDestructiveAuditAction(AuditAction.AuthLoginFailed)).toBe(false)
  })

  it('tells people, the system and deleted accounts apart', () => {
    expect(getAuditPerson({ actorUsername: 'neon', userId: 1, actorName: 'Neon' })).toEqual({ kind: 'user', name: 'Neon', username: 'neon' })
    expect(getAuditPerson({ actorUsername: 'neon', userId: 1, actorName: null })).toEqual({ kind: 'user', name: 'neon', username: 'neon' })
    expect(getAuditPerson({ actorUsername: 'system', userId: null })).toMatchObject({ kind: 'system' })
    expect(getAuditPerson({ actorUsername: 'livetest', userId: null })).toEqual({ kind: 'deleted', name: 'livetest', username: 'livetest' })
  })

  it.each([
    ['127.0.0.1', 'server'],
    ['::1', 'server'],
    ['::ffff:127.0.0.1', 'server'],
    ['192.168.8.230', 'local'],
    ['10.0.0.4', 'local'],
    ['172.20.1.1', 'local'],
    ['fd12::1', 'local'],
    ['172.32.1.1', 'internet'],
    ['203.0.113.9', 'internet'],
  ])('reads %s as %s', (ip, kind) => {
    expect(getAuditSourceKind(ip, 'neon')).toBe(kind)
  })

  it('reads a missing address as a background job only for the system', () => {
    expect(getAuditSourceKind(null, 'system')).toBe('job')
    expect(getAuditSourceKind(null, 'neon')).toBe('unknown')
  })

  describe('target', () => {
    it('shows the current name of a target that still exists', () => {
      expect(getAuditTargetView(makeEntry(), labels)).toEqual({ name: 'Novels', unnamed: false, gone: null, more: 0, typeOnly: false })
    })

    it('says a target was removed by this event, or later', () => {
      expect(getAuditTargetView(makeEntry({ action: AuditAction.LibraryDelete, targetExists: false }), labels)?.gone).toBe('here')
      expect(getAuditTargetView(makeEntry({ targetExists: false }), labels)?.gone).toBe('since')
    })

    it('falls back to the type and id when no name was ever recorded', () => {
      expect(getAuditTargetView(makeEntry({ targetLabel: null, targetExists: false }), labels)).toMatchObject({
        name: 'Library #88',
        unnamed: true,
        gone: 'since',
      })
    })

    it('names the first deleted book and counts the rest', () => {
      const entry = makeEntry({
        action: AuditAction.BookBulkDelete,
        resource: AuditResource.Book,
        meta: {
          total: 3,
          books: [
            { id: 1, title: 'Dune' },
            { id: 2, title: null },
          ],
          omitted: 1,
        },
      })
      expect(getAuditTargetView(entry, labels)).toEqual({ name: 'Dune', unnamed: false, gone: 'here', more: 2, typeOnly: false })
    })

    it('shows the username a failed sign-in tried', () => {
      const entry = makeEntry({ action: AuditAction.AuthLoginFailed, resource: null, resourceId: null, meta: { attemptedUsername: 'test1' } })
      expect(getAuditTargetView(entry, labels)?.name).toBe('test1')
    })

    it('has no target for sign-ins, and only a type for bulk actions without an id', () => {
      expect(getAuditTargetView(makeEntry({ action: AuditAction.AuthLogin, resource: null, resourceId: null }), labels)).toBeNull()
      expect(
        getAuditTargetView(makeEntry({ action: AuditAction.BookRequestReject, resource: AuditResource.BookRequest, resourceId: null }), labels),
      ).toMatchObject({
        name: 'Book request',
        typeOnly: true,
      })
    })
  })

  it('pulls the facts an import and a cleanup carry', () => {
    const imported = makeEntry({
      action: AuditAction.BookRequestImport,
      meta: { format: 'm4b', sizeBytes: 687486346, downloadId: 325, bookDockFileId: 329 },
    })
    expect(getAuditFacts(imported)).toEqual([
      { key: 'format', value: 'M4B' },
      { key: 'size', value: 687486346 },
      { key: 'download', value: 325 },
      { key: 'dockFile', value: 329 },
    ])
    const cleaned = makeEntry({ action: AuditAction.MaintenanceOrphanedCoversClean, meta: { cleaned: 228, skipped: 0, remaining: 0 } })
    expect(getAuditFacts(cleaned).map((fact) => fact.key)).toEqual(['cleaned', 'skipped', 'remaining'])
    expect(getAuditFacts(makeEntry())).toEqual([])
  })
})
