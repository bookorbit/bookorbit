import { ref } from 'vue'

import { api } from '@/lib/api'

const SETTING_KEY = 'allow_registration'

export type SelfRegistrationError = 'load' | 'save'

export function useSelfRegistration() {
  const allowRegistration = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<SelfRegistrationError | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await api('/api/v1/app-settings')
      if (!res.ok) throw new Error('load')
      const settings = (await res.json()) as { key: string; value: string }[]
      allowRegistration.value = Array.isArray(settings) && settings.find((s) => s.key === SETTING_KEY)?.value === 'true'
    } catch {
      error.value = 'load'
    } finally {
      loading.value = false
    }
  }

  async function setAllowRegistration(next: boolean): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/app-settings/${SETTING_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(next) }),
      })
      if (!res.ok) throw new Error('save')
      allowRegistration.value = next
      return true
    } catch {
      error.value = 'save'
      return false
    } finally {
      saving.value = false
    }
  }

  return { allowRegistration, loading, saving, error, load, setAllowRegistration }
}
