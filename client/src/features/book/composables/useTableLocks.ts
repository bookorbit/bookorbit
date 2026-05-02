import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { BOOK_METADATA_LOCK_FIELDS, type BookMetadataLockField } from '@bookorbit/types'
import { api } from '@/lib/api'

type LockState = {
  fields: BookMetadataLockField[]
  pending: boolean
}

export function useTableLocks() {
  const locksByBookId = ref(new Map<number, LockState>())

  function initBook(bookId: number, fields: BookMetadataLockField[]) {
    const existing = locksByBookId.value.get(bookId)
    if (!existing || !existing.pending) {
      locksByBookId.value.set(bookId, { fields: [...fields], pending: false })
    }
  }

  function getFields(bookId: number): BookMetadataLockField[] {
    return locksByBookId.value.get(bookId)?.fields ?? []
  }

  function isLocked(bookId: number, field: BookMetadataLockField): boolean {
    return getFields(bookId).includes(field)
  }

  function isPending(bookId: number): boolean {
    return locksByBookId.value.get(bookId)?.pending ?? false
  }

  async function applyLocks(bookId: number, nextFields: BookMetadataLockField[]): Promise<void> {
    const state = locksByBookId.value.get(bookId)
    if (!state || state.pending) return

    const previousFields = [...state.fields]
    state.fields = nextFields
    state.pending = true

    try {
      const res = await api(`/api/v1/books/${bookId}/metadata-locks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedFields: nextFields }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      state.fields = previousFields
      toast.error('Failed to update locks')
    } finally {
      state.pending = false
    }
  }

  async function toggleField(bookId: number, field: BookMetadataLockField): Promise<void> {
    const current = getFields(bookId)
    const next = current.includes(field) ? current.filter((f) => f !== field) : [...current, field]
    await applyLocks(bookId, next)
  }

  async function lockAll(bookId: number): Promise<void> {
    await applyLocks(bookId, [...BOOK_METADATA_LOCK_FIELDS])
  }

  async function unlockAll(bookId: number): Promise<void> {
    await applyLocks(bookId, [])
  }

  function resetBook(bookId: number) {
    locksByBookId.value.delete(bookId)
  }

  function pruneStaleEntries(activeBookIds: Set<number>) {
    for (const bookId of locksByBookId.value.keys()) {
      if (!activeBookIds.has(bookId)) {
        const state = locksByBookId.value.get(bookId)
        if (state && !state.pending) locksByBookId.value.delete(bookId)
      }
    }
  }

  return {
    locksByBookId,
    initBook,
    getFields,
    isLocked,
    isPending,
    toggleField,
    lockAll,
    unlockAll,
    resetBook,
    pruneStaleEntries,
  }
}
