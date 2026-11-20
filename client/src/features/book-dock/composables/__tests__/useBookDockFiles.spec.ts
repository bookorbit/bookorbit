import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBookDockFiles } from '../useBookDockFiles'

const apiMock = vi.fn<(...args: unknown[]) => Promise<Response>>()

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

beforeEach(() => {
  apiMock.mockReset()
})

describe('useBookDockFiles deleted selections', () => {
  it('removes a deleted file from an explicit selection', () => {
    const files = useBookDockFiles()
    files.total.value = 3
    files.toggleSelect(1)
    files.toggleSelect(2)

    files.removeDeletedSelection(1)

    expect(files.selectionCount.value).toBe(1)
    expect(files.isSelected(1)).toBe(false)
    expect(files.isSelected(2)).toBe(true)
  })

  it('keeps all remaining matches selected after deleting an excluded row', () => {
    const files = useBookDockFiles()
    files.total.value = 3
    files.toggleSelectAll()
    files.toggleSelect(1)
    expect(files.selectionCount.value).toBe(2)

    files.removeDeletedSelection(1)
    files.total.value = 2

    expect(files.selectionCount.value).toBe(2)
    expect(files.isSelected(2)).toBe(true)
    expect(files.isSelected(3)).toBe(true)
  })
})

function respondWithNothing() {
  apiMock.mockResolvedValue({
    ok: true,
    json: vi
      .fn<() => Promise<{ items: []; total: number; page: number; size: number }>>()
      .mockResolvedValue({ items: [], total: 1, page: 1, size: 20 }),
  } as unknown as Response)
}

function lastRequest(): URLSearchParams {
  const url = String(apiMock.mock.calls.at(-1)?.[0])
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

describe('useBookDockFiles views and docks', () => {
  it.each([
    ['onHold', { hold: 'held' }],
    ['working', { status: 'pending' }],
    ['ready', { hold: 'clear' }],
    ['error', { status: 'error' }],
  ] as const)('asks for the %s view and keeps it for select-all', async (view, expected) => {
    respondWithNothing()
    const files = useBookDockFiles()

    files.setView(view)

    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledOnce())
    const params = lastRequest()
    for (const [key, value] of Object.entries(expected)) expect(params.get(key)).toBe(value)
    expect(params.has('needsReview')).toBe(false)
    expect(files.activeView.value).toBe(view)

    files.toggleSelectAll()
    expect(files.getSelectionPayload()).toEqual({ selectAll: true, excludedIds: [], ...expected })
  })

  it('narrows On hold to one reason, and a new view clears it', async () => {
    respondWithNothing()
    const files = useBookDockFiles()

    files.setHoldReason('duplicate')
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledOnce())
    expect(lastRequest().get('hold')).toBe('duplicate')
    expect(files.activeView.value).toBe('onHold')

    files.setView('onHold')
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
    expect(lastRequest().get('hold')).toBe('held')
    expect(files.filters.reason).toBeNull()
  })

  it('filters by dock, sends it with select-all, and leaves it out for every dock', async () => {
    respondWithNothing()
    const files = useBookDockFiles()

    files.setDock(7, 'onHold')
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledOnce())
    expect(lastRequest().get('dock')).toBe('7')
    files.toggleSelectAll()
    expect(files.getSelectionPayload()).toEqual({ selectAll: true, excludedIds: [], dock: '7', hold: 'held' })

    files.setDock('unsorted')
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
    expect(lastRequest().get('dock')).toBe('unsorted')
    expect(files.selectionCount.value).toBe(0)

    files.setDock('all')
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3))
    expect(lastRequest().has('dock')).toBe(false)
  })
})
