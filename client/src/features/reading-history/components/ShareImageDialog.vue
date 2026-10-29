<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy, Download, Image, Loader2, X } from '@lucide/vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { toast } from 'vue-sonner'
import { READING_HISTORY_PAGE_SIZE_MAX, type ReadingHistoryItem, type ReadingHistorySummary } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { canCopyImages, copyImageToClipboard } from '@/lib/clipboard'
import { readCssColor, toLegacyColor } from '@/lib/css-color'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { fetchReadingHistoryPage, fetchReadingHistorySummary } from '../api/reading-history.api'
import { formatHours, formatMonthName } from '../lib/history-format'
import { canvasToBlob, saveBlob } from '../lib/history-export'
import { POSTER_SIZES, drawPoster, type PosterLook, type PosterShape, type PosterTile } from '../lib/share-poster'

type SharePeriod = 'year' | 'quarter' | 'month'

const props = defineProps<{ year: number; quarter: number | null }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { user } = useAuth()
const { coverUrl } = useCoverVersions()

/** A year of finishes is a few hundred covers at most; this only bounds a runaway history. */
const MAX_READS = 2000

const shape = ref<PosterShape>('square')
const look = ref<PosterLook>('dark')
const period = ref<SharePeriod>('year')
const showTitles = ref(false)
const showRereads = ref(true)
const showRatings = ref(false)

const reads = shallowRef<ReadingHistoryItem[]>([])
const summary = shallowRef<ReadingHistorySummary | null>(null)
const loading = ref(false)
const failed = ref(false)
const busy = ref<'copy' | 'save' | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const images = new Map<string, HTMLImageElement | null>()
const imageVersion = ref(0)

const months = computed(() => [...new Set(reads.value.map((item) => Number(item.endedOn?.slice(5, 7))).filter(Boolean))])
const latestMonth = computed(() => Math.max(1, ...months.value))
const quarter = computed(() => props.quarter ?? Math.ceil(latestMonth.value / 3))

const periodReads = computed(() =>
  reads.value.filter((item) => {
    const month = Number(item.endedOn?.slice(5, 7))
    if (period.value === 'month') return month === latestMonth.value
    if (period.value === 'quarter') return Math.ceil(month / 3) === quarter.value
    return true
  }),
)
const periodMonths = computed(() => {
  if (period.value === 'month') return [latestMonth.value]
  if (period.value === 'quarter') return [quarter.value * 3 - 2, quarter.value * 3 - 1, quarter.value * 3]
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
})
const periodLabel = computed(() => {
  if (period.value === 'month') return t('readingHistory.share.monthYear', { month: formatMonthName(latestMonth.value, 'long'), year: props.year })
  if (period.value === 'quarter') return t('readingHistory.period.quarterYear', { quarter: quarter.value, year: props.year })
  return String(props.year)
})

/** Each book once, most recent finish first, counting how often it was finished in the period. */
const books = computed(() => {
  const byBook = new Map<string, { item: ReadingHistoryItem; count: number }>()
  for (const item of periodReads.value) {
    const key = item.bookId === null ? `read-${item.id}` : String(item.bookId)
    const entry = byBook.get(key)
    if (entry) entry.count++
    else byBook.set(key, { item, count: 1 })
  }
  return [...byBook.entries()].map(([key, entry]) => ({ key, ...entry }))
})

const stats = computed(() => {
  const seconds = (summary.value?.months ?? [])
    .filter((month) => periodMonths.value.includes(month.month))
    .reduce((sum, month) => sum + month.seconds, 0)
  const pages = periodReads.value.reduce((sum, item) => sum + (item.pageCount ?? 0), 0)
  return [
    { value: formatNumber(periodReads.value.length), label: t('readingHistory.share.poster.reads', { count: periodReads.value.length }) },
    { value: formatNumber(books.value.length), label: t('readingHistory.share.poster.books', { count: books.value.length }) },
    { value: formatNumber(formatHours(seconds)), label: t('readingHistory.share.poster.hours', { count: formatHours(seconds) }) },
    { value: formatNumber(pages), label: t('readingHistory.share.poster.pages', { count: pages }) },
  ]
})

const facts = computed(() => {
  const out: { label: string; value: string; meta: string }[] = []
  if (period.value !== 'month') {
    const perMonth = new Map<number, number>()
    for (const item of periodReads.value) {
      const month = Number(item.endedOn?.slice(5, 7))
      perMonth.set(month, (perMonth.get(month) ?? 0) + 1)
    }
    const busiest = [...perMonth.entries()].sort((a, b) => b[1] - a[1])[0]
    if (busiest)
      out.push({
        label: t('readingHistory.share.poster.busiestMonth'),
        value: formatMonthName(busiest[0], 'long'),
        meta: t('readingHistory.month.reads', { count: busiest[1] }),
      })
  }
  const longest = [...periodReads.value].filter((item) => item.pageCount).sort((a, b) => (b.pageCount ?? 0) - (a.pageCount ?? 0))[0]
  if (longest)
    out.push({
      label: t('readingHistory.rail.longestBook'),
      value: longest.title ?? t('readingHistory.row.untitled'),
      meta: t('readingHistory.rail.pages', { count: longest.pageCount ?? 0 }),
    })
  const reread = [...books.value].sort((a, b) => b.count - a.count)[0]
  if (showRereads.value && reread && reread.count > 1)
    out.push({
      label: t('readingHistory.rail.mostReread'),
      value: reread.item.title ?? t('readingHistory.row.untitled'),
      meta: t('readingHistory.rail.times', { count: reread.count }),
    })
  return out
})

const eyebrow = computed(() => {
  const name = user.value?.name?.trim() || user.value?.username || ''
  if (period.value === 'year') return t('readingHistory.share.poster.eyebrowYear', { name })
  return t('readingHistory.share.poster.eyebrowPeriod', { name, period: periodLabel.value })
})
const big = computed(() => {
  if (period.value === 'month') return formatMonthName(latestMonth.value, 'short')
  if (period.value === 'quarter') return t('readingHistory.period.quarter', { quarter: quarter.value })
  return String(props.year)
})
const size = computed(() => POSTER_SIZES[shape.value])
const accessibleSummary = computed(() => t('readingHistory.share.previewLabel', { period: periodLabel.value, count: periodReads.value.length }))

const canCopy = canCopyImages()

const SHAPES: PosterShape[] = ['square', 'story', 'wide']
const LOOKS: PosterLook[] = ['dark', 'light']
const PERIODS: SharePeriod[] = ['year', 'quarter', 'month']

async function load() {
  loading.value = true
  failed.value = false
  try {
    const params = { year: props.year, quarter: null, outcomes: ['completed' as const], search: '', bookId: null, sort: 'newest' as const }
    const [first, yearSummary] = await Promise.all([
      fetchReadingHistoryPage(params, 0, READING_HISTORY_PAGE_SIZE_MAX),
      fetchReadingHistorySummary({ year: props.year, quarter: null }),
    ])
    const all = [...first.items]
    for (let offset = all.length; offset < Math.min(first.total, MAX_READS); offset += READING_HISTORY_PAGE_SIZE_MAX) {
      all.push(...(await fetchReadingHistoryPage(params, offset, READING_HISTORY_PAGE_SIZE_MAX)).items)
    }
    reads.value = all
    summary.value = yearSummary
    period.value = props.quarter ? 'quarter' : 'year'
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

function loadImage(key: string, item: ReadingHistoryItem) {
  if (images.has(key) || item.bookId === null) return
  images.set(key, null)
  const image = new window.Image()
  image.decoding = 'async'
  image.onload = () => {
    images.set(key, image)
    imageVersion.value++
  }
  image.src = coverUrl(item.bookId, 'thumbnail', item.coverVersion)
}

function fontFamily(className: string): string {
  const probe = document.createElement('span')
  probe.className = className
  document.body.append(probe)
  const family = getComputedStyle(probe).fontFamily
  probe.remove()
  return family
}

let frame = 0
function scheduleDraw() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => void draw())
}

async function draw() {
  const target = canvas.value
  if (!target || loading.value || failed.value) return
  const sans = fontFamily('font-sans')
  const serif = fontFamily('font-serif')
  await Promise.all([document.fonts.load(`800 200px ${sans}`), document.fonts.load(`600 32px ${serif}`)]).catch(() => undefined)
  const tiles: PosterTile[] = books.value.map(({ key, item, count }) => ({
    image: images.get(key) ?? null,
    title: item.title ?? t('readingHistory.row.untitled'),
    count,
    rating: item.rating,
  }))
  drawPoster(
    target,
    shape.value,
    {
      eyebrow: eyebrow.value,
      big: big.value,
      stats: stats.value,
      tiles,
      facts: facts.value,
      moreLabel: (count) => t('readingHistory.share.poster.more', { count }),
      brand: ['Book', 'Orbit'],
    },
    {
      look: look.value,
      accent: toLegacyColor(readCssColor('--primary')),
      accentInk: toLegacyColor(readCssColor('--primary-foreground')),
      sans,
      serif,
      showTitles: showTitles.value,
      showRereads: showRereads.value,
      showRatings: showRatings.value,
    },
  )
}

watch(open, (isOpen) => {
  if (isOpen) void load()
})
watch(books, (list) => {
  for (const { key, item } of list) loadImage(key, item)
})
watch([books, shape, look, showTitles, showRereads, showRatings, imageVersion, canvas, loading], () => void nextTick(scheduleDraw))

function posterBlob(): Promise<Blob> {
  return canvasToBlob(canvas.value, 'image/png')
}

function fileName() {
  return `reading-${periodLabel.value.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-')}.png`
}

async function handleSave() {
  busy.value = 'save'
  try {
    saveBlob(await posterBlob(), fileName())
    toast.success(t('readingHistory.share.saved'))
  } catch {
    toast.error(t('readingHistory.share.saveFailed'))
  } finally {
    busy.value = null
  }
}

async function handleCopy() {
  busy.value = 'copy'
  try {
    if (await copyImageToClipboard(posterBlob())) toast.success(t('readingHistory.share.copied'))
    else toast.error(t('readingHistory.share.copyFailed'))
  } finally {
    busy.value = null
  }
}

function handleShape(value: PosterShape) {
  shape.value = value
}

function handleLook(value: PosterLook) {
  look.value = value
}

function handlePeriod(value: SharePeriod) {
  period.value = value
}

function handleToggleTitles() {
  showTitles.value = !showTitles.value
}

function handleToggleRereads() {
  showRereads.value = !showRereads.value
}

function handleToggleRatings() {
  showRatings.value = !showRatings.value
}

function periodOptionLabel(value: SharePeriod): string {
  return value === 'year' ? String(props.year) : t(`readingHistory.share.periods.${value}`)
}

function segmentClass(active: boolean) {
  return [
    'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
  ]
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed inset-x-0 bottom-0 z-[70] flex max-h-[92svh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl focus-visible:outline-none md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[calc(100svh-3rem)] md:w-[min(calc(100%-2rem),1000px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
      >
        <header class="flex items-start gap-4 border-b border-border px-4 py-4 md:px-6 md:py-5">
          <span class="hidden size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary md:flex"
            ><Image class="size-[18px]" aria-hidden="true"
          /></span>
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground">{{ t('readingHistory.share.title') }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t('readingHistory.share.description') }}</DialogDescription>
          </div>
          <DialogClose
            class="-me-2 -mt-1 ms-auto grid size-8 shrink-0 place-items-center rounded-md text-foreground hover:bg-muted"
            :aria-label="t('readingHistory.share.close')"
          >
            <X class="size-4" aria-hidden="true" />
          </DialogClose>
        </header>

        <div class="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden">
          <div
            class="relative grid min-h-[300px] place-items-center border-b border-border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:18px_18px] p-4 md:min-h-[520px] md:border-e md:border-b-0 md:p-6"
          >
            <canvas
              ref="canvas"
              role="img"
              :aria-label="accessibleSummary"
              :width="size.width"
              :height="size.height"
              class="h-auto max-h-[min(42svh,560px)] w-auto max-w-full rounded-xl shadow-lg md:max-h-[min(60svh,560px)]"
            />
            <div v-if="loading" class="absolute inset-0 grid place-items-center bg-card/70" role="status">
              <span class="flex items-center gap-2 text-sm text-foreground"
                ><Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ t('readingHistory.share.loading') }}</span
              >
            </div>
            <p
              v-else-if="failed"
              class="absolute inset-0 grid place-items-center bg-card/90 p-6 text-center text-sm text-muted-foreground"
              role="alert"
            >
              {{ t('readingHistory.share.loadFailed') }}
            </p>
          </div>

          <div class="flex flex-col gap-4 p-4 md:overflow-y-auto md:p-6">
            <fieldset>
              <legend class="mb-1.5 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t('readingHistory.share.period') }}
              </legend>
              <div class="flex items-center gap-1 rounded-lg bg-muted p-1">
                <button
                  v-for="value in PERIODS"
                  :key="value"
                  type="button"
                  :class="segmentClass(period === value)"
                  :aria-pressed="period === value"
                  @click="handlePeriod(value)"
                >
                  {{ periodOptionLabel(value) }}
                </button>
              </div>
              <p class="mt-1.5 text-[11.5px] text-muted-foreground">
                {{ t('readingHistory.share.periodSummary', { period: periodLabel, count: periodReads.length }) }}
              </p>
            </fieldset>
            <fieldset>
              <legend class="mb-1.5 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t('readingHistory.share.shape') }}
              </legend>
              <div class="flex items-center gap-1 rounded-lg bg-muted p-1">
                <button
                  v-for="value in SHAPES"
                  :key="value"
                  type="button"
                  :class="segmentClass(shape === value)"
                  :aria-pressed="shape === value"
                  @click="handleShape(value)"
                >
                  {{ t(`readingHistory.share.shapes.${value}.name`) }}
                </button>
              </div>
              <p class="mt-1.5 text-[11.5px] text-muted-foreground">{{ t(`readingHistory.share.shapes.${shape}.hint`) }}</p>
            </fieldset>
            <fieldset>
              <legend class="mb-1.5 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t('readingHistory.share.look') }}
              </legend>
              <div class="flex items-center gap-1 rounded-lg bg-muted p-1">
                <button
                  v-for="value in LOOKS"
                  :key="value"
                  type="button"
                  :class="segmentClass(look === value)"
                  :aria-pressed="look === value"
                  @click="handleLook(value)"
                >
                  {{ t(`readingHistory.share.looks.${value}`) }}
                </button>
              </div>
            </fieldset>
            <fieldset class="flex flex-col">
              <legend class="mb-1 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t('readingHistory.share.show') }}
              </legend>
              <label class="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm text-foreground">
                <input type="checkbox" class="peer sr-only" :checked="showTitles" @change="handleToggleTitles" />
                <span
                  class="grid size-4 shrink-0 place-items-center rounded-xs border peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                  :class="showTitles ? 'border-primary bg-primary' : 'border-border'"
                  aria-hidden="true"
                >
                  <Check v-if="showTitles" class="size-2.5 text-primary-foreground" :stroke-width="3" />
                </span>
                {{ t('readingHistory.share.titles') }}
              </label>
              <label class="flex min-h-8 cursor-pointer items-start gap-2.5 py-1 text-sm text-foreground">
                <input type="checkbox" class="peer sr-only" :checked="showRereads" @change="handleToggleRereads" />
                <span
                  class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-xs border peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                  :class="showRereads ? 'border-primary bg-primary' : 'border-border'"
                  aria-hidden="true"
                >
                  <Check v-if="showRereads" class="size-2.5 text-primary-foreground" :stroke-width="3" />
                </span>
                <span
                  >{{ t('readingHistory.share.rereads')
                  }}<span class="block text-[11.5px] leading-4 text-muted-foreground">{{ t('readingHistory.share.rereadsHint') }}</span></span
                >
              </label>
              <label class="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm text-foreground">
                <input type="checkbox" class="peer sr-only" :checked="showRatings" @change="handleToggleRatings" />
                <span
                  class="grid size-4 shrink-0 place-items-center rounded-xs border peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                  :class="showRatings ? 'border-primary bg-primary' : 'border-border'"
                  aria-hidden="true"
                >
                  <Check v-if="showRatings" class="size-2.5 text-primary-foreground" :stroke-width="3" />
                </span>
                {{ t('readingHistory.share.ratings') }}
              </label>
            </fieldset>
          </div>
        </div>

        <footer class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 md:px-6">
          <span class="text-[11.5px] text-muted-foreground max-md:hidden">{{
            t('readingHistory.share.fileHint', { shape: t(`readingHistory.share.shapes.${shape}.name`), width: size.width, height: size.height })
          }}</span>
          <span class="flex-1" aria-hidden="true" />
          <DialogClose as-child>
            <Button variant="ghost" class="max-md:flex-1">{{ t('common.cancel') }}</Button>
          </DialogClose>
          <Button v-if="canCopy" variant="outline" class="max-md:flex-1" :disabled="loading || failed || busy !== null" @click="handleCopy">
            <Loader2 v-if="busy === 'copy'" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <Copy v-else aria-hidden="true" />{{ t('readingHistory.share.copy') }}
          </Button>
          <Button class="max-md:flex-1" :disabled="loading || failed || busy !== null" @click="handleSave">
            <Loader2 v-if="busy === 'save'" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <Download v-else aria-hidden="true" />{{ t('readingHistory.share.save') }}
          </Button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
