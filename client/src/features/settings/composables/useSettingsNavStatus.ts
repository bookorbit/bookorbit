import { computed, watch, type Ref } from 'vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'

/**
 * Live signals the settings rail renders beside a row.
 *
 * Gated on `enabled` so a user whose permissions hide the Libraries row never fetches the library
 * list or joins the scan rooms. Both dependencies are module-level singletons, so an enabled rail
 * reuses whatever the rest of the app has already loaded and connected.
 */
export function useSettingsNavStatus(enabled: Ref<boolean>) {
  const { libraries, fetchLibraries } = useLibraries()
  const { subscribeLibrary, isScanning } = useScanProgress()

  watch(
    [enabled, libraries],
    ([isEnabled, list]) => {
      if (!isEnabled) return
      void fetchLibraries()
      for (const library of list) subscribeLibrary(library.id)
    },
    { immediate: true },
  )

  const isLibraryScanning = computed(() => enabled.value && libraries.value.some((library) => isScanning(library.id)))

  return { isLibraryScanning }
}
