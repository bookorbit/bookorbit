import { ref } from 'vue'
import { api } from '@/lib/api'

export interface EmailRecipient {
  id: number
  userId: number
  name: string
  email: string
  isDefault: boolean
  deviceType: string | null
  preferredFormat: string | null
  defaultTemplateId: number | null
  createdAt: string
}

export interface EmailRecipientForm {
  name: string
  email: string
  deviceType: string | null
  preferredFormat: string | null
  defaultTemplateId: number | null
}

const recipients = ref<EmailRecipient[]>([])
let fetchPromise: Promise<void> | null = null

export function useEmailRecipients() {
  async function fetchRecipients(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/email/recipients')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load recipients')
        recipients.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function createRecipient(form: EmailRecipientForm): Promise<EmailRecipient> {
    const res = await api('/api/v1/email/recipients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to create recipient')
    }
    const created: EmailRecipient = await res.json()
    recipients.value = [...recipients.value, created]
    return created
  }

  async function updateRecipient(id: number, form: Partial<EmailRecipientForm>): Promise<EmailRecipient> {
    const res = await api(`/api/v1/email/recipients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to update recipient')
    }
    const updated: EmailRecipient = await res.json()
    recipients.value = recipients.value.map((r) => (r.id === id ? updated : r))
    return updated
  }

  async function deleteRecipient(id: number): Promise<void> {
    const res = await api(`/api/v1/email/recipients/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete recipient')
    recipients.value = recipients.value.filter((r) => r.id !== id)
  }

  async function setDefaultRecipient(id: number): Promise<void> {
    const res = await api(`/api/v1/email/recipients/${id}/default`, { method: 'PATCH' })
    if (!res.ok) throw new Error('Failed to set default')
    const updated: EmailRecipient = await res.json()
    recipients.value = recipients.value.map((r) => ({ ...r, isDefault: r.id === updated.id ? updated.isDefault : false }))
  }

  return { recipients, fetchRecipients, createRecipient, updateRecipient, deleteRecipient, setDefaultRecipient }
}
