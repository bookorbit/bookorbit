import { ref } from 'vue'

/** One palette for the whole shell: the sidebar row, the phone search buttons and ⌘K all open the same instance. */
const isOpen = ref(false)

export function useCommandPalette() {
  function openPalette() {
    isOpen.value = true
  }

  function closePalette() {
    isOpen.value = false
  }

  return { isOpen, openPalette, closePalette }
}
