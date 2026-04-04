import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { BOOK_METADATA_LOCK_FIELDS, type BookDetail, type BookMetadataLockField } from '@projectx/types'

function normalizeLockedFields(fields: readonly BookMetadataLockField[]): BookMetadataLockField[] {
  const unique = new Set(fields)
  return BOOK_METADATA_LOCK_FIELDS.filter((field) => unique.has(field))
}

export function useMetadataLocks() {
  const lockedFields = ref<BookMetadataLockField[]>([])
  const updatingField = ref<BookMetadataLockField | 'all' | null>(null)
  const error = ref<string | null>(null)

  const updating = computed(() => updatingField.value !== null)
  const lockedFieldSet = computed(() => new Set(lockedFields.value))
  const areAllLocked = computed(() => BOOK_METADATA_LOCK_FIELDS.every((field) => lockedFieldSet.value.has(field)))

  function load(book: BookDetail) {
    lockedFields.value = normalizeLockedFields(book.lockedFields)
    error.value = null
  }

  function isLocked(field: BookMetadataLockField): boolean {
    return lockedFieldSet.value.has(field)
  }

  async function replace(
    bookId: number,
    nextLockedFields: readonly BookMetadataLockField[],
    scope: BookMetadataLockField | 'all',
  ): Promise<BookDetail | null> {
    updatingField.value = scope
    error.value = null
    try {
      const normalized = normalizeLockedFields(nextLockedFields)
      const res = await api(`/api/v1/books/${bookId}/metadata-locks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedFields: normalized }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated: BookDetail = await res.json()
      lockedFields.value = normalizeLockedFields(updated.lockedFields)
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update locks'
      return null
    } finally {
      updatingField.value = null
    }
  }

  function isUpdating(field: BookMetadataLockField): boolean {
    return updatingField.value === field || updatingField.value === 'all'
  }

  async function toggle(bookId: number, field: BookMetadataLockField): Promise<BookDetail | null> {
    const nextLockedFields = isLocked(field) ? lockedFields.value.filter((lockedField) => lockedField !== field) : [...lockedFields.value, field]
    return replace(bookId, nextLockedFields, field)
  }

  async function lockAll(bookId: number): Promise<BookDetail | null> {
    return replace(bookId, BOOK_METADATA_LOCK_FIELDS, 'all')
  }

  async function unlockAll(bookId: number): Promise<BookDetail | null> {
    return replace(bookId, [], 'all')
  }

  return {
    lockedFields,
    updating,
    error,
    areAllLocked,
    load,
    isLocked,
    isUpdating,
    replace,
    toggle,
    lockAll,
    unlockAll,
  }
}
