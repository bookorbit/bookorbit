import { ref } from 'vue'
import { api } from '@/lib/api'
import { DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS } from '@bookorbit/types'
import type { BookRequestAutomationSettings, UpdateBookRequestAutomationSettingsPayload } from '@bookorbit/types'

const BASE_PATH = '/api/v1/admin/book-request-automation'

/**
 * The instance-level automation knobs. Held behind `ManageAppSettings`, so this is only ever
 * reached from the settings page, never from the requests page an approver works in.
 */
export function useRequestAutomation() {
  const settings = ref<BookRequestAutomationSettings>({ ...DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS })
  const loading = ref(false)
  const loadFailed = ref(false)

  async function fetchSettings(): Promise<void> {
    loading.value = true
    loadFailed.value = false
    try {
      const res = await api(BASE_PATH)
      if (!res.ok) {
        loadFailed.value = true
        return
      }
      settings.value = (await res.json()) as BookRequestAutomationSettings
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  /** Sends only what changed, and adopts whatever the server says the settings now are. */
  async function put(payload: UpdateBookRequestAutomationSettingsPayload): Promise<boolean> {
    try {
      const res = await api(BASE_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return false
      settings.value = (await res.json()) as BookRequestAutomationSettings
      return true
    } catch {
      return false
    }
  }

  /**
   * One save at a time. Each sends only the knob that moved and adopts the whole reply, so letting
   * two overlap would settle the panel on whichever reply landed last rather than on what was
   * asked for. Queued rather than refused: refusing loses the change, and reads as a failed save.
   */
  let queue: Promise<unknown> = Promise.resolve()

  function save(payload: UpdateBookRequestAutomationSettingsPayload): Promise<boolean> {
    const done = queue.then(() => put(payload))
    queue = done
    return done
  }

  return { settings, loading, loadFailed, fetchSettings, save }
}
