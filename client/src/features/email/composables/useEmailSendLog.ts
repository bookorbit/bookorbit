import { ref } from 'vue'
import { api } from '@/lib/api'

export interface EmailSendLogEntry {
  id: number
  userId: number
  bookId: number | null
  bookFileId: number | null
  providerId: number | null
  templateId: number | null
  toEmail: string
  toName: string | null
  subject: string | null
  status: 'pending' | 'sent' | 'failed'
  attemptCount: number
  errorMessage: string | null
  sentAt: string | null
  createdAt: string
}

const logEntries = ref<EmailSendLogEntry[]>([])
const total = ref(0)

export function useEmailSendLog() {
  async function fetchLog(page = 0, size = 20) {
    const res = await api(`/api/v1/email/log?page=${page}&size=${size}`)
    if (!res.ok) throw new Error('Failed to load send log')
    const data = await res.json()
    const items: EmailSendLogEntry[] = Array.isArray(data) ? data : (data.items ?? [])
    if (page === 0) {
      logEntries.value = items
    } else {
      logEntries.value = [...logEntries.value, ...items]
    }
  }

  async function deleteEntry(id: number): Promise<void> {
    const res = await api(`/api/v1/email/log/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete log entry')
    logEntries.value = logEntries.value.filter((e) => e.id !== id)
  }

  async function resendEntry(id: number): Promise<void> {
    const res = await api(`/api/v1/email/log/${id}/resend`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to resend')
    }
  }

  return { logEntries, total, fetchLog, deleteEntry, resendEntry }
}
