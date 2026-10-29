import { ref } from 'vue'
import type { ReadAloudPreferences } from '@bookorbit/types'
import { api } from '@/lib/api'

const ENDPOINT = '/api/v1/user-preferences/read-aloud'

/**
 * The signed-in user's read-aloud defaults. Fetched each time a dialog asks rather than cached for
 * the session, so a different account signing in on the same tab never inherits them.
 */
export function useReadAloudPreferences() {
  const defaultLanguage = ref<string | null>(null)
  const loaded = ref(false)
  const saving = ref(false)

  async function load(): Promise<void> {
    try {
      const response = await api(ENDPOINT)
      if (!response.ok) return
      const body = (await response.json()) as { settings?: Partial<ReadAloudPreferences> }
      const stored = body.settings?.defaultLanguage
      defaultLanguage.value = typeof stored === 'string' && stored ? stored : null
    } catch {
      // Without a saved default nothing is preselected, which the dialog already handles.
    } finally {
      loaded.value = true
    }
  }

  async function saveDefaultLanguage(code: string): Promise<boolean> {
    saving.value = true
    try {
      const response = await api(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { defaultLanguage: code } satisfies ReadAloudPreferences }),
      })
      if (!response.ok) return false
      defaultLanguage.value = code
      return true
    } catch {
      return false
    } finally {
      saving.value = false
    }
  }

  return { defaultLanguage, loaded, saving, load, saveDefaultLanguage }
}
