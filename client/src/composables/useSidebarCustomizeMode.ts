import { ref } from 'vue'

/** One edit mode for the whole shell: section menus, ⌘K and the sidebar all read and flip this. */
const isCustomizing = ref(false)

export function useSidebarCustomizeMode() {
  function startCustomizing() {
    isCustomizing.value = true
  }

  function stopCustomizing() {
    isCustomizing.value = false
  }

  return { isCustomizing, startCustomizing, stopCustomizing }
}
