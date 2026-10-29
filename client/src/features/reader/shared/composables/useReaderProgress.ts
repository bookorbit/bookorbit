import { computed, onUnmounted, ref, unref, type MaybeRef, type Ref } from 'vue'
import { fetchFileProgress, saveReadingProgress } from '@/lib/reading-progress'
import type { FoliateRenderer, RelocateDetail } from '../../epub/composables/useFoliate'

export type FooterDisplayMode = 0 | 1 | 2

export interface ReaderProgressOptions {
  trackingEnabled?: MaybeRef<boolean>
  /** Where a narrated sentence starts in the narration, in seconds, or null when it cannot be placed. */
  narrationSeconds?: (fragment: string, sectionIndex: number | null) => Promise<number | null>
  /** Told when a narration save was held back because another device sent the narration well behind it. */
  onNarrationMovedBack?: (position: NewerPosition) => void
}

/** How far behind the sentence being saved another device must send narration for the save to wait. */
const NARRATION_MOVED_BACK_SECONDS = 30

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

/** A position another device saved while this reader was open: the server's row, and when it moved. */
export interface NewerPosition {
  percentage: number
  stamp: number
  data: Record<string, unknown>
}

function serverTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** When the row's positions last moved, on the server's clock; the row's own stamp before the split. */
function positionStamp(data: Record<string, unknown>): number {
  const text = serverTime(data.textUpdatedAt)
  const narration = serverTime(data.narrationUpdatedAt)
  if (text === null && narration === null) return serverTime(data.updatedAt) ?? 0
  return Math.max(text ?? 0, narration ?? 0)
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
  const positionSeconds = ref<number | null>(null)
  const mediaOverlayFragment = ref<string | null>(null)
  const mediaOverlaySectionIndex = ref<number | null>(null)
  // Which of the file's two positions the pending save moved. They share one record, and the
  // server needs telling so a narration position cannot drag the text one backwards to meet it.
  const pendingSource = ref<'text' | 'narration'>('text')
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
  let saving = false
  let hadSavedPosition = false
  let lastValidPercentage = 0
  // The newest write to the row this reader has read or made, on the server's clock. Anything
  // newer came from another device.
  let knownServerStamp = 0
  // The narration marker that write left on the row; null after a page turn, which the server may
  // have carried narration along with. `Date` counts whole seconds, so a row inside that second
  // holding another marker was written by another device just after this one.
  let knownNarrationFragment: string | null = null
  let adoptingNewerPosition = false

  onUnmounted(() => {
    if (saveTimer) clearTimeout(saveTimer)
  })

  function updatePercentage(value: unknown, fallback = lastValidPercentage): number {
    const normalized = normalizePercentage(value) ?? fallback
    percentage.value = normalized
    lastValidPercentage = normalized
    return normalized
  }

  const hasMediaOverlayProgress = computed(
    () => (!!mediaOverlayFragment.value && mediaOverlaySectionIndex.value !== null) || (positionSeconds.value != null && positionSeconds.value > 0),
  )

  async function load() {
    if (!unref(trackingEnabled)) return
    const data = await fetchFileProgress(fileId)
    if (!data) return
    hadSavedPosition =
      normalizeString(data.cfi) !== null ||
      normalizeString(data.koboLocationValue) !== null ||
      normalizeString(data.koreaderProgress) !== null ||
      (typeof data.percentage === 'number' && data.percentage > 0)
    applyServerProgress(data)
    knownServerStamp = positionStamp(data)
    knownNarrationFragment = normalizeString(data.mediaOverlayFragment)
  }

  function applyServerProgress(data: Record<string, unknown>) {
    cfi.value = normalizeString(data.cfi)
    pageNumber.value = normalizePageNumber(data.pageNumber)
    updatePercentage(data.percentage, 0)
    koboLocationSource.value = normalizeString(data.koboLocationSource)
    koboLocationType.value = normalizeString(data.koboLocationType)
    koboLocationValue.value = normalizeString(data.koboLocationValue)
    koboContentSourceProgressPercent.value = normalizeNullablePercentage(data.koboContentSourceProgressPercent)
    koreaderProgress.value = normalizeString(data.koreaderProgress)
    positionSeconds.value = typeof data.positionSeconds === 'number' ? data.positionSeconds : null
    mediaOverlayFragment.value = typeof data.mediaOverlayFragment === 'string' ? data.mediaOverlayFragment : null
    mediaOverlaySectionIndex.value = typeof data.mediaOverlaySectionIndex === 'number' ? data.mediaOverlaySectionIndex : null
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    if (!unref(trackingEnabled)) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void save()
    }, 2000)
  }

  function onRelocate(detail: RelocateDetail, source: 'text' | 'narration' = 'text') {
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

    if (!hasSaveableLocation) {
      if (saveTimer) clearTimeout(saveTimer)
      return
    }
    // Opening at a position a device saved, or reflowing the page, moves no reader. Saving the
    // page start the view lands on would pull every other device back to it (#1136). A reflow
    // under paused narration would also restamp its old sentence as just narrated.
    const repositionOnly = (detail?.restoring === true && hadSavedPosition) || adoptingNewerPosition || detail?.reason === 'anchor'
    if (repositionOnly) return
    pendingSource.value = source
    scheduleSave()
  }

  function setMediaOverlayProgress(fragment: string, section: number, seconds: number | null = null) {
    mediaOverlayFragment.value = fragment
    mediaOverlaySectionIndex.value = section
    positionSeconds.value = seconds
    pendingSource.value = 'narration'
    scheduleSave()
  }

  async function save() {
    if (!unref(trackingEnabled)) return
    saving = true
    try {
      if (pendingSource.value === 'narration') {
        const movedBack = await narrationMovedBack()
        if (movedBack) {
          options.onNarrationMovedBack?.(movedBack)
          return
        }
      }
      const safePercentage = updatePercentage(percentage.value)
      const savedFragment = pendingSource.value === 'narration' ? mediaOverlayFragment.value : null
      noteOwnWrite(await postProgress(safePercentage), savedFragment)
    } finally {
      saving = false
    }
  }

  /**
   * The server's position when another device sent narration well behind the sentence about to be
   * saved, a reset or a return to an earlier passage, since this reader last read or wrote it.
   * Read-aloud saves every few sentences, so a reset made elsewhere while it played was overwritten
   * by the next one and nobody was asked. A move ahead is not held: this narration is the newer place.
   */
  async function narrationMovedBack(): Promise<NewerPosition | null> {
    const secondsOf = options.narrationSeconds
    const fragment = mediaOverlayFragment.value
    if (!secondsOf || !fragment) return null
    const data = await fetchFileProgress(fileId).catch(() => null)
    if (!data) return null
    const stamp = positionStamp(data)
    const serverFragment = normalizeString(data.mediaOverlayFragment)
    if (!serverFragment || serverFragment === fragment) return null
    if (stamp <= knownServerStamp && (knownNarrationFragment === null || serverFragment === knownNarrationFragment)) return null
    const serverSection = typeof data.mediaOverlaySectionIndex === 'number' ? data.mediaOverlaySectionIndex : null
    const [serverAt, savingAt] = await Promise.all([secondsOf(serverFragment, serverSection), secondsOf(fragment, mediaOverlaySectionIndex.value)])
    if (serverAt === null || savingAt === null || serverAt >= savingAt - NARRATION_MOVED_BACK_SECONDS) return null
    return { percentage: normalizePercentage(data.percentage) ?? 0, stamp, data }
  }

  /**
   * The write lands with a server stamp no later than the response's `Date`, which counts whole
   * seconds, so the next second covers it.
   */
  function noteOwnWrite(res: Response | undefined, narrationFragment: string | null) {
    const date = serverTime(res?.headers?.get?.('Date') ?? null)
    if (date === null) return
    knownServerStamp = Math.max(knownServerStamp, date + 1000)
    knownNarrationFragment = narrationFragment
  }

  function postProgress(safePercentage: number) {
    return saveReadingProgress({
      fileId,
      kind: pendingSource.value,
      percentage: safePercentage,
      text: { cfi: cfi.value, page: normalizePageNumber(pageNumber.value) },
      kobo: {
        source: koboLocationSource.value,
        type: koboLocationType.value,
        value: koboLocationValue.value,
        contentPercent: normalizeNullablePercentage(koboContentSourceProgressPercent.value),
      },
      koreader: koreaderProgress.value,
      // Left out of a page turn, which says nothing about narration: sent along, the marker this
      // reader read when it opened went back over a newer one another device had saved since.
      ...(pendingSource.value === 'narration'
        ? {
            narration: {
              seconds: positionSeconds.value,
              fragment: mediaOverlayFragment.value,
              sectionIndex: mediaOverlaySectionIndex.value,
            },
          }
        : {}),
    })
  }

  /**
   * The server's position when another device moved it since this reader last read or wrote it,
   * so a reader left open can offer it instead of saving its old page over it. Nothing is asked
   * while a save is waiting: this reader is about to speak for the position itself.
   */
  async function checkForNewerPosition(): Promise<NewerPosition | null> {
    if (!unref(trackingEnabled) || saveTimer || saving) return null
    const data = await fetchFileProgress(fileId)
    if (!data || saveTimer || saving) return null
    const stamp = positionStamp(data)
    if (stamp <= knownServerStamp) return null
    if (normalizeString(data.cfi) === cfi.value && normalizeString(data.mediaOverlayFragment) === mediaOverlayFragment.value) {
      knownServerStamp = stamp
      knownNarrationFragment = mediaOverlayFragment.value
      return null
    }
    return { percentage: normalizePercentage(data.percentage) ?? 0, stamp, data }
  }

  /** Takes the newer position, both text and narration, and lets `navigate` go there without saving it back. */
  async function adoptNewerPosition(position: NewerPosition, navigate: () => Promise<void>) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    applyServerProgress(position.data)
    knownServerStamp = Math.max(knownServerStamp, position.stamp)
    knownNarrationFragment = normalizeString(position.data.mediaOverlayFragment)
    adoptingNewerPosition = true
    try {
      await navigate()
    } finally {
      adoptingNewerPosition = false
    }
  }

  /** Keeps this reader's page over the one it turned down, and saves it so other devices follow. */
  async function keepCurrentPosition(position: NewerPosition, source: 'text' | 'narration' = 'text') {
    knownServerStamp = Math.max(knownServerStamp, position.stamp)
    knownNarrationFragment = normalizeString(position.data.mediaOverlayFragment)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    pendingSource.value = source
    await save()
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
    positionSeconds,
    mediaOverlayFragment,
    mediaOverlaySectionIndex,
    hasMediaOverlayProgress,
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
    checkForNewerPosition,
    adoptNewerPosition,
    keepCurrentPosition,
    onRelocate,
    setMediaOverlayProgress,
    save,
    cycleFooterMode,
    updateHeadsFeet,
  }
}
