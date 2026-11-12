import type { BookRequestItem, BookRequestSelectionEntry } from '@bookorbit/types'
import {
  canCancelRequest,
  canDecideRequest,
  canDeleteRequest,
  canFulfilRequest,
  canHideRequest,
  canLeaveSubscription,
  canPickRelease,
  canUnhideRequest,
  isSubscriber,
} from './requestActions'
import { orderedHalves } from './requestPair'

/**
 * One request as a selection sees it: enough to decide which actions reach it, and nothing a
 * refetch could leave stale in a way that matters. A row on the page and an entry gathered by
 * "select all matching" have the same shape, so both are judged by the same rules.
 */
export type SelectionHalf = Pick<
  BookRequestSelectionEntry,
  'id' | 'rowId' | 'title' | 'mediaKind' | 'status' | 'userId' | 'fulfillerUserId' | 'dismissed' | 'subscribed'
>

/** Everything that can be done to a request, in the order every menu and the bulk bar list it. */
export const REQUEST_ACTIONS = ['approve', 'reject', 'pick', 'hide', 'unhide', 'leave', 'cancel', 'delete'] as const
export type RequestAction = (typeof REQUEST_ACTIONS)[number]

/** Decide, keep, remove: the three groups a menu separates its actions into. */
export const REQUEST_ACTION_GROUPS: Record<RequestAction, 'decide' | 'keep' | 'remove'> = {
  approve: 'decide',
  reject: 'decide',
  pick: 'decide',
  hide: 'keep',
  unhide: 'keep',
  leave: 'keep',
  cancel: 'remove',
  delete: 'remove',
}

export interface RequestViewer {
  userId: number | null
  canManage: boolean
  canSelfFulfil: boolean
}

export function selectionHalf(request: BookRequestItem, rowId: number, userId: number | null): SelectionHalf {
  return {
    id: request.id,
    rowId,
    title: request.title,
    mediaKind: request.mediaKind,
    status: request.status,
    userId: request.userId,
    fulfillerUserId: request.fulfillerUserId,
    dismissed: request.dismissed,
    subscribed: request.userId !== userId && isSubscriber(request, userId),
  }
}

/** A list row as the requests it stands for, ebook first. */
export function rowSelectionHalves(row: BookRequestItem, userId: number | null): SelectionHalf[] {
  return orderedHalves(row).map((half) => selectionHalf(half, row.id, userId))
}

/** Whether one action can be applied to one request by this viewer. */
export function actionReaches(action: RequestAction, half: SelectionHalf, viewer: RequestViewer): boolean {
  switch (action) {
    case 'approve':
    case 'reject':
      return canDecideRequest(half, viewer.canManage)
    case 'pick':
      return !half.dismissed && canPickRelease(half, viewer.userId, viewer.canManage, viewer.canSelfFulfil)
    case 'hide':
      return canHideRequest(half)
    case 'unhide':
      return canUnhideRequest(half)
    case 'leave':
      return canLeaveSubscription(half, viewer.userId)
    case 'cancel':
      return !half.dismissed && canCancelRequest(half, viewer.userId, viewer.canManage, viewer.canSelfFulfil)
    case 'delete':
      return canDeleteRequest(half, viewer.canManage)
  }
}

export interface ActionTargets {
  /** Rows with at least one request the action reaches: the number a button shows. */
  rows: number
  /** Every request the action reaches, across those rows: what is sent to the server. */
  halves: SelectionHalf[]
}

/** What one action would touch across a selection of rows. */
export function actionTargets(action: RequestAction, rows: Iterable<SelectionHalf[]>, viewer: RequestViewer): ActionTargets {
  let count = 0
  const halves: SelectionHalf[] = []
  for (const row of rows) {
    const reached = row.filter((half) => actionReaches(action, half, viewer))
    if (reached.length === 0) continue
    count++
    halves.push(...reached)
  }
  return { rows: count, halves }
}

/**
 * Which bulk actions the bar offers. Fixed per viewer and per view, never per selection, so the bar
 * keeps one shape while rows are ticked: an action that reaches nothing is shown disabled with its
 * reason. Hidden rows can only be unhidden, left or deleted, so that view swaps the set.
 */
export function bulkActionsFor(view: string, viewer: RequestViewer, offerLeave: boolean): RequestAction[] {
  const canPick = viewer.canManage || viewer.canSelfFulfil
  const actions: RequestAction[] =
    view === 'hidden' ? ['unhide', 'leave', 'delete'] : ['approve', 'reject', 'pick', 'hide', 'leave', 'cancel', 'delete']
  return actions.filter((action) => {
    if (action === 'approve' || action === 'reject' || action === 'delete') return viewer.canManage
    if (action === 'pick') return canPick
    if (action === 'leave') return offerLeave
    return true
  })
}

export interface BulkActionState {
  action: RequestAction
  /** Selected rows the action reaches: the number on the button. */
  rows: number
}

/** Whether a press needs a second look: anything that stops, removes or takes the viewer off a request. */
export function isDestructiveAction(action: RequestAction): boolean {
  return action === 'cancel' || action === 'delete'
}

/** Which half, or both, a row action names, so a pair row never offers a bare "Cancel". */
export type ActionVariant = 'one' | 'both' | 'ebook' | 'audiobook'

export function actionVariant(rowHalves: readonly SelectionHalf[], targeted: readonly SelectionHalf[]): ActionVariant {
  if (rowHalves.length < 2) return 'one'
  if (targeted.length > 1) return 'both'
  return targeted[0]?.mediaKind === 'audiobook' ? 'audiobook' : 'ebook'
}

export interface RowActionEntry {
  action: RequestAction
  halves: SelectionHalf[]
  variant: ActionVariant
}

/** One menu press: the action and exactly the halves of the row it reaches. */
export interface RowActPayload {
  action: RequestAction
  halves: SelectionHalf[]
}

export interface RowStep {
  kind: Exclude<RowNextStep, null>
  halves: SelectionHalf[]
}

/** The row's one button and its menu, worked out together so the menu never repeats the button. */
export interface RowActionModel {
  step: RowStep | null
  groups: RowActionEntry[][]
}

export function rowActionModel(halves: SelectionHalf[], viewer: RequestViewer): RowActionModel {
  const kind = rowNextStep(halves, viewer)
  const step: RowStep | null =
    kind === null
      ? null
      : {
          kind,
          halves: halves.filter((half) => (kind === 'review' ? canReviewImport(half, viewer) : actionReaches(kind, half, viewer))),
        }

  const groups: RowActionEntry[][] = (['decide', 'keep', 'remove'] as const).map((group) =>
    REQUEST_ACTIONS.filter((action) => REQUEST_ACTION_GROUPS[action] === group && action !== step?.kind).flatMap((action) => {
      const targeted = halves.filter((half) => actionReaches(action, half, viewer))
      return targeted.length ? [{ action, halves: targeted, variant: actionVariant(halves, targeted) }] : []
    }),
  )
  return { step, groups: groups.filter((group) => group.length > 0) }
}

/**
 * The one action a row offers as a button: the thing that is due next, if anything is. Review is
 * not an action of its own; it opens the request, where the review lives.
 */
export type RowNextStep = 'approve' | 'review' | 'pick' | null

export function rowNextStep(halves: SelectionHalf[], viewer: RequestViewer): RowNextStep {
  if (halves.some((half) => half.dismissed)) return null
  if (halves.some((half) => actionReaches('approve', half, viewer))) return 'approve'
  if (halves.some((half) => canReviewImport(half, viewer))) return 'review'
  if (halves.some((half) => actionReaches('pick', half, viewer))) return 'pick'
  return null
}

/** An import held for review is reviewed by whoever may fulfil the request. */
export function canReviewImport(half: SelectionHalf, viewer: RequestViewer): boolean {
  return half.status === 'needs_review' && canFulfilRequest(half, viewer.userId, viewer.canManage, viewer.canSelfFulfil)
}

/** Groups selection entries back into the rows they were listed as, keeping list order. */
export function groupEntriesByRow(entries: readonly BookRequestSelectionEntry[]): Map<number, SelectionHalf[]> {
  const rows = new Map<number, SelectionHalf[]>()
  for (const entry of entries) {
    const row = rows.get(entry.rowId)
    if (row) row.push(entry)
    else rows.set(entry.rowId, [entry])
  }
  for (const row of rows.values()) row.sort((a, b) => (a.mediaKind === b.mediaKind ? 0 : a.mediaKind === 'ebook' ? -1 : 1))
  return rows
}
