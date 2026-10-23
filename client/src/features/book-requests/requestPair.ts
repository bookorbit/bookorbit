import {
  BOOK_REQUEST_MEDIA_KINDS,
  isBookRequestFulfiller,
  isGrabbableBookRequestStatus,
  type BookRequestAvailability,
  type BookRequestItem,
  type BookRequestMediaKind,
} from '@bookorbit/types'
import { canCancelRequest, canDismissRequest } from './requestActions'

/**
 * What one medium of a work looks like from the search list: on the shelf, already asked for by
 * this person, asked for by somebody else, or not asked for at all.
 */
export type PairHalfState = 'owned' | 'following' | 'joinable' | 'new'

export type PairAvailability = Record<BookRequestMediaKind, BookRequestAvailability | null>

export function pairHalfState(availability: BookRequestAvailability | null): PairHalfState {
  if (availability?.ownedBookId) return 'owned'
  if (availability?.existingRequestId) return availability.alreadySubscribed ? 'following' : 'joinable'
  return 'new'
}

function isActionable(state: PairHalfState): boolean {
  return state === 'new' || state === 'joinable'
}

/**
 * How a "both" press is actually sent.
 *
 * Both halves still to ask for, or one still to ask for beside a request this person already
 * follows, go through the pair route: it joins what exists and links the two. One still to ask for
 * beside a copy already on the shelf goes alone, aimed at that copy, so the new format joins the
 * book the requester already has rather than becoming a second one. Nothing left to ask for sends
 * nothing.
 */
export type PairSubmission =
  | { kind: 'pair'; actionable: BookRequestMediaKind[] }
  | { kind: 'single'; mediaKind: BookRequestMediaKind; joinBookId: number | null; state: PairHalfState }
  | { kind: 'none'; reason: 'owned' | 'requested' }

export function pairSubmission(availability: PairAvailability): PairSubmission {
  const states = { ebook: pairHalfState(availability.ebook), audiobook: pairHalfState(availability.audiobook) }
  const actionable = BOOK_REQUEST_MEDIA_KINDS.filter((kind) => isActionable(states[kind]))

  if (actionable.length === 0) {
    return { kind: 'none', reason: BOOK_REQUEST_MEDIA_KINDS.every((kind) => states[kind] === 'owned') ? 'owned' : 'requested' }
  }
  if (actionable.length === 2) return { kind: 'pair', actionable }

  const mediaKind = actionable[0]!
  const other = mediaKind === 'ebook' ? 'audiobook' : 'ebook'
  if (states[other] === 'owned') {
    return { kind: 'single', mediaKind, joinBookId: availability[other]?.ownedBookId ?? null, state: states[mediaKind] }
  }
  return { kind: 'pair', actionable }
}

/**
 * The key for the button a pair row wears, so it always says which media the press will touch.
 * Kept here rather than in the component because the rules are the submission's, not the layout's.
 */
export function pairSubmissionLabelKey(submission: PairSubmission, availability: PairAvailability, mode: 'request' | 'get' | 'choose'): string {
  if (submission.kind === 'none') {
    return submission.reason === 'owned' ? 'bookRequests.search.pair.haveBoth' : 'bookRequests.search.pair.requestedBoth'
  }

  const actionable = submission.kind === 'pair' ? submission.actionable : [submission.mediaKind]
  const joinsOnly = actionable.every((kind) => pairHalfState(availability[kind]) === 'joinable')

  if (actionable.length === 2) {
    if (joinsOnly) return 'bookRequests.search.pair.joinBoth'
    return mode === 'get'
      ? 'bookRequests.search.pair.getBoth'
      : mode === 'choose'
        ? 'bookRequests.search.pair.chooseReleases'
        : 'bookRequests.search.pair.requestBoth'
  }

  const medium = actionable[0] === 'ebook' ? 'Ebook' : 'Audiobook'
  if (joinsOnly) return `bookRequests.search.pair.join${medium}`
  return mode === 'get'
    ? `bookRequests.search.pair.get${medium}`
    : mode === 'choose'
      ? 'bookRequests.search.chooseRelease'
      : `bookRequests.search.pair.request${medium}`
}

/** Every request a list row stands for: one, or the two halves of a pair. */
export function rowRequests(row: BookRequestItem): BookRequestItem[] {
  return row.companion ? [row, row.companion] : [row]
}

/** Every request on a page of rows, pairs unfolded, for selection and bulk actions. */
export function flattenRequestRows(rows: readonly BookRequestItem[]): BookRequestItem[] {
  return rows.flatMap(rowRequests)
}

/** The halves of a row in a stable reading order: the ebook first, whichever half leads it. */
export function orderedHalves(row: BookRequestItem): BookRequestItem[] {
  return rowRequests(row).sort((a, b) => (a.mediaKind === b.mediaKind ? 0 : a.mediaKind === 'ebook' ? -1 : 1))
}

/**
 * What a pair row can do to its halves in one press. Each entry is the subset that action applies
 * to, so the label can say "both" or name the one medium, and nothing is offered for a half the
 * endpoint would refuse.
 */
export interface PairRowActions {
  approve: BookRequestItem[]
  reject: BookRequestItem[]
  cancel: BookRequestItem[]
  dismiss: BookRequestItem[]
  restore: BookRequestItem[]
  /** The half a release would be found for next, if any half is waiting on one. */
  grab: BookRequestItem | null
  /** Every half waiting on a release this viewer can pick, so the button can say "releases". */
  grabHalves: BookRequestItem[]
}

export function pairRowActions(row: BookRequestItem, viewer: { userId: number | null; canManage: boolean; canSelfFulfil: boolean }): PairRowActions {
  const halves = orderedHalves(row)
  const pending = halves.filter((half) => viewer.canManage && half.status === 'pending')
  const grabHalves = halves.filter(
    (half) =>
      isGrabbableBookRequestStatus(half.status) && (viewer.canManage || (viewer.canSelfFulfil && isBookRequestFulfiller(half, viewer.userId))),
  )
  return {
    approve: pending,
    reject: pending,
    cancel: halves.filter((half) => canCancelRequest(half, viewer.userId, viewer.canManage, viewer.canSelfFulfil)),
    dismiss: halves.filter((half) => canDismissRequest(half) && !half.dismissed),
    restore: halves.filter((half) => canDismissRequest(half) && half.dismissed),
    grab: grabHalves[0] ?? null,
    grabHalves,
  }
}

/** The locale key naming one medium of a pair inside an action, as in "Approve ebook". */
export function pairActionKey(action: 'approve' | 'reject' | 'cancel' | 'dismiss' | 'restore', halves: readonly BookRequestItem[]): string {
  if (halves.length > 1) return `bookRequests.actions.pair.${action}Both`
  return `bookRequests.actions.pair.${action}${halves[0]?.mediaKind === 'audiobook' ? 'Audiobook' : 'Ebook'}`
}
