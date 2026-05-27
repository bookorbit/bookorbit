import { onMounted, ref } from 'vue'

export function useKoreaderStatisticsQuery<T>(initialData: T, fetcher: () => Promise<T>) {
  const data = ref<T>(initialData) as { value: T }
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetcher()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  return { data, loading, error }
}
