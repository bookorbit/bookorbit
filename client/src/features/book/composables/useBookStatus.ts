import { api } from '@/lib/api'
import { Book, BookCheck, BookOpen, BookX } from 'lucide-vue-next'
import type { ReadStatus } from '@projectx/types'

export type StatusOption = {
  value: ReadStatus
  label: string
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'read', label: 'Read' },
  { value: 'abandoned', label: 'Abandoned' },
]

export const STATUS_ICONS: Record<ReadStatus, unknown> = {
  unread: Book,
  reading: BookOpen,
  read: BookCheck,
  abandoned: BookX,
}

export const STATUS_COLORS: Record<ReadStatus, string> = {
  unread: 'text-muted-foreground',
  reading: 'text-blue-500',
  read: 'text-emerald-500',
  abandoned: 'text-orange-400',
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
