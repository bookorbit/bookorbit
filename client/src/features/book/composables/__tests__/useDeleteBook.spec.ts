import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import { useDeleteBook } from '../useDeleteBook'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() },
  refreshLibraryCounts: vi.fn<() => void>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('vue-sonner', () => ({ toast: mocks.toast }))
vi.mock('@/features/library/composables/useLibraryCountsRefresh', () => ({ useLibraryCountsRefresh: () => mocks.refreshLibraryCounts }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([
      { id: 1, accessLevel: 'editor' },
      { id: 2, accessLevel: 'editor' },
    ]),
  }),
}))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isSuperuser: ref(false) }),
}))

function json(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body } as unknown as Response
}

const detail = {
  id: 10,
  libraryId: 1,
  libraryName: 'Novels',
  status: 'present',
  files: [],
  linkSelf: {
    bookId: 10,
    libraryId: 1,
    libraryName: 'Novels',
    title: 'Dune',
    formats: ['epub'],
    mediaKind: 'ebook',
    status: 'present',
    isLead: true,
  },
  linkedBooks: [
    {
      bookId: 20,
      libraryId: 2,
      libraryName: 'Audiobooks',
      title: 'Dune',
      formats: ['m4b'],
      mediaKind: 'audiobook',
      status: 'present',
      isLead: false,
    },
    { bookId: 30, libraryId: 9, libraryName: 'Hidden', title: 'Dune', formats: ['pdf'], mediaKind: 'ebook', status: 'present', isLead: false },
  ],
} as unknown as BookDetail

describe('useDeleteBook', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.toast.success.mockReset()
    mocks.toast.error.mockReset()
    mocks.refreshLibraryCounts.mockReset()
  })

  it('looks up a linked card’s editions and deletes them all when asked', async () => {
    const deleted: number[] = []
    const del = useDeleteBook((id) => deleted.push(id))
    mocks.api.mockResolvedValueOnce(json(detail))

    del.promptDelete(10, { linked: { groupId: 1, memberCount: 3, books: [] } })
    await flushPromises()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/10')
    expect(del.editions.value?.others.map((other) => other.bookId)).toEqual([20])
    expect(del.editions.value?.kept).toBe(1)

    mocks.api.mockResolvedValueOnce(json(null, 204))
    await del.confirmDelete('all')
    const [, init] = mocks.api.mock.calls.at(-1)!
    expect(JSON.parse(String(init?.body))).toEqual({ bookIds: [10, 20] })
    expect(deleted).toEqual([10, 20])
    expect(mocks.toast.success).toHaveBeenCalledWith('Deleted 2 editions')
    expect(del.editions.value).toBeNull()
  })

  it('deletes only this edition by default and never looks up a lone book', async () => {
    const deleted: number[] = []
    const del = useDeleteBook((id) => deleted.push(id))
    del.promptDelete(10, {})
    expect(mocks.api).not.toHaveBeenCalled()

    mocks.api.mockResolvedValueOnce(json(null, 204))
    await del.confirmDelete()
    expect(JSON.parse(String(mocks.api.mock.calls[0]![1]?.body))).toEqual({ bookIds: [10] })
    expect(deleted).toEqual([10])
    expect(mocks.toast.success).toHaveBeenCalledWith('Book deleted')
    expect(mocks.refreshLibraryCounts).toHaveBeenCalledOnce()
  })

  it('keeps the book and the counts when the delete fails', async () => {
    const deleted: number[] = []
    const del = useDeleteBook((id) => deleted.push(id))
    del.promptDelete(10)

    mocks.api.mockResolvedValueOnce(json(null, 500))
    await del.confirmDelete()
    expect(deleted).toEqual([])
    expect(mocks.toast.error).toHaveBeenCalledWith('Could not delete the book')
    expect(mocks.refreshLibraryCounts).not.toHaveBeenCalled()
  })
})
