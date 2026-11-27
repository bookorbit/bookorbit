import { ref } from 'vue'
import type { InvitationLifetimeMinutes, InvitationLifetimeSetting } from '@bookorbit/types'
import { api } from '@/lib/api'

const endpoint = '/api/v1/app-settings/invitation-lifetime'

export function useInvitationLifetime() {
  const saved = ref<InvitationLifetimeMinutes | null>(null)
  const draft = ref<InvitationLifetimeMinutes>(15)
  const busy = ref(false)
  const status = ref<'loadError' | 'saveError' | 'saved' | null>(null)

  async function request(minutes?: InvitationLifetimeMinutes) {
    if (busy.value) return
    busy.value = true
    status.value = null
    try {
      const response = await api(
        endpoint,
        minutes === undefined
          ? undefined
          : {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ minutes }),
            },
      )
      if (!response.ok) throw new Error()
      const setting: InvitationLifetimeSetting = await response.json()
      saved.value = draft.value = setting.minutes
      if (minutes !== undefined) status.value = 'saved'
    } catch {
      status.value = minutes === undefined ? 'loadError' : 'saveError'
    } finally {
      busy.value = false
    }
  }

  return { saved, draft, busy, status, load: () => request(), save: () => request(draft.value) }
}
