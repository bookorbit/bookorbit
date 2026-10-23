import type { EmailSendLogEntry, EmailSendLogSummary } from '@bookorbit/types'
export type { EmailSendLogEntry, EmailSendLogSummary } from '@bookorbit/types'
import { ref } from 'vue'
import { api } from '@/lib/api'

export type EmailLogStatus = EmailSendLogEntry['status']

export const RECENT_LOG_SIZE = 12

const recent = ref<EmailSendLogEntry[]>([])
const attention = ref<EmailSendLogEntry[]>([])
const summary = ref<EmailSendLogSummary | null>(null)

async function getJson<T>(url: string, failure: string): Promise<T> {
  const res = await api(url)
  if (!res.ok) throw new Error(failure)
  return res.json() as Promise<T>
}

/** One page of the caller's log, newest first. The endpoint answers with a bare array. */
export interface EmailLogFilter {
  status?: EmailLogStatus
  bookId?: number
  recipientId?: number
}

export function fetchLogPage(page: number, size: number, { status, bookId, recipientId }: EmailLogFilter = {}): Promise<EmailSendLogEntry[]> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (status) params.set('status', status)
  if (bookId !== undefined) params.set('bookId', String(bookId))
  if (recipientId !== undefined) params.set('recipientId', String(recipientId))
  return getJson<EmailSendLogEntry[]>(`/api/v1/email/log?${params}`, 'Failed to load send log')
}

export function useEmailSendLog() {
  async function fetchRecent(): Promise<void> {
    recent.value = await fetchLogPage(0, RECENT_LOG_SIZE)
  }

  async function fetchAttention(): Promise<void> {
    attention.value = await getJson<EmailSendLogEntry[]>('/api/v1/email/log/attention', 'Failed to load failed sends')
  }

  async function fetchSummary(): Promise<void> {
    summary.value = await getJson<EmailSendLogSummary>('/api/v1/email/log/summary', 'Failed to load send counts')
  }

  async function deleteEntry(id: number): Promise<void> {
    const res = await api(`/api/v1/email/log/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete log entry')
    recent.value = recent.value.filter((e) => e.id !== id)
    attention.value = attention.value.filter((e) => e.id !== id)
  }

  async function resendEntry(id: number): Promise<void> {
    const res = await api(`/api/v1/email/log/${id}/resend`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to resend')
    }
  }

  return { recent, attention, summary, fetchRecent, fetchAttention, fetchSummary, deleteEntry, resendEntry }
}
