import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BOOK_METADATA_LOCK_FIELDS } from '@bookorbit/types'

const toastMock = vi.hoisted(() => ({
  error: vi.fn<(message: string) => void>(),
}))

vi.mock('vue-sonner', () => ({
  toast: toastMock,
}))

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

import { useTableLocks } from '../useTableLocks'

function makeOkResponse(fields: string[] = []) {
  return { ok: true, json: async () => ({ lockedFields: fields }) }
}

describe('useTableLocks', () => {
  beforeEach(() => {
    apiMock.mockReset()
    toastMock.error.mockClear()
  })

  describe('initBook', () => {
    it('initializes lock state for a book', () => {
      const { initBook, getFields } = useTableLocks()
      initBook(1, ['title', 'authors'])
      expect(getFields(1)).toEqual(['title', 'authors'])
    })

    it('refreshes fields from server for non-pending entries', () => {
      const { initBook, getFields } = useTableLocks()
      initBook(1, ['title'])
      initBook(1, ['authors'])
      expect(getFields(1)).toEqual(['authors'])
    })

    it('does not overwrite pending entries (optimistic update in-flight)', () => {
      const { initBook, getFields, toggleField } = useTableLocks()
      initBook(1, ['title'])
      // Mock api to hang (never resolve) so pending stays true
      apiMock.mockReturnValueOnce(new Promise(() => {}))
      void toggleField(1, 'rating') // marks as pending (optimistic: adds 'rating')
      // A server-side refresh while pending should be ignored
      initBook(1, ['authors'])
      expect(getFields(1)).toContain('rating') // optimistic state preserved
    })

    it('returns empty array for uninitialised book', () => {
      const { getFields } = useTableLocks()
      expect(getFields(99)).toEqual([])
    })
  })

  describe('isLocked', () => {
    it('returns true for a locked field', () => {
      const { initBook, isLocked } = useTableLocks()
      initBook(1, ['title', 'cover'])
      expect(isLocked(1, 'title')).toBe(true)
      expect(isLocked(1, 'cover')).toBe(true)
    })

    it('returns false for an unlocked field', () => {
      const { initBook, isLocked } = useTableLocks()
      initBook(1, ['title'])
      expect(isLocked(1, 'authors')).toBe(false)
    })

    it('returns false for an uninitialised book', () => {
      const { isLocked } = useTableLocks()
      expect(isLocked(99, 'title')).toBe(false)
    })
  })

  describe('isPending', () => {
    it('returns false when not pending', () => {
      const { initBook, isPending } = useTableLocks()
      initBook(1, [])
      expect(isPending(1)).toBe(false)
    })

    it('returns false for uninitialised book', () => {
      const { isPending } = useTableLocks()
      expect(isPending(99)).toBe(false)
    })
  })

  describe('toggleField', () => {
    it('locks an unlocked field optimistically', async () => {
      apiMock.mockResolvedValue(makeOkResponse(['title']))
      const { initBook, isLocked, toggleField } = useTableLocks()
      initBook(1, [])

      const promise = toggleField(1, 'title')
      expect(isLocked(1, 'title')).toBe(true)
      await promise
      expect(isLocked(1, 'title')).toBe(true)
    })

    it('unlocks a locked field optimistically', async () => {
      apiMock.mockResolvedValue(makeOkResponse([]))
      const { initBook, isLocked, toggleField } = useTableLocks()
      initBook(1, ['title'])

      const promise = toggleField(1, 'title')
      expect(isLocked(1, 'title')).toBe(false)
      await promise
      expect(isLocked(1, 'title')).toBe(false)
    })

    it('reverts optimistic update and shows toast on API error', async () => {
      apiMock.mockRejectedValue(new Error('network error'))
      const { initBook, isLocked, toggleField } = useTableLocks()
      initBook(1, [])

      await toggleField(1, 'title')

      expect(isLocked(1, 'title')).toBe(false)
      expect(toastMock.error).toHaveBeenCalledWith('Failed to update locks')
    })

    it('reverts optimistic update on non-ok HTTP response', async () => {
      apiMock.mockResolvedValue({ ok: false, status: 409 })
      const { initBook, isLocked, toggleField } = useTableLocks()
      initBook(1, [])

      await toggleField(1, 'title')

      expect(isLocked(1, 'title')).toBe(false)
      expect(toastMock.error).toHaveBeenCalledWith('Failed to update locks')
    })

    it('sends PATCH request with correct locked fields', async () => {
      apiMock.mockResolvedValue(makeOkResponse(['title', 'authors']))
      const { initBook, toggleField } = useTableLocks()
      initBook(1, ['title'])

      await toggleField(1, 'authors')

      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/books/1/metadata-locks',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ lockedFields: ['title', 'authors'] }),
        }),
      )
    })

    it('does nothing for an uninitialised book', async () => {
      const { toggleField } = useTableLocks()
      await toggleField(99, 'title')
      expect(apiMock).not.toHaveBeenCalled()
    })

    it('clears pending flag after successful call', async () => {
      apiMock.mockResolvedValue(makeOkResponse(['title']))
      const { initBook, isPending, toggleField } = useTableLocks()
      initBook(1, [])
      await toggleField(1, 'title')
      expect(isPending(1)).toBe(false)
    })

    it('clears pending flag after failed call', async () => {
      apiMock.mockRejectedValue(new Error('fail'))
      const { initBook, isPending, toggleField } = useTableLocks()
      initBook(1, [])
      await toggleField(1, 'title')
      expect(isPending(1)).toBe(false)
    })
  })

  describe('lockAll', () => {
    it('locks all known fields optimistically', async () => {
      apiMock.mockResolvedValue(makeOkResponse([...BOOK_METADATA_LOCK_FIELDS]))
      const { initBook, getFields, lockAll } = useTableLocks()
      initBook(1, [])

      const promise = lockAll(1)
      expect(getFields(1)).toEqual([...BOOK_METADATA_LOCK_FIELDS])
      await promise
    })

    it('sends all lock fields in request body', async () => {
      apiMock.mockResolvedValue(makeOkResponse([...BOOK_METADATA_LOCK_FIELDS]))
      const { initBook, lockAll } = useTableLocks()
      initBook(1, [])

      await lockAll(1)

      const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(String(req.body))
      expect(body.lockedFields).toEqual([...BOOK_METADATA_LOCK_FIELDS])
    })

    it('reverts on failure', async () => {
      apiMock.mockRejectedValue(new Error('fail'))
      const { initBook, getFields, lockAll } = useTableLocks()
      initBook(1, ['title'])

      await lockAll(1)

      expect(getFields(1)).toEqual(['title'])
      expect(toastMock.error).toHaveBeenCalledWith('Failed to update locks')
    })
  })

  describe('unlockAll', () => {
    it('removes all locked fields optimistically', async () => {
      apiMock.mockResolvedValue(makeOkResponse([]))
      const { initBook, getFields, unlockAll } = useTableLocks()
      initBook(1, ['title', 'authors', 'cover'])

      const promise = unlockAll(1)
      expect(getFields(1)).toEqual([])
      await promise
    })

    it('sends empty lockedFields array in request body', async () => {
      apiMock.mockResolvedValue(makeOkResponse([]))
      const { initBook, unlockAll } = useTableLocks()
      initBook(1, ['title'])

      await unlockAll(1)

      const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(String(req.body))).toEqual({ lockedFields: [] })
    })

    it('reverts on failure', async () => {
      apiMock.mockRejectedValue(new Error('fail'))
      const { initBook, getFields, unlockAll } = useTableLocks()
      initBook(1, ['title', 'cover'])

      await unlockAll(1)

      expect(getFields(1)).toEqual(['title', 'cover'])
      expect(toastMock.error).toHaveBeenCalledWith('Failed to update locks')
    })
  })

  describe('resetBook', () => {
    it('removes the book from lock state', () => {
      const { initBook, getFields, resetBook } = useTableLocks()
      initBook(1, ['title'])
      resetBook(1)
      expect(getFields(1)).toEqual([])
    })

    it('re-init is allowed after reset', () => {
      const { initBook, getFields, resetBook } = useTableLocks()
      initBook(1, ['title'])
      resetBook(1)
      initBook(1, ['authors'])
      expect(getFields(1)).toEqual(['authors'])
    })
  })

  describe('multiple books', () => {
    it('manages lock state independently per book', async () => {
      apiMock.mockResolvedValue(makeOkResponse(['title']))
      const { initBook, isLocked, toggleField } = useTableLocks()
      initBook(1, [])
      initBook(2, ['authors'])

      await toggleField(1, 'title')

      expect(isLocked(1, 'title')).toBe(true)
      expect(isLocked(2, 'title')).toBe(false)
      expect(isLocked(2, 'authors')).toBe(true)
    })
  })

  describe('concurrent guard', () => {
    it('ignores concurrent applyLocks while one is pending', async () => {
      let resolveFirst!: (v: unknown) => void
      apiMock.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      const { initBook, toggleField, getFields } = useTableLocks()
      initBook(1, [])

      const firstCall = toggleField(1, 'title')
      // Second call while first is pending - should be ignored
      await toggleField(1, 'authors')

      expect(apiMock).toHaveBeenCalledTimes(1)
      expect(getFields(1)).toContain('title')
      expect(getFields(1)).not.toContain('authors')

      resolveFirst(makeOkResponse(['title']))
      await firstCall
    })
  })
})
