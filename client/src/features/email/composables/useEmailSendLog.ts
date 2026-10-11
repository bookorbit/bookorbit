import type { EmailSendLogEntry } from '@bookorbit/types'
export type { EmailSendLogEntry } from '@bookorbit/types'
import { ref } from 'vue'
import { api } from '@/lib/api'

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
