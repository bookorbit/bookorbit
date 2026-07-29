import { describe, expect, it } from 'vitest'
import { AuditAction, type AuditLogEntry } from '@bookorbit/types'
import { getBookDeletionAuditMeta } from '../audit-meta'

function makeEntry(meta: Record<string, unknown> | null, action = AuditAction.BookBulkDelete): AuditLogEntry {
  return {
    id: 1,
    userId: 7,
    actorUsername: 'reader',
    action,
    resource: 'book',
    resourceId: null,
    description: 'Deleted 2 books',
    ip: '127.0.0.1',
    meta,
    createdAt: '2026-07-26T00:00:00.000Z',
  }
}

describe('getBookDeletionAuditMeta', () => {
  it('returns validated deletion details', () => {
    const meta = {
      total: 2,
      books: [
        { id: 10, title: 'Dune' },
        { id: 11, title: null },
      ],
      omitted: 0,
    }

    expect(getBookDeletionAuditMeta(makeEntry(meta))).toEqual(meta)
  })

  it('rejects malformed and non-deletion metadata', () => {
    expect(getBookDeletionAuditMeta(makeEntry({ total: 2, books: [{ id: 10, title: 'Dune' }], omitted: 0 }))).toBeNull()
    expect(getBookDeletionAuditMeta(makeEntry({ total: 1, books: [{ id: -1, title: 'Dune' }], omitted: 0 }))).toBeNull()
    expect(getBookDeletionAuditMeta(makeEntry({ total: 0, books: [], omitted: 0 }, AuditAction.AuthLogin))).toBeNull()
  })
})
