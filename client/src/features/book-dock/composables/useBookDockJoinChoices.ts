import { computed, ref } from 'vue'
import { isBookDockJoinErrorCode, type BookDockFinalizeOverride } from '@bookorbit/types'

/** The existing book a docked file was asked to join, with the title the review shows for it. */
export interface BookDockJoinChoice {
  bookId: number
  title: string | null
}

/** Copy for a refused join. A code this build does not know reads as a plain refusal. */
export function joinErrorMessageKey(code: string | undefined): string {
  return isBookDockJoinErrorCode(code) ? `bookDock.finalizeDialog.join.error.${code}` : 'bookDock.finalizeDialog.join.error.generic'
}

/**
 * Which docked files the person asked to add to an existing book, and the finalize overrides that
 * carry it. The review offers a join only where the preview said `canJoinBook`, so a server that
 * predates joining never receives the field.
 */
export function useBookDockJoinChoices() {
  const choices = ref(new Map<number, BookDockJoinChoice>())
  /** The one file whose book picker is open; one at a time keeps the review short. */
  const pickerFileId = ref<number | null>(null)

  const hasChoices = computed(() => choices.value.size > 0)

  function choiceFor(fileId: number): BookDockJoinChoice | undefined {
    return choices.value.get(fileId)
  }

  function choose(fileId: number, book: BookDockJoinChoice): void {
    choices.value = new Map(choices.value).set(fileId, { bookId: book.bookId, title: book.title })
    if (pickerFileId.value === fileId) pickerFileId.value = null
  }

  function clear(fileId: number): void {
    if (!choices.value.has(fileId)) return
    const next = new Map(choices.value)
    next.delete(fileId)
    choices.value = next
  }

  /** Drops the choices of files that left the review, such as discarded duplicates. */
  function forget(fileIds: number[]): void {
    const next = new Map(choices.value)
    for (const fileId of fileIds) next.delete(fileId)
    if (next.size !== choices.value.size) choices.value = next
    if (pickerFileId.value !== null && fileIds.includes(pickerFileId.value)) pickerFileId.value = null
  }

  function openPicker(fileId: number): void {
    pickerFileId.value = fileId
  }

  function closePicker(): void {
    pickerFileId.value = null
  }

  /** Overrides for every choice, or only for `fileIds` when given. */
  function overrides(fileIds?: number[]): BookDockFinalizeOverride[] {
    const only = fileIds ? new Set(fileIds) : null
    return [...choices.value].filter(([fileId]) => !only || only.has(fileId)).map(([fileId, book]) => ({ fileId, joinBook: { bookId: book.bookId } }))
  }

  return { choices, pickerFileId, hasChoices, choiceFor, choose, clear, forget, openPicker, closePicker, overrides }
}
