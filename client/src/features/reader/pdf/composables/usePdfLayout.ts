import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { PageDim } from './usePdf'

export const PAGE_GAP = 16

export type ScrollMode = 'vertical' | 'horizontal' | 'wrapped' | 'page'

export function usePdfLayout(
  scrollRef: Ref<HTMLElement | null>,
  totalPages: Ref<number>,
  effectiveDims: ComputedRef<PageDim[]>,
  scale: ComputedRef<number>,
  containerH: Ref<number>,
  spread: Ref<'none' | 'odd' | 'even'>,
) {
  const scrollMode = ref<ScrollMode>('vertical')
  const currentPage = ref(1)
  const pageInput = ref(1)

  const pageRows = computed<number[][]>(() => {
    const rows: number[][] = []
    const total = totalPages.value
    if (spread.value === 'none') {
      for (let i = 1; i <= total; i++) rows.push([i])
      return rows
    }
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

  const rowHeights = computed(() => {
    if (scrollMode.value === 'page') return pageRows.value.map(() => containerH.value)
    return pageRows.value.map((row) => Math.max(...row.map((n) => Math.round((effectiveDims.value[n - 1]?.height ?? 842) * scale.value))))
  })

  // Cumulative horizontal offset per page for horizontal scroll mode
  const pageLeftOffsets = computed(() => {
    const offsets: number[] = []
    let x = PAGE_GAP
    for (let i = 0; i < totalPages.value; i++) {
      offsets.push(x)
      x += Math.round((effectiveDims.value[i]?.width ?? 595) * scale.value) + PAGE_GAP
    }
    return offsets
  })

  watch(currentPage, (v) => {
    pageInput.value = v
  })

  function goToPage(n: number, behavior: ScrollBehavior = 'smooth') {
    const el = scrollRef.value
    if (!el) return
    const clamped = Math.max(1, Math.min(n, totalPages.value))

    if (scrollMode.value === 'horizontal') {
      const left = pageLeftOffsets.value[clamped - 1] ?? 0
      el.scrollTo({ left, behavior })
      return
    }

    const rowIdx = pageRows.value.findIndex((row) => row.includes(clamped))
    if (rowIdx < 0) return
    let top = 0
    if (scrollMode.value === 'page') {
      top = rowIdx * containerH.value
    } else {
      for (let i = 0; i < rowIdx; i++) top += (rowHeights.value[i] ?? 0) + PAGE_GAP
      top += PAGE_GAP // initial top padding
    }
    el.scrollTo({ top, behavior })
  }

  function onScroll() {
    const el = scrollRef.value
    if (!el) return

    if (scrollMode.value === 'horizontal') {
      const scrollX = el.scrollLeft
      const offsets = pageLeftOffsets.value
      let page = 1
      for (let i = 0; i < offsets.length; i++) {
        if (scrollX >= (offsets[i] ?? 0) - PAGE_GAP / 2) page = i + 1
        else break
      }
      currentPage.value = page
      return
    }

    if (!rowHeights.value.length) return
    let rowIdx = 0
    if (scrollMode.value === 'page') {
      rowIdx = Math.round(el.scrollTop / containerH.value)
    } else {
      let offset = el.scrollTop - PAGE_GAP
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

  return { scrollMode, currentPage, pageInput, pageRows, rowHeights, pageLeftOffsets, goToPage, onScroll }
}
