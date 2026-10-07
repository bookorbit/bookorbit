import { computed, ref } from 'vue'
import { normalizeMetadataReminderFields, type MetadataReminderField } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'

const pending = ref<{ userId: number; fields: MetadataReminderField[] } | null>(null)

export function useMetadataReminders() {
  const { user } = useAuth()
  const fields = computed(() => {
    const pendingSave = pending.value
    if (pendingSave && pendingSave.userId === user.value?.id) return pendingSave.fields
    return normalizeMetadataReminderFields(user.value?.settings?.metadataReminderPreferences?.fields)
  })
  const saving = computed(() => pending.value !== null)

  async function saveFields(next: readonly MetadataReminderField[]): Promise<boolean> {
    if (!user.value || saving.value) return false
    const userId = user.value.id
    const normalized = normalizeMetadataReminderFields(next)
    pending.value = { userId, fields: normalized }
    try {
      const response = await api('/api/v1/users/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { metadataReminderPreferences: { fields: normalized } } }),
      })
      if (!response.ok || user.value?.id !== userId) return false
      user.value = {
        ...user.value,
        settings: { ...user.value.settings, metadataReminderPreferences: { fields: normalized } },
      }
      return true
    } catch {
      return false
    } finally {
      pending.value = null
    }
  }

  return { fields, saving, saveFields }
}
