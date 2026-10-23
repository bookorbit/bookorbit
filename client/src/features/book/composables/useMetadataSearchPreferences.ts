import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { useAuth } from '@/features/auth/composables/useAuth'

export function useMetadataSearchPreferences() {
  const { user } = useAuth()
  const storageKey = computed(() => `bookorbit:${user.value?.id ?? 'anonymous'}:metadata-search-auto-start`)
  const autoSearchOnOpen = useStorage(storageKey, false)

  return { autoSearchOnOpen }
}
