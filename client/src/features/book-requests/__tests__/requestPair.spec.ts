// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookRequestAvailability, BookRequestItem } from '@bookorbit/types'
import {
  flattenRequestRows,
  orderedHalves,
  pairActionKey,
  pairHalfState,
  pairRowActions,
  pairSubmission,
  pairSubmissionLabelKey,
  type PairAvailability,
} from '../requestPair'

const OWNED: BookRequestAvailability = { ownedBookId: 42, existingRequestId: null, existingRequestStatus: null, alreadySubscribed: false }
const FOLLOWING: BookRequestAvailability = { ownedBookId: null, existingRequestId: 7, existingRequestStatus: 'pending', alreadySubscribed: true }
const JOINABLE: BookRequestAvailability = { ownedBookId: null, existingRequestId: 8, existingRequestStatus: 'pending', alreadySubscribed: false }

function pair(ebook: BookRequestAvailability | null, audiobook: BookRequestAvailability | null): PairAvailability {
  return { ebook, audiobook }
}

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 1,
    userId: 4,
    mediaKind: 'ebook',
    status: 'pending',
    dismissed: false,
    download: null,
    fulfillerUserId: null,
    ...overrides,
  } as BookRequestItem
}

describe('pairHalfState', () => {
  it('reads ownership ahead of any request, and tells a request you follow from one you could join', () => {
    expect(pairHalfState(null)).toBe('new')
    expect(pairHalfState(OWNED)).toBe('owned')
    expect(pairHalfState({ ...OWNED, existingRequestId: 3, alreadySubscribed: true })).toBe('owned')
    expect(pairHalfState(FOLLOWING)).toBe('following')
    expect(pairHalfState(JOINABLE)).toBe('joinable')
  })
})

describe('pairSubmission', () => {
  it('sends both halves as a pair when neither has been asked for', () => {
    expect(pairSubmission(pair(null, null))).toEqual({ kind: 'pair', actionable: ['ebook', 'audiobook'] })
  })

  /** The new format should become another format of the book already on the shelf, not a second book. */
  it('sends only the missing half, aimed at the copy on the shelf, when the other is owned', () => {
    expect(pairSubmission(pair(OWNED, null))).toEqual({ kind: 'single', mediaKind: 'audiobook', joinBookId: 42, state: 'new' })
    expect(pairSubmission(pair(JOINABLE, OWNED))).toEqual({ kind: 'single', mediaKind: 'ebook', joinBookId: 42, state: 'joinable' })
  })

  /** The pair route joins the request already followed and links it to the new half. */
  it('still sends a pair when the other half is a request this person already follows', () => {
    expect(pairSubmission(pair(FOLLOWING, null))).toEqual({ kind: 'pair', actionable: ['audiobook'] })
  })

  it('sends nothing once there is nothing left to ask for, and says why', () => {
    expect(pairSubmission(pair(OWNED, OWNED))).toEqual({ kind: 'none', reason: 'owned' })
    expect(pairSubmission(pair(OWNED, FOLLOWING))).toEqual({ kind: 'none', reason: 'requested' })
  })
})

describe('pairSubmissionLabelKey', () => {
  it('names both, or the one medium a press will actually touch', () => {
    const both = pair(null, null)
    expect(pairSubmissionLabelKey(pairSubmission(both), both, 'request')).toBe('bookRequests.search.pair.requestBoth')
    expect(pairSubmissionLabelKey(pairSubmission(both), both, 'get')).toBe('bookRequests.search.pair.getBoth')
    expect(pairSubmissionLabelKey(pairSubmission(both), both, 'choose')).toBe('bookRequests.search.pair.chooseReleases')

    const audioOnly = pair(OWNED, null)
    expect(pairSubmissionLabelKey(pairSubmission(audioOnly), audioOnly, 'request')).toBe('bookRequests.search.pair.requestAudiobook')
    expect(pairSubmissionLabelKey(pairSubmission(audioOnly), audioOnly, 'get')).toBe('bookRequests.search.pair.getAudiobook')
  })

  it('says "add me" when every half it touches is somebody else\'s request', () => {
    const joinBoth = pair(JOINABLE, JOINABLE)
    expect(pairSubmissionLabelKey(pairSubmission(joinBoth), joinBoth, 'request')).toBe('bookRequests.search.pair.joinBoth')

    const joinEbook = pair(JOINABLE, OWNED)
    expect(pairSubmissionLabelKey(pairSubmission(joinEbook), joinEbook, 'get')).toBe('bookRequests.search.pair.joinEbook')
  })

  it('labels a pair with nothing left to ask for by what is already true', () => {
    const owned = pair(OWNED, OWNED)
    expect(pairSubmissionLabelKey(pairSubmission(owned), owned, 'request')).toBe('bookRequests.search.pair.haveBoth')
    const requested = pair(FOLLOWING, FOLLOWING)
    expect(pairSubmissionLabelKey(pairSubmission(requested), requested, 'request')).toBe('bookRequests.search.pair.requestedBoth')
  })
})

describe('pair rows', () => {
  const ebook = request({ id: 10, mediaKind: 'ebook' })
  const audiobook = request({ id: 11, mediaKind: 'audiobook' })

  it('unfolds pairs into their requests for selection and bulk actions', () => {
    const rows = [{ ...ebook, companion: audiobook }, request({ id: 12 })]
    expect(flattenRequestRows(rows).map((item) => item.id)).toEqual([10, 11, 12])
  })

  it('reads the ebook first whichever half leads the row', () => {
    expect(orderedHalves({ ...audiobook, companion: ebook }).map((item) => item.mediaKind)).toEqual(['ebook', 'audiobook'])
  })

  it('offers each action only for the halves it applies to', () => {
    const row = { ...ebook, companion: { ...audiobook, status: 'available' as const } }
    const actions = pairRowActions(row, { userId: 4, canManage: true, canSelfFulfil: false })

    expect(actions.approve.map((item) => item.id)).toEqual([10])
    expect(actions.dismiss.map((item) => item.id)).toEqual([11])
    expect(actions.cancel.map((item) => item.id)).toEqual([10])
    expect(actions.grab).toBeNull()
  })

  it('lists every half waiting on a release the viewer can pick, so the row can say "releases"', () => {
    const row = { ...ebook, status: 'approved' as const, companion: { ...audiobook, status: 'approved' as const } }
    const both = pairRowActions(row, { userId: 4, canManage: true, canSelfFulfil: false })
    expect(both.grabHalves.map((item) => item.id)).toEqual([10, 11])
    expect(both.grab?.id).toBe(10)

    const oneLeft = pairRowActions(
      { ...row, companion: { ...audiobook, status: 'downloading' as const } },
      { userId: 4, canManage: true, canSelfFulfil: false },
    )
    expect(oneLeft.grabHalves.map((item) => item.id)).toEqual([10])
  })

  it('only counts the halves a self-fulfiller drives', () => {
    const row = { ...ebook, status: 'approved' as const, companion: { ...audiobook, status: 'approved' as const, userId: 9 } }
    const actions = pairRowActions(row, { userId: 4, canManage: false, canSelfFulfil: true })
    expect(actions.grabHalves.map((item) => item.id)).toEqual([10])
  })

  it('offers no approval to somebody who does not moderate the queue', () => {
    const actions = pairRowActions({ ...ebook, companion: audiobook }, { userId: 4, canManage: false, canSelfFulfil: false })
    expect(actions.approve).toEqual([])
    expect(actions.cancel.map((item) => item.id)).toEqual([10, 11])
  })

  it('names both halves, or the one, in every action label', () => {
    expect(pairActionKey('approve', [ebook, audiobook])).toBe('bookRequests.actions.pair.approveBoth')
    expect(pairActionKey('cancel', [audiobook])).toBe('bookRequests.actions.pair.cancelAudiobook')
    expect(pairActionKey('dismiss', [ebook])).toBe('bookRequests.actions.pair.dismissEbook')
  })
})
