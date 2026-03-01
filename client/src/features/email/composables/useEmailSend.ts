import { api } from '@/lib/api'

export interface SendBookPayload {
  bookIds: number[]
  recipientIds?: number[]
  groupIds?: number[]
  fileId?: number
  providerId?: number
  templateId?: number
}

export function useEmailSend() {
  async function sendBook(payload: SendBookPayload): Promise<{ queued: number }> {
    const res = await api('/api/v1/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to send')
    }
    return res.json()
  }

  async function quickSend(bookId: number): Promise<{ queued: number }> {
    const res = await api(`/api/v1/email/send/quick/${bookId}`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to send')
    }
    return res.json()
  }

  return { sendBook, quickSend }
}
