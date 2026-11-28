import { computed, ref, watch, type Ref } from 'vue'
import type { BookDockFilesPage } from '@bookorbit/types'
import { fetchBookDockFiles } from '@/features/book-dock/api/book-dock.api'

const PAGE_SIZE = 20

export function usePaletteDockSearch(query: Ref<string>) {
  const page = ref(1)
  const results = ref<BookDockFilesPage | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  const pageCount = computed(() => Math.ceil((results.value?.total ?? 0) / PAGE_SIZE))

  watch(
    query,
    () => {
      page.value = 1
    },
    { flush: 'sync' },
  )
  watch([query, page], ([search, currentPage], [previousSearch], onCleanup) => {
    results.value = null
    failed.value = false
    loading.value = Boolean(search)
    if (!search) return

    const controller = new AbortController()
    const timer = setTimeout(
      async () => {
        const params = new URLSearchParams({ search, page: String(currentPage), limit: String(PAGE_SIZE), sort: 'fileName', order: 'asc' })
        try {
          const data = await fetchBookDockFiles(params, controller.signal)
          if (!controller.signal.aborted) results.value = data
        } catch {
          if (!controller.signal.aborted) failed.value = true
        } finally {
          if (!controller.signal.aborted) loading.value = false
        }
      },
      search === previousSearch ? 0 : 250,
    )

    onCleanup(() => {
      clearTimeout(timer)
      controller.abort()
    })
  })

  return { results, page, pageCount, failed, loading }
}
