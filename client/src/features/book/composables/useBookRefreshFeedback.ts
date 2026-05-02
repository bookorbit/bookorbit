import { ref } from 'vue'
import type { ColumnId } from './useTableColumns'

export type BookRefreshFeedbackState = 'refreshing' | 'success' | 'failed'

export type BookRefreshFeedbackEntry = {
  state: BookRefreshFeedbackState
  changedColumns: Set<ColumnId>
  message: string | null
  updatedAt: number
}

const feedbackByBookId = ref(new Map<number, BookRefreshFeedbackEntry>())
const clearTimers = new Map<number, ReturnType<typeof setTimeout>>()
const flashTimers = new Map<number, ReturnType<typeof setTimeout>>()

function setEntry(bookId: number, entry: BookRefreshFeedbackEntry) {
  const next = new Map(feedbackByBookId.value)
  next.set(bookId, entry)
  feedbackByBookId.value = next
}

function clearEntry(bookId: number) {
  const next = new Map(feedbackByBookId.value)
  next.delete(bookId)
  feedbackByBookId.value = next
}

function clearTimer(bookId: number) {
  const timer = clearTimers.get(bookId)
  if (!timer) return
  clearTimeout(timer)
  clearTimers.delete(bookId)
}

function clearFlashTimer(bookId: number) {
  const timer = flashTimers.get(bookId)
  if (!timer) return
  clearTimeout(timer)
  flashTimers.delete(bookId)
}

function scheduleFlashClear(bookId: number, expectedUpdatedAt: number, delayMs = 2800) {
  clearFlashTimer(bookId)
  flashTimers.set(
    bookId,
    setTimeout(() => {
      const current = feedbackByBookId.value.get(bookId)
      if (!current) return
      if (current.updatedAt !== expectedUpdatedAt || current.state !== 'success') return
      setEntry(bookId, { ...current, changedColumns: new Set<ColumnId>() })
      flashTimers.delete(bookId)
    }, delayMs),
  )
}

function scheduleEntryClear(bookId: number, expectedUpdatedAt: number, delayMs: number) {
  clearTimer(bookId)
  clearTimers.set(
    bookId,
    setTimeout(() => {
      const current = feedbackByBookId.value.get(bookId)
      if (!current) return
      if (current.updatedAt !== expectedUpdatedAt) return
      clearEntry(bookId)
      clearTimers.delete(bookId)
      clearFlashTimer(bookId)
    }, delayMs),
  )
}

export function useBookRefreshFeedback() {
  function markRefreshing(bookId: number) {
    clearTimer(bookId)
    clearFlashTimer(bookId)
    setEntry(bookId, {
      state: 'refreshing',
      changedColumns: new Set<ColumnId>(),
      message: null,
      updatedAt: Date.now(),
    })
  }

  function markRefreshingMany(bookIds: number[]) {
    for (const bookId of bookIds) {
      markRefreshing(bookId)
    }
  }

  function markSuccess(bookId: number, changedColumns: ColumnId[] = []) {
    clearTimer(bookId)
    clearFlashTimer(bookId)
    const updatedAt = Date.now()
    setEntry(bookId, {
      state: 'success',
      changedColumns: new Set(changedColumns),
      message: null,
      updatedAt,
    })
    scheduleFlashClear(bookId, updatedAt)
    scheduleEntryClear(bookId, updatedAt, 7000)
  }

  function markFailed(bookId: number, message = 'Metadata refresh failed') {
    clearTimer(bookId)
    clearFlashTimer(bookId)
    const updatedAt = Date.now()
    setEntry(bookId, {
      state: 'failed',
      changedColumns: new Set<ColumnId>(),
      message,
      updatedAt,
    })
    scheduleEntryClear(bookId, updatedAt, 10000)
  }

  function markFailedMany(bookIds: number[], message = 'Metadata refresh failed') {
    for (const bookId of bookIds) {
      markFailed(bookId, message)
    }
  }

  function getFeedback(bookId: number): BookRefreshFeedbackEntry | null {
    return feedbackByBookId.value.get(bookId) ?? null
  }

  function isCellChanged(bookId: number, columnId: ColumnId): boolean {
    return feedbackByBookId.value.get(bookId)?.changedColumns.has(columnId) ?? false
  }

  function clearFeedback(bookId: number) {
    clearTimer(bookId)
    clearFlashTimer(bookId)
    clearEntry(bookId)
  }

  return {
    markRefreshing,
    markRefreshingMany,
    markSuccess,
    markFailed,
    markFailedMany,
    clearFeedback,
    getFeedback,
    isCellChanged,
  }
}
