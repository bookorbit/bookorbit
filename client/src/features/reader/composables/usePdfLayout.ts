import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { PageDim } from './usePdf'

export const PAGE_GAP = 16

export function usePdfLayout(
  scrollRef: Ref<HTMLElement | null>,
  totalPages: Ref<number>,
  effectiveDims: ComputedRef<PageDim[]>,
  scale: ComputedRef<number>,
  containerH: Ref<number>,
  spread: Ref<'none' | 'odd' | 'even'>,
) {
  const scrollMode = ref<'continuous' | 'page'>('continuous')
  const currentPage = ref(1)
  const pageInput = ref(1)

  // Each row is [pageNum] in single mode, or [pageNum, pageNum+1] in spread.
  const pageRows = computed<number[][]>(() => {
    const rows: number[][] = []
    const total = totalPages.value
    if (spread.value === 'none') {
      for (let i = 1; i <= total; i++) rows.push([i])
      return rows
    }
    // 'odd' spread: page 1 alone, then pairs [2,3], [4,5]...
    let i = 0
    if (spread.value === 'odd' && total >= 1) {
      rows.push([1])
      i = 2
    }
    while (i < total) {
      const a = i + 1
      const b = i + 2
      rows.push(b <= total ? [a, b] : [a])
      i += 2
    }
    return rows
  })

  // In page mode every row fills the viewport; in continuous mode rows have natural height.
  const rowHeights = computed(() => {
    if (scrollMode.value === 'page') return pageRows.value.map(() => containerH.value)
    return pageRows.value.map((row) => Math.max(...row.map((n) => Math.round((effectiveDims.value[n - 1]?.height ?? 842) * scale.value))))
  })

  watch(currentPage, (v) => {
    pageInput.value = v
  })

  function goToPage(n: number) {
    const el = scrollRef.value
    if (!el) return
    const clamped = Math.max(1, Math.min(n, totalPages.value))
    const rowIdx = pageRows.value.findIndex((row) => row.includes(clamped))
    if (rowIdx < 0) return
    let top = 0
    if (scrollMode.value === 'page') {
      top = rowIdx * containerH.value
    } else {
      for (let i = 0; i < rowIdx; i++) top += (rowHeights.value[i] ?? 0) + PAGE_GAP
    }
    el.scrollTo({ top, behavior: 'smooth' })
  }

  function onScroll() {
    const el = scrollRef.value
    if (!el || !rowHeights.value.length) return
    let rowIdx = 0
    if (scrollMode.value === 'page') {
      rowIdx = Math.round(el.scrollTop / containerH.value)
    } else {
      let offset = el.scrollTop
      for (let i = 0; i < rowHeights.value.length; i++) {
        const h = (rowHeights.value[i] ?? 0) + PAGE_GAP
        if (offset < h) {
          rowIdx = i
          break
        }
        offset -= h
        rowIdx = i + 1
      }
    }
    const row = pageRows.value[rowIdx]
    currentPage.value = row?.[0] ?? totalPages.value
  }

  return { scrollMode, currentPage, pageInput, pageRows, rowHeights, goToPage, onScroll }
}
