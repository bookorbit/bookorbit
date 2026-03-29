import { api } from '@/lib/api'
import { Book, BookCheck, BookMarked, BookOpen, BookX, Pause, RotateCcw, ScanLine } from 'lucide-vue-next'
import type { ReadStatus } from '@projectx/types'

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

export function useBookStatus() {
  async function setStatus(bookId: number, status: ReadStatus): Promise<void> {
    const res = await api(`/api/v1/books/${bookId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }

  return { setStatus, STATUS_OPTIONS }
}
