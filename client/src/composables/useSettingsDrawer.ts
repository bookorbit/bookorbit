import { ref } from 'vue'

const isOpen = ref(false)

export function useSettingsDrawer() {
  return {
    isOpen,
    open: () => (isOpen.value = true),
    close: () => (isOpen.value = false),
  }
}
