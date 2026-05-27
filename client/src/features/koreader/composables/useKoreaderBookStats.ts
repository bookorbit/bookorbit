import { computed, ref, watch } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import { api } from '@/lib/api'
import type { KoreaderTabData } from '@bookorbit/types'

export type KoreaderBookStatsComposable = ReturnType<typeof useKoreaderBookStats>
export const KOREADER_BOOK_STATS_KEY = Symbol('koreaderBookStats') as InjectionKey<KoreaderBookStatsComposable>

const PAGE_SIZE = 20

export function useKoreaderBookStats(bookIdRef: Ref<number>) {
  const tabData = ref<KoreaderTabData | null>(null)
  const loading = ref(false)
  const page = ref(1)
  const pageSize = PAGE_SIZE

  const hasData = computed(() => tabData.value !== null)

  async function fetchTabData(targetPage = 1): Promise<void> {
    loading.value = true
    try {
      const res = await api(`/api/v1/koreader/books/${bookIdRef.value}/stats?page=${targetPage}&pageSize=${pageSize}`)
      if (!res.ok) {
        tabData.value = null
        return
      }
      const data = await res.json()
      tabData.value = data ?? null
    } catch {
      tabData.value = null
    } finally {
      loading.value = false
    }
  }

  function setPage(p: number) {
    page.value = p
    fetchTabData(p)
  }

  watch(
    bookIdRef,
    () => {
      page.value = 1
      tabData.value = null
      fetchTabData(1)
    },
    { immediate: true },
  )

  return { tabData, loading, page, pageSize, hasData, fetchTabData, setPage }
}
