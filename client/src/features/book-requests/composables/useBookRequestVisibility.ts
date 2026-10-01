import { computed, ref } from 'vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'
import { useNotifications } from '@/features/notifications/composables/useNotifications'

const saving = ref(false)

export function useBookRequestVisibility() {
  const { user } = useAuth()
  const showBookRequests = computed(() => user.value?.settings?.showBookRequests !== false)

  async function setShowBookRequests(show: boolean): Promise<boolean> {
    if (!user.value || saving.value) return false
    if (showBookRequests.value === show) return true

    const userId = user.value.id
    saving.value = true
    try {
      const response = await api('/api/v1/users/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { showBookRequests: show } }),
      })
      if (!response.ok || user.value?.id !== userId) return false
      user.value = { ...user.value, settings: { ...user.value.settings, showBookRequests: show } }
      const { fetchNotifications, fetchUnreadCount } = useNotifications()
      void Promise.all([fetchNotifications(true), fetchUnreadCount()])
      return true
    } catch {
      return false
    } finally {
      saving.value = false
    }
  }

  return { showBookRequests, saving, setShowBookRequests }
}
