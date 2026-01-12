import { ref } from 'vue'

const isOpen = ref(false)
const isForced = ref(false)

export function useChangePasswordDialog() {
  return {
    isOpen,
    isForced,
    open: (forced = false) => {
      isForced.value = forced
      isOpen.value = true
    },
    close: () => {
      isOpen.value = false
      isForced.value = false
    },
  }
}
