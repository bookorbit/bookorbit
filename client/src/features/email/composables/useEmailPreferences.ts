import { ref } from 'vue'
import { api } from '@/lib/api'

/** The defaults sending uses. The server answers with these even for an account that only used stars. */
export interface EmailPreferences {
  userId: number
  defaultProviderId: number | null
  defaultRecipientId: number | null
  defaultTemplateId: number | null
}

export type EmailDefaultsPatch = Partial<Pick<EmailPreferences, 'defaultProviderId' | 'defaultRecipientId' | 'defaultTemplateId'>>

const preferences = ref<EmailPreferences | null>(null)
let fetchPromise: Promise<void> | null = null

export function useEmailPreferences() {
  async function fetchPreferences(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/email/preferences')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load preferences')
        preferences.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function savePreferences(prefs: EmailDefaultsPatch): Promise<void> {
    const res = await api('/api/v1/email/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to save preferences')
    }
    preferences.value = await res.json()
  }

  return { preferences, fetchPreferences, savePreferences }
}
