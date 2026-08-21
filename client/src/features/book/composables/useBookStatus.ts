import { api } from '@/lib/api'
import { Book, BookCheck, BookMarked, BookOpen, BookX, Pause, RotateCcw, ScanLine } from '@lucide/vue'
import type { ReadStatus, UserBookStatus } from '@bookorbit/types'

export type StatusOption = {
  value: ReadStatus
  label: string
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'want_to_read', label: 'Want to read' },
  { value: 'reading', label: 'Reading' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'rereading', label: 'Re-reading' },
  { value: 'read', label: 'Read' },
  { value: 'skimmed', label: 'Skimmed' },
  { value: 'abandoned', label: 'Abandoned' },
]

export const STATUS_ICONS: Record<ReadStatus, unknown> = {
  unread: Book,
  want_to_read: BookMarked,
  reading: BookOpen,
  on_hold: Pause,
  rereading: RotateCcw,
  read: BookCheck,
  skimmed: ScanLine,
  abandoned: BookX,
}

export const STATUS_COLORS: Record<ReadStatus, string> = {
  unread: 'text-muted-foreground',
  want_to_read: 'text-violet-500',
  reading: 'text-blue-500',
  on_hold: 'text-amber-500',
  rereading: 'text-fuchsia-500',
  read: 'text-emerald-500',
  skimmed: 'text-cyan-500',
  abandoned: 'text-rose-400',
}

export type ReadStatusPatch = {
  status?: ReadStatus
  startedAt?: string | null
  finishedAt?: string | null
}

export class ReadStatusUpdateError extends Error {
  constructor(
    message: string,
    readonly errorCode: string | null,
  ) {
    super(message)
    this.name = 'ReadStatusUpdateError'
  }
}

export function useBookStatus() {
  async function updateStatus(bookId: number, patch: ReadStatusPatch): Promise<UserBookStatus> {
    const res = await api(`/api/v1/books/${bookId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      let errorCode: string | null = null
      try {
        const body = (await res.json()) as { errorCode?: unknown }
        if (typeof body.errorCode === 'string') errorCode = body.errorCode
      } catch {
        errorCode = null
      }
      throw new ReadStatusUpdateError(`HTTP ${res.status}`, errorCode)
    }
    return (await res.json()) as UserBookStatus
  }

  async function setStatus(bookId: number, status: ReadStatus): Promise<UserBookStatus> {
    return updateStatus(bookId, { status })
  }

  return { setStatus, updateStatus, STATUS_OPTIONS }
}
