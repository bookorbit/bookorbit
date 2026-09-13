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

describe('useBookDockFiles ready-to-file filter', () => {
  it('uses the ready-to-file query and preserves it for select-all actions', async () => {
    apiMock.mockResolvedValue({
      ok: true,
      json: vi
        .fn<() => Promise<{ items: []; total: number; page: number; size: number }>>()
        .mockResolvedValue({ items: [], total: 1, page: 1, size: 20 }),
    } as unknown as Response)
    const files = useBookDockFiles()

    files.setView('readyToFile')

    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledOnce())
    const requestUrl = String(apiMock.mock.calls[0]?.[0])
    expect(requestUrl).toContain('readyToFile=true')
    expect(requestUrl).not.toContain('status=ready')
    expect(files.activeView.value).toBe('readyToFile')

    files.toggleSelectAll()

    expect(files.getSelectionPayload()).toEqual({ selectAll: true, excludedIds: [], readyToFile: true })
  })
})
