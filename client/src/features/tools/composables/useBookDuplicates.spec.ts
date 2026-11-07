import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import {
  BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS,
  Permission,
  defaultDuplicateAction,
  type BookDuplicateCandidate,
  type BookDuplicateGroup,
  type BookDuplicateKind,
  type BookDuplicateMatchReason,
  type BookDuplicateResolutionEvent,
  type BookDuplicateResolutionJob,
  type BookDuplicateScan,
} from '@bookorbit/types'
import { toast } from 'vue-sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBookDuplicateScan,
  getActiveBookDuplicateScan,
  getBookDuplicateGroups,
  getBookDuplicateResolution,
  getBookDuplicateScan,
  restoreBookDuplicateDismissal,
  startBookDuplicateResolution,
} from '../api/book-duplicates'
import { useBookDuplicates } from './useBookDuplicates'

type SocketHandler = (event: BookDuplicateResolutionEvent) => void

const granted = vi.hoisted(() => new Set<string>())
const viewerOnlyLibraries = vi.hoisted(() => new Set<number>())
const socketHandlers = vi.hoisted(() => new Map<string, (event: never) => void>())

vi.mock('../api/book-duplicates', () => ({
  createBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  dismissBookDuplicateGroup: vi.fn<(...args: unknown[]) => unknown>(),
  getActiveBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateDismissals: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateGroups: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateResolution: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  restoreBookDuplicateDismissal: vi.fn<(...args: unknown[]) => unknown>(),
  startBookDuplicateResolution: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => granted.has(name) }),
}))

vi.mock('@/features/library/composables/useLibraryPermissions', () => ({
  useLibraryPermissions: () => ({
    hasLibraryPermission: (name: string, libraryId: number | null | undefined, required = 'viewer') =>
      granted.has(name) && libraryId != null && !(required === 'editor' && viewerOnlyLibraries.has(libraryId)),
  }),
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  getSocket: () => ({
    on: (event: string, handler: (event: never) => void) => socketHandlers.set(event, handler),
    off: (event: string) => socketHandlers.delete(event),
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}))

const runningScan: BookDuplicateScan = {
  id: 11,
  status: 'running',
  libraryIds: [2],
  requestedLibraryId: 2,
  similarityPercent: 85,
  processedBooks: 5,
  totalBooks: 10,
  progressPercent: 50,
  totalGroups: null,
  totalExtraCopies: null,
  totalReclaimableBytes: null,
  errorCode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  totalOtherFormatPairs: null,
}

const completedScan: BookDuplicateScan = {
  ...runningScan,
  status: 'completed',
  processedBooks: 10,
  progressPercent: 100,
  totalGroups: 0,
  totalExtraCopies: 0,
  totalReclaimableBytes: 0,
  completedAt: '2026-01-01T00:01:00.000Z',
}

function book(id: number, overrides: Partial<BookDuplicateCandidate> = {}): BookDuplicateCandidate {
  return {
    id,
    title: 'Frankenstein',
    subtitle: null,
    authors: ['Mary Shelley'],
    libraryId: 2,
    libraryName: 'Novels',
    folderPath: `Mary Shelley/Frankenstein (${id})`,
    status: 'present',
    files: [{ id, format: 'epub', sizeBytes: 1000 * id, path: `Mary Shelley/Frankenstein (${id})/Frankenstein.epub` }],
    isbn10: null,
    isbn13: null,
    metadataScore: 100 - id,
    readStatus: null,
    readingProgress: null,
    collections: [],
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    hasCover: false,
    bookPerFile: false,
    ...overrides,
  }
}

function duplicateGroup(
  id: number,
  books: BookDuplicateCandidate[],
  reasons: BookDuplicateMatchReason[] = ['file_hash'],
  kind: BookDuplicateKind = 'duplicate',
): BookDuplicateGroup {
  const [anchor, ...others] = books
  const pairs = others.map((other) => ({ bookIdA: anchor!.id, bookIdB: other.id, reasons, titleSimilarity: 1 }))
  return { id, kind, reasons, maxTitleSimilarity: 1, reclaimableBytes: 0, books, pairs }
}

function grant(...permissions: string[]): void {
  granted.clear()
  for (const permission of permissions) granted.add(permission)
}

function emitSocket(event: string, payload: BookDuplicateResolutionEvent): void {
  const handler = socketHandlers.get(event) as SocketHandler | undefined
  handler?.(payload)
}

function finishedJob(overrides: Partial<BookDuplicateResolutionJob> = {}): BookDuplicateResolutionJob {
  return {
    id: 5,
    scanId: 11,
    status: 'completed',
    processed: 1,
    total: 1,
    currentGroupId: null,
    outcomes: [{ groupId: 1, keeperId: 1, status: 'done', reason: null, books: [{ bookId: 2, action: 'merge', status: 'merged', reason: null }] }],
    errorCode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    ...overrides,
  }
}

function mountComposable() {
  let duplicates!: ReturnType<typeof useBookDuplicates>
  const wrapper = mount(
    defineComponent({
      setup() {
        duplicates = useBookDuplicates()
        return () => h('div')
      },
    }),
  )
  return { duplicates, wrapper }
}

describe('useBookDuplicates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    grant(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
    viewerOnlyLibraries.clear()
    socketHandlers.clear()
    vi.mocked(createBookDuplicateScan).mockReset()
    vi.mocked(startBookDuplicateResolution).mockReset()
    vi.mocked(getBookDuplicateResolution).mockReset()
    vi.mocked(restoreBookDuplicateDismissal).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.warning).mockReset()
    vi.mocked(getActiveBookDuplicateScan).mockReset()
    vi.mocked(getBookDuplicateGroups).mockReset()
    vi.mocked(getBookDuplicateScan).mockReset()
    vi.mocked(getBookDuplicateGroups).mockResolvedValue({ groups: [], total: 0, page: 1, pageSize: 20 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps polling after a transient status error and loads completed results', async () => {
    vi.mocked(createBookDuplicateScan).mockResolvedValue(runningScan)
    vi.mocked(getBookDuplicateScan).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(completedScan)
    const { duplicates } = mountComposable()

    await duplicates.startScan(2, 85)
    await vi.advanceTimersByTimeAsync(1000)

    expect(duplicates.error.value).toBe('Could not load scan progress.')

    await vi.advanceTimersByTimeAsync(1000)

    expect(getBookDuplicateScan).toHaveBeenCalledTimes(2)
    expect(getBookDuplicateGroups).toHaveBeenCalledWith(11, {
      page: 1,
      pageSize: 20,
      reason: undefined,
      sortBy: 'reclaimable',
      order: 'desc',
      kind: 'duplicate',
    })
    expect(duplicates.scan.value?.status).toBe('completed')
    expect(duplicates.error.value).toBeNull()
  })

  it('resumes an active scan after the view is reloaded', async () => {
    vi.mocked(getActiveBookDuplicateScan).mockResolvedValue(runningScan)
    const { duplicates } = mountComposable()

    await duplicates.resumeActiveScan()

    expect(duplicates.scan.value).toEqual(runningScan)
    expect(duplicates.scanning.value).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('moves back to the last populated page when results shrink', async () => {
    vi.mocked(getBookDuplicateGroups)
      .mockResolvedValueOnce({ groups: [], total: 1, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ groups: [] as BookDuplicateGroup[], total: 1, page: 1, pageSize: 20 })
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    duplicates.page.value = 2

    await duplicates.fetchGroups()

    expect(duplicates.page.value).toBe(1)
    expect(getBookDuplicateGroups).toHaveBeenNthCalledWith(2, 11, {
      page: 1,
      pageSize: 20,
      reason: undefined,
      sortBy: 'reclaimable',
      order: 'desc',
      kind: 'duplicate',
    })
  })

  it('does not schedule another poll after the owner component unmounts', async () => {
    vi.mocked(createBookDuplicateScan).mockResolvedValue(runningScan)
    vi.mocked(getBookDuplicateScan).mockResolvedValue(runningScan)
    const { duplicates, wrapper } = mountComposable()

    await duplicates.startScan(2, 85)
    wrapper.unmount()
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(getBookDuplicateScan).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports scan start and active-scan recovery failures', async () => {
    vi.mocked(createBookDuplicateScan).mockRejectedValue(new Error('start failed'))
    vi.mocked(getActiveBookDuplicateScan).mockRejectedValue(new Error('status failed'))
    const { duplicates } = mountComposable()

    await duplicates.startScan(undefined, 90)
    expect(duplicates.error.value).toBe('Could not start the duplicate scan.')

    await duplicates.resumeActiveScan()
    expect(duplicates.error.value).toBe('Could not load scan progress.')
  })

  it('applies filters, bounded page changes, and session-only dismissals', async () => {
    vi.mocked(getBookDuplicateGroups).mockImplementation(async (_scanId, params) => ({ groups: [], total: 60, page: params.page, pageSize: 20 }))
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    duplicates.total.value = 60

    await duplicates.setReason('isbn')
    await duplicates.setPage(99)
    duplicates.hideGroup(42)

    expect(duplicates.reason.value).toBe('isbn')
    expect(duplicates.page.value).toBe(3)
    expect(getBookDuplicateGroups).toHaveBeenLastCalledWith(11, {
      page: 3,
      pageSize: 20,
      reason: 'isbn',
      sortBy: 'reclaimable',
      order: 'desc',
      kind: 'duplicate',
    })
  })

  it('defaults a strong match to merge for a user who may merge, and offers every action (H11)', () => {
    const { duplicates } = mountComposable()
    const strong = duplicateGroup(1, [book(1), book(2)], ['file_hash'])
    const fuzzy = duplicateGroup(2, [book(3), book(4)], ['fuzzy_metadata'])

    expect(duplicates.actionsFor(strong)).toEqual(['delete', 'merge', 'link'])
    expect(duplicates.actionFor(strong)).toBe('merge')
    expect(duplicates.actionFor(fuzzy)).toBeNull()
  })

  it('limits the actions to the permissions the user holds (H11)', () => {
    grant(Permission.LibraryDeleteBooks)
    const deleteOnly = mountComposable().duplicates
    const group = duplicateGroup(1, [book(1), book(2)], ['file_hash'])

    expect(deleteOnly.actionsFor(group)).toEqual(['delete'])
    expect(deleteOnly.actionFor(group)).toBe('delete')
    expect(deleteOnly.actionsFor(duplicateGroup(2, [book(3), book(4)], ['same_work'], 'other_format'))).toEqual([])

    grant(Permission.LibraryMergeBooks)
    const mergeOnly = mountComposable().duplicates

    expect(mergeOnly.actionsFor(group)).toEqual(['merge', 'link'])
    expect(mergeOnly.actionFor(duplicateGroup(3, [book(5), book(6)], ['same_work'], 'other_format'))).toBeNull()

    grant()
    expect(mountComposable().duplicates.canUseTool.value).toBe(false)
  })

  it('never starts on delete unless every copy is proven identical by file hash', () => {
    grant(Permission.LibraryDeleteBooks)
    const { duplicates } = mountComposable()
    const weaker = [
      duplicateGroup(1, [book(1), book(2)], ['fuzzy_metadata']),
      duplicateGroup(2, [book(3), book(4)], ['exact_metadata']),
      duplicateGroup(3, [book(5), book(6)], ['isbn']),
    ]
    const identical = duplicateGroup(4, [book(7), book(8), book(9)], ['file_hash'])
    const chained: BookDuplicateGroup = {
      ...duplicateGroup(5, [book(10), book(11), book(12)], ['file_hash', 'fuzzy_metadata']),
      pairs: [
        { bookIdA: 10, bookIdB: 11, reasons: ['file_hash'], titleSimilarity: 1 },
        { bookIdA: 11, bookIdB: 12, reasons: ['fuzzy_metadata'], titleSimilarity: 0.9 },
      ],
    }
    const unproven: BookDuplicateGroup = { ...duplicateGroup(6, [book(13), book(14)], ['file_hash']), pairs: [] }

    expect(weaker.map((group) => duplicates.actionFor(group))).toEqual([null, null, null])
    expect(weaker.map((group) => duplicates.actionsFor(group))).toEqual([['delete'], ['delete'], ['delete']])
    expect(duplicates.actionFor(identical)).toBe('delete')
    expect(duplicates.actionFor(chained)).toBeNull()
    expect(duplicates.actionFor(unproven)).toBeNull()
  })

  it('gives the server pass no delete default, since it has no pairs to prove a group identical', () => {
    const deleteOnly = { canDelete: true, canMerge: false }
    const both = { canDelete: true, canMerge: true }

    for (const reasons of [['file_hash'], ['isbn'], ['exact_metadata'], ['fuzzy_metadata']] as BookDuplicateMatchReason[][]) {
      expect(defaultDuplicateAction({ kind: 'duplicate', reasons, books: [book(1), book(2)] }, 1, deleteOnly)).toBeNull()
    }
    expect(defaultDuplicateAction({ kind: 'duplicate', reasons: ['isbn'], books: [book(1), book(2)] }, 1, both)).toBe('merge')
    expect(defaultDuplicateAction({ kind: 'duplicate', reasons: ['fuzzy_metadata'], books: [book(1), book(2)] }, 1, both)).toBeNull()
  })

  it('offers merge and link only where the user edits every library of the group', () => {
    viewerOnlyLibraries.add(3)
    const { duplicates } = mountComposable()
    const viewed = duplicateGroup(1, [book(1, { libraryId: 3 }), book(2, { libraryId: 3 })], ['isbn'])
    const spanning = duplicateGroup(2, [book(3), book(4, { libraryId: 3 })], ['isbn'])
    const edited = duplicateGroup(3, [book(5), book(6)], ['isbn'])

    expect(duplicates.actionsFor(viewed)).toEqual(['delete'])
    expect(duplicates.actionFor(viewed)).toBeNull()
    expect(duplicates.actionsFor(spanning)).toEqual(['delete'])
    expect(duplicates.actionsFor(edited)).toEqual(['delete', 'merge', 'link'])
    expect(duplicates.actionFor(edited)).toBe('merge')

    duplicates.setAction(1, 'link')
    expect(duplicates.actionFor(viewed)).toBeNull()
  })

  it('offers merge for a group across libraries but never starts with it (X40)', () => {
    const { duplicates } = mountComposable()
    const group = duplicateGroup(1, [book(1), book(2, { libraryId: 3 })], ['file_hash'])

    expect(duplicates.mergeAvailabilityFor(group)).toEqual({ available: true, reason: null })
    expect(duplicates.actionsFor(group)).toEqual(['delete', 'merge', 'link'])
    expect(duplicates.actionFor(group)).toBeNull()

    duplicates.setAction(1, 'merge')
    expect(duplicates.actionFor(group)).toBe('merge')
  })

  it('withholds merge across libraries when every library keeps one book per file', () => {
    const { duplicates } = mountComposable()
    const group = duplicateGroup(1, [book(1, { bookPerFile: true }), book(2, { libraryId: 3, bookPerFile: true })], ['file_hash'])

    expect(duplicates.mergeAvailabilityFor(group).reason).toBe('FILE_PER_BOOK_LIBRARY')
    expect(duplicates.actionsFor(group)).not.toContain('merge')
  })

  it('withholds merge from a library that keeps one book per file (H4)', () => {
    const { duplicates } = mountComposable()
    const group = duplicateGroup(1, [book(1, { bookPerFile: true }), book(2, { bookPerFile: true })], ['file_hash'])

    expect(duplicates.mergeAvailabilityFor(group).reason).toBe('FILE_PER_BOOK_LIBRARY')
    expect(duplicates.actionsFor(group)).not.toContain('merge')
  })

  it('sends each group with its keeper, action and only the per-copy choices that differ (H5)', () => {
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    const group = duplicateGroup(1, [book(1), book(2), book(3), book(4)], ['file_hash'])

    duplicates.setBookAction(1, 3, 'skip')
    duplicates.setBookAction(1, 4, 'merge')

    expect(duplicates.buildResolution([group])).toEqual({
      scanId: 11,
      groups: [{ groupId: 1, keeperId: 1, action: 'merge', perBook: [{ bookId: 3, action: 'skip' }] }],
    })
  })

  it('extends a selection to every page with the tab, filter and keep rule, excluding hidden and unresolved groups (H8)', async () => {
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    await duplicates.setReason('isbn')
    duplicates.hideGroup(9)
    const strong = duplicateGroup(1, [book(1), book(2)], ['isbn'])
    const undecided = duplicateGroup(2, [book(3), book(4)], ['fuzzy_metadata'])

    expect(duplicates.buildResolution([strong, undecided], { allGroups: true, removeIdenticalCopies: true })).toEqual({
      scanId: 11,
      groups: [{ groupId: 1, keeperId: 1, action: 'merge' }],
      allGroups: { kind: 'duplicate', keepRule: 'metadata', reason: 'isbn', excludeGroupIds: [9, 2] },
      removeIdenticalCopies: true,
    })
  })

  it('says how many groups one pass covers when every page is selected', () => {
    const { duplicates } = mountComposable()
    duplicates.total.value = BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS + 250
    duplicates.selectAllGroups()

    expect(duplicates.selectionGroupCount.value).toBe(BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS)
    expect(duplicates.allGroupsCapped.value).toBe(true)

    duplicates.total.value = 40
    expect(duplicates.selectionGroupCount.value).toBe(40)
    expect(duplicates.allGroupsCapped.value).toBe(false)
  })

  it('never asks to remove identical copies without the delete permission', () => {
    grant(Permission.LibraryMergeBooks)
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan

    const request = duplicates.buildResolution([duplicateGroup(1, [book(1), book(2)], ['file_hash'])], { removeIdenticalCopies: true })

    expect(request?.removeIdenticalCopies).toBeUndefined()
  })

  it('follows a resolution over the socket and reloads the results once it finishes', async () => {
    vi.mocked(startBookDuplicateResolution).mockResolvedValue({ jobId: 5, total: 1 })
    vi.mocked(getBookDuplicateResolution).mockResolvedValue(finishedJob())
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    duplicates.toggleSelected(1)

    await expect(duplicates.resolveGroups([duplicateGroup(1, [book(1), book(2)], ['file_hash'])])).resolves.toBe(true)

    expect(startBookDuplicateResolution).toHaveBeenCalledWith({ scanId: 11, groups: [{ groupId: 1, keeperId: 1, action: 'merge' }] })
    expect(duplicates.resolving.value).toBe(true)

    const outcome = finishedJob().outcomes[0]!
    emitSocket('book-duplicates:resolution-progress', { jobId: 5, status: 'running', processed: 1, total: 1, currentGroupId: 1, outcome })
    expect(duplicates.resolution.job.value?.outcomes).toEqual([outcome])

    emitSocket('book-duplicates:resolution-finished', { jobId: 5, status: 'completed', processed: 1, total: 1, currentGroupId: null, outcome: null })
    await flushPromises()

    expect(getBookDuplicateResolution).toHaveBeenCalledWith(5)
    expect(duplicates.resolving.value).toBe(false)
    expect(duplicates.selectedGroupIds.value.size).toBe(0)
    expect(getBookDuplicateGroups).toHaveBeenCalledWith(11, {
      page: 1,
      pageSize: 20,
      reason: undefined,
      sortBy: 'reclaimable',
      order: 'desc',
      kind: 'duplicate',
    })
    expect(toast.success).toHaveBeenCalledOnce()
  })

  it('reads the run over HTTP when the socket goes quiet, and warns about groups left unresolved', async () => {
    vi.mocked(startBookDuplicateResolution).mockResolvedValue({ jobId: 5, total: 2 })
    vi.mocked(getBookDuplicateResolution).mockResolvedValue(
      finishedJob({
        total: 2,
        processed: 2,
        outcomes: [
          { groupId: 1, keeperId: 1, status: 'done', reason: null, books: [] },
          {
            groupId: 2,
            keeperId: 3,
            status: 'failed',
            reason: null,
            books: [{ bookId: 4, action: 'delete', status: 'failed', reason: 'DELETE_FAILED' }],
          },
        ],
      }),
    )
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan

    await duplicates.resolveGroups([duplicateGroup(1, [book(1), book(2)]), duplicateGroup(2, [book(3), book(4)])])
    await vi.advanceTimersByTimeAsync(4000)

    expect(getBookDuplicateResolution).toHaveBeenCalledWith(5)
    expect(duplicates.resolution.finished.value).toBe(true)
    expect(toast.warning).toHaveBeenCalledOnce()
  })

  it('reports a resolution that could not start and keeps the selection', async () => {
    vi.mocked(startBookDuplicateResolution).mockRejectedValue(new Error('busy'))
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    duplicates.toggleSelected(1)

    await expect(duplicates.resolveGroups([duplicateGroup(1, [book(1), book(2)])])).resolves.toBe(false)

    expect(duplicates.resolution.error.value).toBe('busy')
    expect(duplicates.selectedGroupIds.value.has(1)).toBe(true)
  })

  it('switches to the other-format list and clears the selection', async () => {
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    duplicates.toggleSelected(1)
    duplicates.selectAllGroups()

    await duplicates.setKind('other_format')

    expect(duplicates.kind.value).toBe('other_format')
    expect(duplicates.allGroupsSelected.value).toBe(false)
    expect(duplicates.selectedGroupIds.value.size).toBe(0)
    expect(getBookDuplicateGroups).toHaveBeenLastCalledWith(11, {
      page: 1,
      pageSize: 20,
      reason: undefined,
      sortBy: 'reclaimable',
      order: 'desc',
      kind: 'other_format',
    })
  })

  it('restores an other-format dismissal by its kind', async () => {
    vi.mocked(restoreBookDuplicateDismissal).mockResolvedValue(undefined)
    const { duplicates } = mountComposable()
    duplicates.dismissals.value = [
      { kind: 'duplicate', bookIdA: 1, bookIdB: 2, titleA: null, titleB: null, createdAt: '2026-01-01T00:00:00.000Z' },
      { kind: 'other_format', bookIdA: 1, bookIdB: 2, titleA: null, titleB: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]

    await duplicates.restoreDismissal(1, 2, 'other_format')

    expect(restoreBookDuplicateDismissal).toHaveBeenCalledWith(1, 2, 'other_format')
    expect(duplicates.dismissals.value.map((entry) => entry.kind)).toEqual(['duplicate'])
  })
})
