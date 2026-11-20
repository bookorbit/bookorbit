import { isBookRequestFulfiller, isCancellableBookRequestStatus, isGrabbableBookRequestStatus, isSettledBookRequestStatus } from '@bookorbit/types'
import type { BookRequestItem } from '@bookorbit/types'

/**
 * Who may do what to a request, in one place. The row menu, the bulk bar and the drawer all ask
 * these, and separate copies of the rules is how a row offers a button the endpoint refuses, or
 * the drawer offers one the row does not.
 *
 * Each rule takes only the fields it reads, so a selection entry gathered by "select all
 * matching" is judged exactly like a row on the page.
 */
type Ownership = Pick<BookRequestItem, 'userId' | 'fulfillerUserId' | 'status'>

/**
 * The requester, a moderator, or the self-fulfiller who took the request on. The last of those is
 * the only person who can stop a transfer they started on somebody else's row, so hiding the
 * action from them would leave work that only runs forwards. `canSelfFulfil` is asked for the same
 * reason the server asks: the permission can be taken away after the request was taken on.
 */
export function canCancelRequest(request: Ownership, userId: number | null, canManage: boolean, canSelfFulfil = false): boolean {
  const isOwner = userId !== null && request.userId === userId
  const drives = canSelfFulfil && isBookRequestFulfiller(request, userId)
  return (isOwner || canManage || drives) && isCancellableBookRequestStatus(request.status)
}

/** Approving and rejecting are the same decision, and only a moderator makes it on a pending row. */
export function canDecideRequest(request: Pick<BookRequestItem, 'status'>, canManage: boolean): boolean {
  return canManage && request.status === 'pending'
}

/**
 * Picking a release by hand: a moderator on any request still waiting for one, or the person
 * driving a self-served request. Mirrors the server's own rule, so the row, the bulk bar and the
 * drawer all offer it to the same people.
 */
export function canPickRelease(request: Ownership, userId: number | null, canManage: boolean, canSelfFulfil: boolean): boolean {
  return isGrabbableBookRequestStatus(request.status) && canFulfilRequest(request, userId, canManage, canSelfFulfil)
}

/** A moderator, or the self-fulfiller driving this request. Mirrors `assertCanFulfil` on the server. */
export function canFulfilRequest(
  request: Pick<BookRequestItem, 'userId' | 'fulfillerUserId'>,
  userId: number | null,
  canManage: boolean,
  canSelfFulfil: boolean,
): boolean {
  return canManage || (canSelfFulfil && isBookRequestFulfiller(request, userId))
}

/** Hiding is personal, so anyone who can see a settled request may take it off their own list. */
export function canDismissRequest(request: Pick<BookRequestItem, 'status'>): boolean {
  return isSettledBookRequestStatus(request.status)
}

/** A request can be hidden once it has settled, and brought back once it is hidden. */
export function canHideRequest(request: Pick<BookRequestItem, 'status' | 'dismissed'>): boolean {
  return canDismissRequest(request) && !request.dismissed
}

export function canUnhideRequest(request: Pick<BookRequestItem, 'dismissed'>): boolean {
  return request.dismissed
}

/**
 * Whether the signed-in user joined this request rather than making it, and so has something to
 * leave. The fulfiller is excluded: their subscription is what makes their own work visible to
 * them, and the server refuses for that reason too.
 */
export function canLeaveSubscription(
  request: Pick<BookRequestItem, 'userId' | 'fulfillerUserId'> & { subscribed: boolean },
  userId: number | null,
): boolean {
  if (userId === null || request.userId === userId) return false
  if (isBookRequestFulfiller(request, userId)) return false
  return request.subscribed
}

export function canLeaveRequest(request: BookRequestItem, userId: number | null): boolean {
  return canLeaveSubscription({ ...request, subscribed: isSubscriber(request, userId) }, userId)
}

/** Following a request somebody else made. */
export function isSubscriber(request: Pick<BookRequestItem, 'subscribers'>, userId: number | null): boolean {
  return userId !== null && request.subscribers.some((subscriber) => subscriber.userId === userId)
}

/** Deleting takes the row from everyone, so it is a moderator action on a settled request only. */
export function canDeleteRequest(request: Pick<BookRequestItem, 'status'>, canManage: boolean): boolean {
  return canManage && isSettledBookRequestStatus(request.status)
}

/**
 * Whether cancelling would also stop an active transfer, which is worth warning about. Read off
 * the attempt rather than the request: a request can sit at `searching` with nothing grabbed yet.
 * Mirrors the in-flight statuses the server removes on.
 */
export function cancelStopsATransfer(request: BookRequestItem): boolean {
  if (request.download?.alwaysDeletesRemote) return true
  const status = request.download?.status
  return status === 'queued' || status === 'downloading' || status === 'completed' || status === 'importing'
}
