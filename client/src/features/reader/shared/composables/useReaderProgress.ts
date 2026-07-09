import { onUnmounted, ref, unref, type MaybeRef, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { FoliateRenderer, RelocateDetail } from '../../epub/composables/useFoliate'

export type FooterDisplayMode = 0 | 1 | 2

export interface ReaderProgressOptions {
  trackingEnabled?: MaybeRef<boolean>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeFraction(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed === null ? null : clamp(parsed, 0, 1)
}

function normalizePercentage(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed === null ? null : clamp(parsed, 0, 100)
}

function normalizeNullablePercentage(value: unknown): number | null {
  return normalizePercentage(value)
}

function normalizePageNumber(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed === null || parsed < 0 ? null : parsed
}

export function formatTimeRemaining(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const remainder = Math.round(minutes % 60)
  if (remainder === 0) return `${hours} hr`
  return `${hours} hr ${remainder} min`
}

export function useReaderProgress(
  bookId: number,
  fileId: number,
  elapsedMinutes: Ref<number>,
  initialFooterMode: FooterDisplayMode = 0,
  options: ReaderProgressOptions = {},
) {
  const cfi = ref<string | null>(null)
  const pageNumber = ref<number | null>(null)
  const percentage = ref(0)
  const koboLocationSource = ref<string | null>(null)
  const koboLocationType = ref<string | null>(null)
  const koboLocationValue = ref<string | null>(null)
  const koboContentSourceProgressPercent = ref<number | null>(null)
  const koreaderProgress = ref<string | null>(null)
  const chapterTitle = ref('')
  const sectionIndex = ref(0)
  const totalSections = ref(0)
  const fraction = ref(0)

  const locationCurrent = ref(0)
  const locationTotal = ref(0)
  const sectionCurrent = ref(0)
  const sectionTotal = ref(0)
  const timeSection = ref(0)
  const timeTotal = ref(0)

  const footerMode = ref<FooterDisplayMode>(initialFooterMode)
  const trackingEnabled = options.trackingEnabled ?? true

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let lastValidPercentage = 0

  onUnmounted(() => {
    if (saveTimer) clearTimeout(saveTimer)
  })

  function updatePercentage(value: unknown, fallback = lastValidPercentage): number {
    const normalized = normalizePercentage(value) ?? fallback
    percentage.value = normalized
    lastValidPercentage = normalized
    return normalized
  }

  async function load() {
    if (!unref(trackingEnabled)) return
    const res = await api(`/api/v1/books/files/${fileId}/progress`)
    if (!res.ok) return
    const data = await res.json()
    cfi.value = normalizeString(data.cfi)
    pageNumber.value = normalizePageNumber(data.pageNumber)
    updatePercentage(data.percentage, 0)
    koboLocationSource.value = normalizeString(data.koboLocationSource)
    koboLocationType.value = normalizeString(data.koboLocationType)
    koboLocationValue.value = normalizeString(data.koboLocationValue)
    koboContentSourceProgressPercent.value = normalizeNullablePercentage(data.koboContentSourceProgressPercent)
    koreaderProgress.value = normalizeString(data.koreaderProgress)
  }

  function onRelocate(detail: RelocateDetail) {
    cfi.value = normalizeString(detail?.cfi)
    const relocatedFraction = normalizeFraction(detail?.fraction)
    if (relocatedFraction !== null) {
      fraction.value = relocatedFraction
      updatePercentage(relocatedFraction * 100)
    }
    koboLocationSource.value = normalizeString(detail?.source)
    koboLocationValue.value = normalizeString(detail?.koboLocationValue)
    koboLocationType.value = koboLocationValue.value ? (normalizeString(detail?.koboLocationType) ?? 'KoboSpan') : null
    koboContentSourceProgressPercent.value = normalizeNullablePercentage(detail?.contentSourceProgressPercent)
    koreaderProgress.value = normalizeString(detail?.koreaderProgress)
    const hasSaveableLocation =
      relocatedFraction !== null || cfi.value !== null || koboLocationValue.value !== null || koreaderProgress.value !== null
    chapterTitle.value = detail?.tocItem?.label ?? ''
    sectionIndex.value = detail?.section?.current ?? detail?.index ?? 0
    totalSections.value = detail?.section?.total ?? detail?.total ?? 0

    locationCurrent.value = detail?.location?.current ?? 0
    locationTotal.value = detail?.location?.total ?? 0
    sectionCurrent.value = detail?.section?.current ?? 0
    sectionTotal.value = detail?.section?.total ?? 0
    timeSection.value = detail?.time?.section ?? 0
    timeTotal.value = detail?.time?.total ?? 0

    if (saveTimer) clearTimeout(saveTimer)
    if (!unref(trackingEnabled) || !hasSaveableLocation) return
    saveTimer = setTimeout(() => save(), 2000)
  }

  async function save() {
    if (!unref(trackingEnabled)) return
    const safePercentage = updatePercentage(percentage.value)
    await api(`/api/v1/books/files/${fileId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cfi: cfi.value,
        pageNumber: normalizePageNumber(pageNumber.value),
        percentage: safePercentage,
        koboLocationSource: koboLocationSource.value,
        koboLocationType: koboLocationType.value,
        koboLocationValue: koboLocationValue.value,
        koboContentSourceProgressPercent: normalizeNullablePercentage(koboContentSourceProgressPercent.value),
        koreaderProgress: koreaderProgress.value,
      }),
    })
  }

  function cycleFooterMode() {
    footerMode.value = ((footerMode.value + 1) % 3) as FooterDisplayMode
  }

  function buildFooterContent(mode: FooterDisplayMode): { left: string; right: string } {
    const pct = Math.round(fraction.value * 100)

    switch (mode) {
      case 0: {
        const left = locationTotal.value > 0 ? `Page ${locationCurrent.value + 1} of ${locationTotal.value}` : ''
        return { left, right: `${pct}%` }
      }
      case 1: {
        const elapsed = elapsedMinutes.value
        const left = elapsed > 0 ? `Reading: ${elapsed}m` : 'Reading: < 1m'
        const right = timeTotal.value > 0 ? `${formatTimeRemaining(timeTotal.value)} left` : `${pct}%`
        return { left, right }
      }
      case 2: {
        const left = sectionTotal.value > 0 ? `Ch. ${sectionCurrent.value + 1} of ${sectionTotal.value}` : ''
        const right = timeSection.value > 0 ? `${formatTimeRemaining(timeSection.value)} left in ch.` : `${pct}%`
        return { left, right }
      }
    }
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

    const { left, right } = buildFooterContent(footerMode.value)
    const totalCols = renderer.feet.length

    renderer.feet.forEach((footEl: HTMLElement, index: number) => {
      if (!footEl) return
      const div = document.createElement('div')
      div.style.cssText = style
      div.style.cursor = 'pointer'
      div.addEventListener('click', (e) => {
        e.stopPropagation()
        cycleFooterMode()
        updateHeadsFeet(renderer, theme)
      })

      if (isSingleColumn) {
        const leftSpan = document.createElement('span')
        leftSpan.textContent = left
        leftSpan.style.textAlign = 'left'

        const rightSpan = document.createElement('span')
        rightSpan.textContent = right
        rightSpan.style.textAlign = 'right'

        div.appendChild(leftSpan)
        div.appendChild(rightSpan)
      } else {
        if (index === 0) {
          const leftSpan = document.createElement('span')
          leftSpan.textContent = left
          leftSpan.style.textAlign = 'left'
          div.appendChild(leftSpan)
          div.appendChild(document.createElement('span'))
        } else if (index === totalCols - 1) {
          const spacer = document.createElement('span')
          div.appendChild(spacer)

          const rightSpan = document.createElement('span')
          rightSpan.textContent = right
          rightSpan.style.textAlign = 'right'
          div.appendChild(rightSpan)
        }
      }

      footEl.replaceChildren(div)
    })
  }

  return {
    cfi,
    pageNumber,
    percentage,
    koboLocationSource,
    koboLocationType,
    koboLocationValue,
    koboContentSourceProgressPercent,
    koreaderProgress,
    chapterTitle,
    sectionIndex,
    totalSections,
    fraction,
    locationCurrent,
    locationTotal,
    sectionCurrent,
    sectionTotal,
    timeSection,
    timeTotal,
    footerMode,
    load,
    onRelocate,
    save,
    cycleFooterMode,
    updateHeadsFeet,
  }
}
