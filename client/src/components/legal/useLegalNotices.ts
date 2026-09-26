import { ref } from 'vue'

const open = ref(false)

export function useLegalNotices() {
  function openLegalNotices() {
    open.value = true
  }

  function closeLegalNotices() {
    open.value = false
  }

  function handleOpenChange(value: boolean) {
    open.value = value
  }

  return { open, openLegalNotices, closeLegalNotices, handleOpenChange }
}
