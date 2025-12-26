import { ref } from 'vue'
import type { FoliateRenderer, RelocateDetail } from './useFoliate'

export function useReaderProgress(bookId: number) {
  const cfi = ref<string | null>(null)
  const percentage = ref(0)
  const chapterTitle = ref('')
  const sectionIndex = ref(0)
  const totalSections = ref(0)
  const fraction = ref(0)

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function load() {
    const res = await fetch(`/api/books/${bookId}/progress`)
    if (!res.ok) return
    const data = await res.json()
    cfi.value = data.cfi ?? null
    percentage.value = data.percentage ?? 0
  }

  function onRelocate(detail: RelocateDetail) {
    cfi.value = detail?.cfi ?? null
    fraction.value = detail?.fraction ?? 0
    percentage.value = fraction.value * 100
    chapterTitle.value = detail?.tocItem?.label ?? ''
    sectionIndex.value = detail?.index ?? 0
    totalSections.value = detail?.total ?? 0

    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => save(), 2000)
  }

  async function save() {
    await fetch(`/api/books/${bookId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cfi: cfi.value, percentage: percentage.value }),
    })
  }

  function updateHeadsFeet(renderer: FoliateRenderer, theme: { fg: string; bg: string }) {
    if (!renderer || !renderer.heads?.length) return

    const columnCount = renderer.heads.length
    const isSingleColumn = columnCount === 1
    const DEFAULT_FONT_SIZE = '0.875rem'

    const buildStyle = () => {
      const base = `width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: ${DEFAULT_FONT_SIZE}; font-family: inherit;`
      return `${base} color: ${theme.fg};`
    }

    const style = buildStyle()

    renderer.heads.forEach((headEl: HTMLElement, index: number) => {
      if (!headEl) return
      headEl.style.visibility = 'visible'
      const div = document.createElement('div')
      div.style.cssText = style

      if (isSingleColumn) {
        const spacer = document.createElement('span')
        const chapterSpan = document.createElement('span')
        chapterSpan.textContent = chapterTitle.value || ''
        chapterSpan.style.textAlign = 'right'
        div.style.justifyContent = 'left'
        div.appendChild(spacer)
        div.appendChild(chapterSpan)
      } else {
        if (index === 0) {
          const chapterSpan = document.createElement('span')
          chapterSpan.textContent = chapterTitle.value || ''
          chapterSpan.style.textAlign = 'left'
          div.appendChild(chapterSpan)
        }
      }

      headEl.replaceChildren(div)
    })

    if (!renderer.feet?.length) return

    const pct = Math.round(fraction.value * 100)
    const totalCols = renderer.feet.length

    renderer.feet.forEach((footEl: HTMLElement, index: number) => {
      if (!footEl) return
      const div = document.createElement('div')
      div.style.cssText = style

      if (isSingleColumn) {
        const timeSpan = document.createElement('span')
        timeSpan.textContent = ''
        timeSpan.style.textAlign = 'left'

        const progressSpan = document.createElement('span')
        progressSpan.textContent = `${pct}%`
        progressSpan.style.textAlign = 'right'

        div.appendChild(timeSpan)
        div.appendChild(progressSpan)
      } else {
        if (index === 0) {
          const spacer = document.createElement('span')
          div.appendChild(spacer)
          div.appendChild(document.createElement('span'))
        } else if (index === totalCols - 1) {
          const spacer = document.createElement('span')
          div.appendChild(spacer)

          const progressSpan = document.createElement('span')
          progressSpan.textContent = `${pct}%`
          progressSpan.style.textAlign = 'right'
          div.appendChild(progressSpan)
        }
      }

      footEl.replaceChildren(div)
    })
  }

  return {
    cfi,
    percentage,
    chapterTitle,
    sectionIndex,
    totalSections,
    fraction,
    load,
    onRelocate,
    save,
    updateHeadsFeet,
  }
}
