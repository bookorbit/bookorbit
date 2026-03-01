import { ref } from 'vue'
import { api } from '@/lib/api'

export interface EmailPreferences {
  userId: number
  defaultProviderId: number | null
  defaultRecipientId: number | null
  defaultTemplateId: number | null
}

const preferences = ref<EmailPreferences | null>(null)

export function useEmailPreferences() {
  async function fetchPreferences() {
    const res = await api('/api/v1/email/preferences')
    if (!res.ok) throw new Error('Failed to load preferences')
    preferences.value = await res.json()
  }

  async function savePreferences(prefs: Partial<EmailPreferences>): Promise<void> {
    const res = await api('/api/v1/email/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    })
    if (!res.ok) throw new Error('Failed to save preferences')
    preferences.value = await res.json()
  }

  return { preferences, fetchPreferences, savePreferences }
}
