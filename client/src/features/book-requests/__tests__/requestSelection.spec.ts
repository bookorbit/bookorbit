// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookRequestItem, BookRequestSelectionEntry } from '@bookorbit/types'
import {
  actionReaches,
  actionTargets,
  bulkActionsFor,
  groupEntriesByRow,
  rowActionModel,
  rowSelectionHalves,
  type RequestViewer,
  type SelectionHalf,
} from '../requestSelection'

const ME = 4
const OTHER = 9

const MODERATOR: RequestViewer = { userId: ME, canManage: true, canSelfFulfil: false }
const SELF_SERVER: RequestViewer = { userId: ME, canManage: false, canSelfFulfil: true }
const READER: RequestViewer = { userId: ME, canManage: false, canSelfFulfil: false }

function half(overrides: Partial<SelectionHalf> = {}): SelectionHalf {
  return {
    id: 1,
    rowId: 1,
    title: 'Ghost Story',
    mediaKind: 'ebook',
    status: 'pending',
    userId: ME,
    fulfillerUserId: null,
    dismissed: false,
    subscribed: false,
    ...overrides,
  }
}

function item(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 1,
    title: 'Ghost Story',
    userId: ME,
    mediaKind: 'ebook',
    status: 'pending',
    dismissed: false,
    download: null,
    fulfillerUserId: null,
    subscribers: [],
    companion: null,
    ...overrides,
  } as BookRequestItem
}

describe('actionReaches', () => {
  it.each([
    'pending',
    'approved',
    'searching',
    'grabbed',
    'downloading',
    'importing',
    'needs_review',
    'failed',
    'available',
    'rejected',
    'cancelled',
  ] as const)('reaches a %s request with some action, so ticking it always has a purpose', (status) => {
    const reached = (['approve', 'reject', 'pick', 'hide', 'unhide', 'leave', 'cancel', 'delete'] as const).filter((action) =>
      actionReaches(action, half({ status }), MODERATOR),
    )
    expect(reached.length).toBeGreaterThan(0)
  })

  it('keeps hidden requests to unhide, leave and delete', () => {
    const hidden = half({ status: 'failed', dismissed: true })
    expect(actionReaches('unhide', hidden, MODERATOR)).toBe(true)
    expect(actionReaches('delete', hidden, MODERATOR)).toBe(true)
    expect(actionReaches('pick', hidden, MODERATOR)).toBe(false)
    expect(actionReaches('cancel', hidden, MODERATOR)).toBe(false)
  })

  it('lets a self-fulfiller pick a release on their own request but not decide one', () => {
    expect(actionReaches('pick', half({ status: 'approved' }), SELF_SERVER)).toBe(true)
    expect(actionReaches('approve', half({ status: 'pending' }), SELF_SERVER)).toBe(false)
  })
})

describe('actionTargets', () => {
  it('counts rows, and sends every half of a row the action reaches', () => {
    const pair = [half({ id: 10, rowId: 10 }), half({ id: 11, rowId: 10, mediaKind: 'audiobook' })]
    const single = [half({ id: 12, rowId: 12, status: 'approved' })]
    const targets = actionTargets('approve', [pair, single], MODERATOR)
    expect(targets.rows).toBe(1)
    expect(targets.halves.map((target) => target.id)).toEqual([10, 11])
  })
})

describe('bulkActionsFor', () => {
  it('keeps one set per viewer and view, whatever is ticked', () => {
    expect(bulkActionsFor('all', MODERATOR, false)).toEqual(['approve', 'reject', 'pick', 'hide', 'cancel', 'delete'])
    expect(bulkActionsFor('all', READER, false)).toEqual(['hide', 'cancel'])
    expect(bulkActionsFor('all', SELF_SERVER, true)).toEqual(['pick', 'hide', 'leave', 'cancel'])
  })

  it('swaps to unhide in the hidden view', () => {
    expect(bulkActionsFor('hidden', MODERATOR, false)).toEqual(['unhide', 'delete'])
    expect(bulkActionsFor('hidden', READER, true)).toEqual(['unhide', 'leave'])
  })
})

describe('rowActionModel', () => {
  it('puts approve in the slot and never repeats it in the menu', () => {
    const model = rowActionModel([half({ status: 'pending' })], MODERATOR)
    expect(model.step?.kind).toBe('approve')
    expect(model.groups.flat().map((entry) => entry.action)).toEqual(['reject', 'cancel'])
  })

  it('offers pick release in the slot of an approved row, not in its menu as well', () => {
    const model = rowActionModel([half({ status: 'approved' })], MODERATOR)
    expect(model.step?.kind).toBe('pick')
    expect(model.groups.flat().map((entry) => entry.action)).toEqual(['cancel'])
  })

  it('sends a held import to the drawer to be reviewed', () => {
    const model = rowActionModel([half({ status: 'needs_review' })], MODERATOR)
    expect(model.step?.kind).toBe('review')
  })

  it('offers a pair delete and names the half each item touches', () => {
    const halves = [half({ id: 10, rowId: 10, status: 'available' }), half({ id: 11, rowId: 10, mediaKind: 'audiobook', status: 'downloading' })]
    const entries = rowActionModel(halves, MODERATOR).groups.flat()
    expect(entries.find((entry) => entry.action === 'delete')).toMatchObject({ variant: 'ebook' })
    expect(entries.find((entry) => entry.action === 'hide')).toMatchObject({ variant: 'ebook' })
    expect(entries.find((entry) => entry.action === 'cancel')).toMatchObject({ variant: 'audiobook' })
  })

  it('says both when an action reaches both halves', () => {
    const halves = [half({ id: 10, rowId: 10 }), half({ id: 11, rowId: 10, mediaKind: 'audiobook' })]
    const model = rowActionModel(halves, MODERATOR)
    expect(model.step?.halves).toHaveLength(2)
    expect(model.groups.flat().find((entry) => entry.action === 'reject')).toMatchObject({ variant: 'both' })
  })

  it('offers leave to somebody who joined, in the keep group', () => {
    const model = rowActionModel([half({ userId: OTHER, status: 'downloading', subscribed: true })], READER)
    expect(model.step).toBeNull()
    expect(model.groups.flat().map((entry) => entry.action)).toEqual(['leave'])
  })

  it('offers nothing in the slot of a hidden row', () => {
    expect(rowActionModel([half({ status: 'failed', dismissed: true })], MODERATOR).step).toBeNull()
  })
})

describe('rowSelectionHalves', () => {
  it('reads both halves of a pair, ebook first, under the row id', () => {
    const row = item({ id: 20, mediaKind: 'audiobook', companion: item({ id: 21, mediaKind: 'ebook' }) })
    expect(rowSelectionHalves(row, ME).map((entry) => [entry.id, entry.rowId])).toEqual([
      [21, 20],
      [20, 20],
    ])
  })

  it('marks a request the viewer joined, but not one they made', () => {
    const joined = item({ userId: OTHER, subscribers: [{ userId: ME }] as BookRequestItem['subscribers'] })
    expect(rowSelectionHalves(joined, ME)[0]?.subscribed).toBe(true)
    const own = item({ subscribers: [{ userId: ME }] as BookRequestItem['subscribers'] })
    expect(rowSelectionHalves(own, ME)[0]?.subscribed).toBe(false)
  })
})

describe('groupEntriesByRow', () => {
  it('folds a "select all matching" answer back into rows', () => {
    const entries = [
      half({ id: 31, rowId: 30, mediaKind: 'audiobook' }),
      half({ id: 30, rowId: 30 }),
      half({ id: 40, rowId: 40 }),
    ] as BookRequestSelectionEntry[]
    const rows = groupEntriesByRow(entries)
    expect([...rows.keys()]).toEqual([30, 40])
    expect(rows.get(30)?.map((entry) => entry.id)).toEqual([30, 31])
  })
})
