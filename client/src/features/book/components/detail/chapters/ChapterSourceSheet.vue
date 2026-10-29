<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AudioLines, BadgeCheck, FileUp, Loader2, Search, X } from '@lucide/vue'
import { AUDIBLE_REGIONS, AUDIOBOOK_CHAPTER_LIMITS, CHAPTER_PAUSE_LIMITS, type AudibleRegion } from '@bookorbit/types'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import { fromDraft, sameChapterList, type DraftChapter } from '@/features/book/lib/chapter-edit'
import type { AlignedRow, ApplyMode, MatchMode, PartsMode } from '@/features/book/lib/chapter-align'
import { CHAPTER_IMPORT_MAX_BYTES, parseChapters, type ChapterFormat } from '@/features/book/lib/chapter-io'
import { formatChapterClock } from '@/features/book/lib/chapter-time'
import { fitOffsetToPauses, PAUSE_FIT_POINTS, PAUSE_FIT_RANGE_MS, type AnalyzePauses, type PauseFit } from '@/features/book/lib/chapter-snap'
import { useChapterReview, type ReviewSource, type ReviewSourceKind } from '@/features/book/composables/useChapterReview'

/** What the sheet is showing. Its chapters arrive separately, once loaded, as `source`. */
export interface ChapterSourceRequest {
  kind: ReviewSourceKind
  /** Shown under the title, such as when a version was saved. */
  detail?: string
}

const props = defineProps<{
  request: ChapterSourceRequest | null
  source: ReviewSource | null
  current: DraftChapter[]
  totalDurationMs: number | null
  loading: boolean
  error: string | null
  lookupAsin: string | null
  lookupRegion: AudibleRegion
  analyzePauses: AnalyzePauses
}>()

const emit = defineEmits<{ apply: [rows: DraftChapter[], changed: number]; lookup: [asin: string, region: AudibleRegion]; close: [] }>()

const { t, locale } = useI18n()

const KIND_KEYS: Record<ReviewSourceKind, string> = {
  files: 'book.detail.chapters.sources.files.title',
  tracks: 'book.detail.chapters.sources.tracks.title',
  import: 'book.detail.chapters.sources.import.title',
  version: 'book.detail.chapters.sources.version.title',
  lookup: 'book.detail.chapters.sources.lookup.title',
  toc: 'book.detail.chapters.sources.toc.title',
  read_along: 'book.detail.chapters.sources.readAlong.title',
}

const FORMAT_KEYS: Record<ChapterFormat, string> = {
  cue: 'book.detail.chapters.formats.cue',
  ffmetadata: 'book.detail.chapters.formats.ffmetadata',
  audacity: 'book.detail.chapters.formats.audacity',
  timestamps: 'book.detail.chapters.formats.timestamps',
  titles: 'book.detail.chapters.formats.titles',
  json: 'book.detail.chapters.formats.json',
}

const REGION_ISO: Record<AudibleRegion, string> = {
  us: 'US',
  uk: 'GB',
  ca: 'CA',
  au: 'AU',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  es: 'ES',
  jp: 'JP',
  in: 'IN',
}

const review = useChapterReview(toRef(props, 'current'), toRef(props, 'totalDurationMs'))
const { offsetMs, stretch, partsMode, matchMode, applyMode, rows, incoming, currentChapters, titlesOnly } = review

const pasted = ref('')
const importError = ref<string | null>(null)
const importInfo = ref<{ format: ChapterFormat; skipped: number; truncated: boolean } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const asin = ref('')
const region = ref<AudibleRegion>('us')
const offsetText = ref('0')
let fitGeneration = 0
let fitController: AbortController | null = null
onBeforeUnmount(() => fitController?.abort())
const fitting = ref(false)
const fit = ref<PauseFit | null>(null)
const fitNote = ref<{ text: string; error: boolean } | null>(null)

watch(
  () => props.request,
  (request) => {
    pasted.value = ''
    importError.value = null
    importInfo.value = null
    asin.value = props.lookupAsin ?? ''
    region.value = props.lookupRegion
    if (request?.kind === 'import') review.open(null)
  },
)

watch(
  () => props.source,
  (source) => {
    review.open(source)
    offsetText.value = '0'
  },
)

watch(
  review.base,
  () => {
    fitController?.abort()
    fitGeneration += 1
    fitting.value = false
    fit.value = null
    fitNote.value = null
  },
  { flush: 'sync' },
)

watch(offsetMs, (ms) => {
  if (parseSeconds(offsetText.value) !== ms) offsetText.value = String(ms / 1000)
})

const regionNames = computed(() => {
  try {
    return new Intl.DisplayNames([locale.value], { type: 'region' })
  } catch {
    return null
  }
})
const regionOptions = computed(() => AUDIBLE_REGIONS.map((code) => ({ code, label: regionNames.value?.of(REGION_ISO[code]) ?? code.toUpperCase() })))
const asinValid = computed(() => /^[A-Za-z0-9]{10}$/.test(asin.value.trim()))
const hasIncoming = computed(() => review.source.value !== null && incoming.value.length > 0)

const runtimeLine = computed(() => {
  const theirs = review.runtimeMs.value
  const ours = props.totalDurationMs
  if (!theirs || !ours) return null
  return t('book.detail.chapters.review.runtimes', {
    theirs: formatChapterClock(theirs, { withMs: false }),
    ours: formatChapterClock(ours, { withMs: false }),
    difference: formatNumber((ours - theirs) / 1000, { signDisplay: 'always', maximumFractionDigits: 1 }),
  })
})

const stretchHint = computed(() => {
  const scale = review.availableScale.value
  if (scale === null) return null
  return t('book.detail.chapters.review.stretchHint', {
    factor: formatNumber(scale, { maximumFractionDigits: 5 }),
    seconds: formatNumber(Math.abs(review.stretchShiftMs.value) / 1000, { maximumFractionDigits: 1 }),
  })
})

const suggestionButtons = computed(() =>
  review.suggestions.value.map((suggestion) => ({
    ...suggestion,
    label: t(suggestion.kind === 'brandIntro' ? 'book.detail.chapters.review.suggestIntro' : 'book.detail.chapters.review.suggestMatch', {
      seconds: formatSeconds(suggestion.offsetMs),
    }),
  })),
)

const applyModes = computed(() => [
  {
    value: 'replace' as ApplyMode,
    label: t('book.detail.chapters.apply.replace'),
    hint: t('book.detail.chapters.apply.replaceHint'),
    disabled: titlesOnly.value,
  },
  { value: 'titles' as ApplyMode, label: t('book.detail.chapters.apply.titles'), hint: t('book.detail.chapters.apply.titlesHint'), disabled: false },
  {
    value: 'times' as ApplyMode,
    label: t('book.detail.chapters.apply.times'),
    hint: t('book.detail.chapters.apply.timesHint'),
    disabled: titlesOnly.value,
  },
])

const partOptions = computed(() => [
  { value: 'own' as PartsMode, label: t('book.detail.chapters.review.partsOwn') },
  { value: 'prefix' as PartsMode, label: t('book.detail.chapters.review.partsPrefix') },
  { value: 'drop' as PartsMode, label: t('book.detail.chapters.review.partsDrop') },
])

const matchOptions = computed(() => [
  { value: 'time' as MatchMode, label: t('book.detail.chapters.review.matchTime') },
  { value: 'position' as MatchMode, label: t('book.detail.chapters.review.matchPosition') },
])

const showMatch = computed(() => !titlesOnly.value && applyMode.value !== 'replace')
/** A replace that would leave the editor as it is, such as reading back files that match it. */
const replaceUnchanged = computed(() => applyMode.value === 'replace' && sameChapterList(fromDraft(review.apply().draft), currentChapters.value))
const applyCount = computed(() => {
  if (applyMode.value !== 'replace') return review.apply().changed
  return replaceUnchanged.value ? 0 : review.included.value.size
})
const applySummary = computed(() =>
  t(applyMode.value === 'replace' && !replaceUnchanged.value ? 'book.detail.chapters.review.willReplace' : 'book.detail.chapters.review.willChange', {
    count: applyCount.value,
  }),
)
/** A source that answered with no chapters at all, so the sheet says so instead of staying blank. */
const sourceEmpty = computed(() => review.source.value !== null && incoming.value.length === 0 && !props.loading && !props.error)

/** The offset field holds a plain number; a decimal comma or a typographic minus is accepted too. */
function parseSeconds(text: string): number | null {
  const trimmed = text.trim().replace(',', '.').replace('\u2212', '-')
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? Math.round(value * 1000) : null
}

function formatSeconds(ms: number): string {
  return formatNumber(ms / 1000, { signDisplay: 'exceptZero', maximumFractionDigits: 3 })
}

/** A left-out row is struck through as well as muted, so the state does not rest on colour. */
function incomingTitleClass(row: AlignedRow): string {
  if (row.incomingIndex === null) return ''
  if (!review.included.value.has(row.incomingIndex)) return 'text-muted-foreground line-through'
  const same = row.currentIndex !== null && incoming.value[row.incomingIndex]!.title === currentChapters.value[row.currentIndex]?.title
  return same ? '' : 'font-medium'
}

function deltaLabel(deltaMs: number | null): string {
  return deltaMs === null || deltaMs === 0
    ? ''
    : formatNumber(deltaMs / 1000, { signDisplay: 'always', minimumFractionDigits: 1, maximumFractionDigits: 3 })
}

function parseText(text: string) {
  importError.value = null
  const result = parseChapters(text)
  if (!result || result.chapters.length === 0) {
    importError.value = t('book.detail.chapters.sources.import.unreadable')
    return
  }
  importInfo.value = { format: result.format, skipped: result.skippedLines.length, truncated: result.truncated }
  review.open({ kind: 'import', chapters: result.chapters, titlesOnly: result.titlesOnly })
}

function handleParsePasted() {
  parseText(pasted.value)
}

function handlePickFile() {
  fileInput.value?.click()
}

async function handleFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > CHAPTER_IMPORT_MAX_BYTES) {
    importError.value = t('book.detail.chapters.sources.import.tooLarge')
    return
  }
  const text = await file.text()
  pasted.value = text
  parseText(text)
}

function handleLookup() {
  if (asinValid.value) emit('lookup', asin.value.trim().toUpperCase(), region.value)
}

function handleOffsetInput(event: Event) {
  offsetText.value = (event.target as HTMLInputElement).value
  const ms = parseSeconds(offsetText.value)
  if (ms !== null) offsetMs.value = ms
}

function handleSuggestion(event: MouseEvent) {
  const value = Number((event.currentTarget as HTMLElement).dataset.offset)
  if (Number.isFinite(value)) offsetMs.value = value
}

const fitLabel = computed(() =>
  fit.value
    ? t('book.detail.chapters.review.fitPausesResult', {
        seconds: formatSeconds(fit.value.offsetMs),
        hits: formatNumber(fit.value.hits),
        total: formatNumber(fit.value.total),
      })
    : t('book.detail.chapters.review.fitPauses'),
)

/** Listens around the first few incoming starts and picks the offset that lands most of them in a pause. */
async function handleFitPauses() {
  if (fit.value) {
    offsetMs.value = fit.value.offsetMs
    return
  }
  const total = props.totalDurationMs ?? Number.POSITIVE_INFINITY
  const starts = review.base.value
    .slice(1)
    .map((chapter) => chapter.startMs)
    .filter((start) => start < total)
    .slice(0, PAUSE_FIT_POINTS)
  if (starts.length === 0) return
  fitController?.abort()
  fitController = new AbortController()
  const signal = fitController.signal
  const generation = fitGeneration
  fitting.value = true
  fitNote.value = null
  try {
    const windowMs = Math.min(CHAPTER_PAUSE_LIMITS.maxWindowMs, 2 * PAUSE_FIT_RANGE_MS)
    const result = fitOffsetToPauses(starts, await props.analyzePauses(starts, windowMs, signal))
    if (generation !== fitGeneration) return
    if (result) {
      fit.value = result
      offsetMs.value = result.offsetMs
    } else fitNote.value = { text: t('book.detail.chapters.review.fitPausesNone'), error: false }
  } catch (reason) {
    if (generation !== fitGeneration) return
    fitNote.value = { text: errorMessage(reason, 'book.detail.chapters.errors.analyze'), error: true }
  } finally {
    if (generation === fitGeneration) fitting.value = false
  }
}

function handleResetOffset() {
  offsetMs.value = 0
}

function handleToggleRow(index: number) {
  review.toggleRow(index)
}

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

function handleCancel() {
  emit('close')
}

function handleApply() {
  const result = review.apply()
  if (result.changed === 0 && applyMode.value !== 'replace') return
  emit('apply', result.draft, result.changed)
}
</script>

<template>
  <Sheet :open="request !== null" @update:open="handleOpenChange">
    <SheetContent
      side="right"
      hide-close
      class="w-full gap-0 overflow-hidden border-border p-0 shadow-2xl sm:w-[min(100vw-3rem,56rem)] sm:max-w-none"
    >
      <header class="flex min-h-[3.625rem] shrink-0 items-center gap-3 border-b border-border py-2 ps-4 pe-3">
        <div class="min-w-0 flex-1">
          <SheetTitle class="text-sm font-semibold">{{ request ? t(KIND_KEYS[request.kind]) : '' }}</SheetTitle>
          <SheetDescription class="text-xs leading-snug text-muted-foreground">
            {{ request?.detail ?? t('book.detail.chapters.sources.description') }}
          </SheetDescription>
        </div>
        <SheetClose
          class="grid size-8 place-items-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('common.close')"
        >
          <X class="size-4" aria-hidden="true" />
        </SheetClose>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <!-- Audible lookup -->
        <form v-if="request?.kind === 'lookup'" class="flex flex-wrap items-end gap-2" @submit.prevent="handleLookup">
          <label class="flex min-w-[10rem] flex-1 flex-col gap-1.5 text-sm font-medium">
            {{ t('book.detail.chapters.sources.lookup.asin') }}
            <input
              v-model="asin"
              class="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ring"
              maxlength="10"
              spellcheck="false"
              autocomplete="off"
              :aria-invalid="asin && !asinValid ? 'true' : undefined"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('book.detail.chapters.sources.lookup.region') }}
            <select
              v-model="region"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option v-for="option in regionOptions" :key="option.code" :value="option.code">{{ option.label }}</option>
            </select>
          </label>
          <Button type="submit" size="sm" class="h-9" :disabled="!asinValid || loading">
            <Loader2 v-if="loading" :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <Search v-else :size="14" aria-hidden="true" />
            {{ t('book.detail.chapters.sources.lookup.action') }}
          </Button>
          <p class="basis-full text-xs text-muted-foreground">{{ t('book.detail.chapters.sources.lookup.hint') }}</p>
        </form>

        <!-- Import: paste or pick a file first -->
        <div v-if="request?.kind === 'import' && !review.source.value" class="flex flex-col gap-3">
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('book.detail.chapters.sources.import.pasteLabel') }}
            <textarea
              v-model="pasted"
              rows="12"
              spellcheck="false"
              class="rounded-md border border-input bg-background px-3 py-2 font-mono text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring"
              :placeholder="t('book.detail.chapters.sources.import.placeholder')"
            />
          </label>
          <p class="text-xs text-muted-foreground">{{ t('book.detail.chapters.sources.import.formats') }}</p>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" type="button" :disabled="!pasted.trim()" @click="handleParsePasted">{{
              t('book.detail.chapters.sources.import.read')
            }}</Button>
            <Button size="sm" variant="outline" type="button" @click="handlePickFile">
              <FileUp :size="14" aria-hidden="true" />
              {{ t('book.detail.chapters.sources.import.chooseFile') }}
            </Button>
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              accept=".cue,.txt,.json,.ffmetadata,.chapters,text/plain,application/json"
              @change="handleFileChosen"
            />
          </div>
          <p v-if="importError" class="text-sm text-destructive" role="alert">{{ importError }}</p>
        </div>

        <div v-if="loading && request?.kind !== 'lookup'" class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('book.detail.chapters.sources.loading') }}
        </div>

        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
        <p v-else-if="sourceEmpty" class="text-sm text-muted-foreground" role="status">{{ t('book.detail.chapters.sources.empty') }}</p>

        <template v-if="hasIncoming">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground" role="status">
            <span>{{ t('book.detail.chapters.sources.counts', { incoming: incoming.length, current: currentChapters.length }) }}</span>
            <span v-if="runtimeLine">{{ runtimeLine }}</span>
            <span v-if="review.lookup.value?.isAccurate" class="inline-flex items-center gap-1 text-foreground">
              <BadgeCheck class="size-3.5 text-success" aria-hidden="true" />
              {{ t('book.detail.chapters.review.accurate') }}
            </span>
            <span v-if="importInfo">{{ t(FORMAT_KEYS[importInfo.format]) }}</span>
            <span v-if="importInfo && importInfo.skipped > 0">{{
              t('book.detail.chapters.sources.import.skipped', { count: importInfo.skipped })
            }}</span>
            <span v-if="importInfo?.truncated" class="text-foreground">
              {{ t('book.detail.chapters.sources.import.truncated', { count: formatNumber(AUDIOBOOK_CHAPTER_LIMITS.maxChapters) }) }}
            </span>
          </div>

          <!-- Adjust: only a timed source can be shifted or stretched -->
          <section
            v-if="!titlesOnly"
            class="flex flex-col gap-3 rounded-lg border border-border px-3 py-3"
            :aria-label="t('book.detail.chapters.review.adjust')"
          >
            <div class="flex flex-wrap items-end gap-2">
              <label class="flex flex-col gap-1.5 text-sm font-medium">
                {{ t('book.detail.chapters.review.offset') }}
                <input
                  :value="offsetText"
                  inputmode="decimal"
                  class="h-8 w-28 rounded-md border border-input bg-background px-2.5 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                  @input="handleOffsetInput"
                />
              </label>
              <button
                v-for="suggestion in suggestionButtons"
                :key="suggestion.kind"
                type="button"
                :data-offset="suggestion.offsetMs"
                class="inline-flex h-8 items-center rounded-md border px-2.5 text-[12.5px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="offsetMs === suggestion.offsetMs ? 'border-primary bg-primary/10 text-foreground' : 'border-input text-foreground'"
                @click="handleSuggestion"
              >
                {{ suggestion.label }}
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground"
                :class="fit && offsetMs === fit.offsetMs ? 'border-primary bg-primary/10 text-foreground' : 'border-input text-foreground'"
                :disabled="fitting"
                @click="handleFitPauses"
              >
                <Loader2 v-if="fitting" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <AudioLines v-else class="size-3.5" aria-hidden="true" />
                {{ fitLabel }}
              </button>
              <button
                v-if="offsetMs !== 0"
                type="button"
                class="inline-flex h-8 items-center rounded-md px-2.5 text-[12.5px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="handleResetOffset"
              >
                {{ t('book.detail.chapters.review.resetOffset') }}
              </button>
            </div>
            <p v-if="fitNote" class="text-xs" :class="fitNote.error ? 'text-destructive' : 'text-muted-foreground'" role="status">
              {{ fitNote.text }}
            </p>
            <label v-if="stretchHint" class="flex items-start gap-2 text-sm">
              <input v-model="stretch" type="checkbox" class="mt-0.5 size-3.5 accent-[var(--primary)]" />
              <span>
                {{ t('book.detail.chapters.review.stretch') }}
                <span class="block text-xs text-muted-foreground">{{ stretchHint }}</span>
              </span>
            </label>
            <fieldset v-if="review.showsParts.value" class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <legend class="mb-1.5 basis-full text-sm font-medium">{{ t('book.detail.chapters.review.parts') }}</legend>
              <label v-for="option in partOptions" :key="option.value" class="flex items-center gap-2">
                <input v-model="partsMode" type="radio" :value="option.value" class="size-3.5 accent-[var(--primary)]" />
                {{ option.label }}
              </label>
            </fieldset>
          </section>

          <fieldset class="grid gap-2 sm:grid-cols-3">
            <legend class="sr-only">{{ t('book.detail.chapters.apply.label') }}</legend>
            <label
              v-for="option in applyModes"
              :key="option.value"
              class="flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              :class="
                applyMode === option.value
                  ? 'border-primary bg-primary/10'
                  : option.disabled
                    ? 'cursor-not-allowed border-border text-muted-foreground'
                    : 'border-border hover:bg-muted/40'
              "
            >
              <span class="flex items-center gap-2 font-medium">
                <input v-model="applyMode" type="radio" :value="option.value" :disabled="option.disabled" class="size-3.5 accent-[var(--primary)]" />
                {{ option.label }}
              </span>
              <span class="text-xs text-muted-foreground">{{ option.hint }}</span>
            </label>
          </fieldset>

          <fieldset v-if="showMatch" class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <legend class="mb-1.5 basis-full text-sm font-medium">{{ t('book.detail.chapters.review.match') }}</legend>
            <label v-for="option in matchOptions" :key="option.value" class="flex items-center gap-2">
              <input v-model="matchMode" type="radio" :value="option.value" class="size-3.5 accent-[var(--primary)]" />
              {{ option.label }}
            </label>
            <span class="text-xs text-muted-foreground">{{ t('book.detail.chapters.review.matched', { count: review.matchedCount.value }) }}</span>
          </fieldset>

          <p v-if="review.pastEnd.value.size > 0" class="text-[12.5px] text-destructive">
            {{ t('book.detail.chapters.sources.pastEnd', { count: review.pastEnd.value.size }) }}
          </p>

          <div class="rounded-lg border border-border">
            <div
              class="grid grid-cols-[1.75rem_2.25rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem] gap-2 border-b border-border px-2 py-2 text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground"
            >
              <span class="sr-only">{{ t('book.detail.chapters.review.include') }}</span>
              <span class="col-start-2 text-end">#</span>
              <span>{{ t('book.detail.chapters.sources.currentColumn') }}</span>
              <span>{{ t('book.detail.chapters.sources.incomingColumn') }}</span>
              <span class="text-end">{{ t('book.detail.chapters.sources.deltaColumn') }}</span>
            </div>
            <ol class="divide-y divide-border">
              <li
                v-for="(row, position) in rows"
                :key="position"
                class="source-row grid grid-cols-[1.75rem_2.25rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem] items-center gap-2 px-2 py-1.5 text-[12.5px]"
              >
                <span class="flex justify-center">
                  <input
                    v-if="row.incomingIndex !== null"
                    type="checkbox"
                    class="size-3.5 accent-[var(--primary)]"
                    :checked="review.included.value.has(row.incomingIndex)"
                    :disabled="review.pastEnd.value.has(row.incomingIndex)"
                    :aria-label="t('book.detail.chapters.review.includeRow', { title: incoming[row.incomingIndex]!.title })"
                    @change="handleToggleRow(row.incomingIndex)"
                  />
                </span>
                <span class="text-end text-muted-foreground tabular-nums">{{
                  row.incomingIndex !== null ? formatNumber(row.incomingIndex + 1) : ''
                }}</span>
                <span class="min-w-0">
                  <template v-if="row.currentIndex !== null">
                    <span class="block font-mono text-[11.5px] text-muted-foreground tabular-nums">{{
                      formatChapterClock(currentChapters[row.currentIndex]!.startMs)
                    }}</span>
                    <span class="block truncate">{{ currentChapters[row.currentIndex]!.title }}</span>
                  </template>
                </span>
                <span class="min-w-0">
                  <template v-if="row.incomingIndex !== null">
                    <span
                      v-if="!titlesOnly"
                      class="block font-mono text-[11.5px] tabular-nums"
                      :class="review.pastEnd.value.has(row.incomingIndex) ? 'text-destructive' : 'text-muted-foreground'"
                    >
                      {{ formatChapterClock(incoming[row.incomingIndex]!.startMs) }}
                    </span>
                    <span class="block truncate" :class="incomingTitleClass(row)">
                      {{ incoming[row.incomingIndex]!.title || t('book.detail.chapters.untitledChapter') }}
                    </span>
                  </template>
                </span>
                <span class="text-end font-mono text-[11.5px] text-muted-foreground tabular-nums">{{ deltaLabel(row.deltaMs) }}</span>
              </li>
            </ol>
          </div>
        </template>
      </div>

      <footer v-if="hasIncoming" class="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
        <span class="me-auto text-[12.5px] text-muted-foreground" role="status">{{ applySummary }}</span>
        <Button variant="outline" type="button" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button type="button" :disabled="applyCount === 0" @click="handleApply">{{ t('book.detail.chapters.apply.action') }}</Button>
      </footer>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
/* Thousands of rows are possible; the browser skips laying out the ones off screen. */
.source-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 2.75rem;
}
</style>
