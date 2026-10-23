import { ref, watch } from 'vue'
import { storage } from '@/services/storage'
import { DEFAULT_ENDPAPER, ENDPAPER_IDS, type Endpaper } from '../lib/endpapers'

const STORAGE_KEY = 'authEndpaper'

function stored(): Endpaper {
  const value = storage.get<unknown>(STORAGE_KEY, DEFAULT_ENDPAPER)
  return (ENDPAPER_IDS as readonly unknown[]).includes(value) ? (value as Endpaper) : DEFAULT_ENDPAPER
}

// A per-browser choice, like the other appearance controls shown before sign-in.
const endpaper = ref<Endpaper>(stored())
watch(endpaper, (value) => storage.set(STORAGE_KEY, value))

export function useEndpaper() {
  function setEndpaper(value: Endpaper) {
    endpaper.value = value
  }

  return { endpaper, setEndpaper }
}
