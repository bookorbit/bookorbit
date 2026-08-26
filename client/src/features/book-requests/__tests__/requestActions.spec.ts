// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BOOK_REQUEST_STATUSES } from '@bookorbit/types'
import type { BookRequestDownloadItem, BookRequestItem, BookRequestStatus } from '@bookorbit/types'
import { canBulkActRequest, canCancelRequest, canDeleteRequest, canDismissRequest, cancelStopsATransfer } from '../requestActions'

const OWNER = 4
const STRANGER = 9

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return { id: 1, userId: OWNER, status: 'pending', dismissed: false, download: null, ...overrides } as BookRequestItem
}

function withDownload(status: BookRequestDownloadItem['status']): BookRequestItem {
  return request({ status: 'downloading', download: { id: 7, status } as BookRequestDownloadItem })
}

describe('canCancelRequest', () => {
  it('lets the owner stop anything that has not settled', () => {
    const open: BookRequestStatus[] = ['pending', 'approved', 'searching', 'grabbed', 'downloading', 'importing', 'needs_review', 'failed']

    for (const status of open) {
      expect(canCancelRequest(request({ status }), OWNER, false)).toBe(true)
    }
  })

  it.each(['rejected', 'cancelled', 'available'] as const)('offers nothing on a request that already settled as %s', (status) => {
    expect(canCancelRequest(request({ status }), OWNER, true)).toBe(false)
  })

  it('refuses a stranger and allows a moderator', () => {
    expect(canCancelRequest(request(), STRANGER, false)).toBe(false)
    expect(canCancelRequest(request(), STRANGER, true)).toBe(true)
  })

  /** A signed-out render must not read as ownership of a request whose userId happens to be null. */
  it('does not treat an unknown viewer as the owner', () => {
    expect(canCancelRequest(request({ userId: null as unknown as number }), null, false)).toBe(false)
  })

  /**
   * A self-fulfiller whose submission collided with this request was handed it to drive, and they
   * are the only person who can stop the transfer they started on it.
   */
  it('lets the self-fulfiller who was handed the request stop it', () => {
    const handedOver = request({ userId: OWNER, fulfillerUserId: STRANGER })

    expect(canCancelRequest(handedOver, STRANGER, false, true)).toBe(true)
  })

  /** The permission can be taken away after the request was handed over; the server checks it too. */
  it('offers nothing to a fulfiller who no longer holds the permission', () => {
    const handedOver = request({ userId: OWNER, fulfillerUserId: STRANGER })

    expect(canCancelRequest(handedOver, STRANGER, false, false)).toBe(false)
  })

  /** The requester keeps their own row: handing it over does not take it off their list. */
  it('still lets the original requester stop a request somebody else drives', () => {
    const handedOver = request({ userId: OWNER, fulfillerUserId: STRANGER })

    expect(canCancelRequest(handedOver, OWNER, false)).toBe(true)
  })
})

describe('canDismissRequest', () => {
  it.each(['rejected', 'cancelled', 'available', 'failed'] as const)('hides a settled %s request', (status) => {
    expect(canDismissRequest(request({ status }))).toBe(true)
  })

  it('refuses to hide work that is still running', () => {
    for (const status of BOOK_REQUEST_STATUSES.filter((s) => !['rejected', 'cancelled', 'available', 'failed'].includes(s))) {
      expect(canDismissRequest(request({ status }))).toBe(false)
    }
  })
})

describe('canDeleteRequest', () => {
  it('is a moderator action on a settled request', () => {
    expect(canDeleteRequest(request({ status: 'available' }), true)).toBe(true)
    expect(canDeleteRequest(request({ status: 'available' }), false)).toBe(false)
    expect(canDeleteRequest(request({ status: 'downloading' }), true)).toBe(false)
  })
})

describe('cancelStopsATransfer', () => {
  it.each(['queued', 'downloading', 'completed', 'importing'] as const)('warns when the client is still holding a %s attempt', (status) => {
    expect(cancelStopsATransfer(withDownload(status))).toBe(true)
  })

  it('does not warn about a request that never reached a download client', () => {
    expect(cancelStopsATransfer(request({ status: 'searching' }))).toBe(false)
  })

  it('does not warn once the attempt is finished with', () => {
    expect(cancelStopsATransfer(withDownload('imported'))).toBe(false)
    expect(cancelStopsATransfer(withDownload('failed'))).toBe(false)
  })
})

describe('canBulkActRequest', () => {
  it('offers a checkbox on a pending row only to someone who could approve it', () => {
    expect(canBulkActRequest(request({ status: 'pending' }), true)).toBe(true)
    expect(canBulkActRequest(request({ status: 'pending' }), false)).toBe(false)
  })

  it.each(['rejected', 'cancelled', 'available', 'failed'] as const)('offers a checkbox on a settled %s row to anyone', (status) => {
    expect(canBulkActRequest(request({ status }), false)).toBe(true)
  })

  it('offers nothing on a row that is already hidden, since hiding is the action', () => {
    expect(canBulkActRequest(request({ status: 'available', dismissed: true }), true)).toBe(false)
  })

  it.each(['approved', 'searching', 'grabbed', 'downloading', 'importing', 'needs_review'] as const)(
    'offers nothing mid-flight at %s, where neither bulk action applies',
    (status) => {
      expect(canBulkActRequest(request({ status }), true)).toBe(false)
    },
  )
})
