import { ref } from 'vue'

/**
 * The hidden `<input type="file">` dance: bind `input` to the element, call `open()` from a real
 * button, and receive the chosen file. The element is cleared after every pick so choosing the same
 * file twice in a row still fires a change event.
 */
export function useFilePicker(onSelect: (file: File) => void) {
  const input = ref<HTMLInputElement | null>(null)

  function open() {
    input.value?.click()
  }

  function handleChange(event: Event) {
    const element = event.target as HTMLInputElement
    const file = element.files?.[0]
    if (file) onSelect(file)
    element.value = ''
  }

  return { input, open, handleChange }
}
