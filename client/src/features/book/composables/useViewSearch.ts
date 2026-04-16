import { ref, watch } from 'vue'

export function useViewSearch() {
  const searchQuery = ref('')
  const debouncedQuery = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(searchQuery, (val) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      debouncedQuery.value = val
    }, 300)
  })

  function clearSearch() {
    if (timer) clearTimeout(timer)
    searchQuery.value = ''
    debouncedQuery.value = ''
  }

  return { searchQuery, debouncedQuery, clearSearch }
}
