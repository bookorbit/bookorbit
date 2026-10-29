<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Combine,
  Crosshair,
  Info,
  Loader2,
  Magnet,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scissors,
  Square,
} from '@lucide/vue'
import type { WaveformView } from '@/features/book/composables/useChapterWaveform'
import { formatNumber } from '@/i18n/formatters'
import { indexAtTime, type ChapterIssue, type DraftChapter } from '@/features/book/lib/chapter-edit'
import { formatChapterClock } from '@/features/book/lib/chapter-time'
import ChapterTimeline from './ChapterTimeline.vue'
import ChapterWaveformStrip from './ChapterWaveformStrip.vue'

/** What Snap would do here: not known until the pauses are in, nothing nearby, already there, or a move. */
export interface ChapterSnapHint {
  state: 'unknown' | 'none' | 'on' | 'available'
  targetMs: number | null
}

const props = defineProps<{
  rows: DraftChapter[]
  activeIndex: number
  totalDurationMs: number
  issuesByKey: Map<string, ChapterIssue[]>
  savedStartMs: number | null
  waveform: { view: WaveformView | null; loading: boolean; failed: boolean }
  minStartMs: number
  maxStartMs: number
  snap: ChapterSnapHint
  snapping: boolean
  snapRadiusMs: number
  positionMs: number
  /** Anything playing: the book from the playhead, or a few seconds across the cut. */
  isPlaying: boolean
  playerLoading: boolean
  playerError: string | null
}>()

const emit = defineEmits<{
  step: [delta: number]
  nudge: [deltaMs: number]
  move: [startMs: number]
  commit: []
  snap: []
  removeCut: []
  backToCut: []
  toggle: []
  playCut: []
  skip: [deltaMs: number]
  seek: [ms: number]
  moveCutHere: []
  newChapterHere: []
}>()

const { t } = useI18n()

const SKIP_MS = 15_000
const NUDGES = [
  { deltaMs: -1_000, key: 'book.detail.chapters.nudge.backSecond' },
  { deltaMs: -100, key: 'book.detail.chapters.nudge.backTenth' },
  { deltaMs: 100, key: 'book.detail.chapters.nudge.forwardTenth' },
  { deltaMs: 1_000, key: 'book.detail.chapters.nudge.forwardSecond' },
] as const

const showSnap = ref(false)
const dragging = ref(false)
const announcement = ref('')

const chapter = computed(() => props.rows[props.activeIndex] ?? null)
const previous = computed(() => (props.activeIndex > 0 ? props.rows[props.activeIndex - 1]! : null))
const title = computed(() => chapter.value?.title || t('book.detail.chapters.untitledChapter'))
const previousTitle = computed(() => previous.value?.title || t('book.detail.chapters.untitledChapter'))
const boundaries = computed(() => props.rows.map((row) => row.startMs))
const chapterAtPlayhead = computed(() => props.rows[indexAtTime(props.rows, props.positionMs)] ?? null)

function seconds(ms: number, options: Intl.NumberFormatOptions = {}): string {
  return formatNumber(ms / 1000, { style: 'unit', unit: 'second', unitDisplay: 'narrow', signDisplay: 'always', ...options })
}

const nudges = computed(() =>
  NUDGES.map((nudge) => ({
    ...nudge,
    label: t(nudge.key),
    display: seconds(nudge.deltaMs, { minimumFractionDigits: nudge.deltaMs % 1000 ? 1 : 0, maximumFractionDigits: 1 }),
  })),
)

const movedMs = computed(() => (props.savedStartMs === null || !chapter.value ? 0 : chapter.value.startMs - props.savedStartMs))
const moved = computed(() => (movedMs.value ? seconds(movedMs.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null))
const snapDelta = computed(() =>
  props.snap.state === 'available' && props.snap.targetMs !== null && chapter.value
    ? seconds(props.snap.targetMs - chapter.value.startMs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null,
)

const playheadInRange = computed(() => props.positionMs >= props.minStartMs && props.positionMs <= props.maxStartMs)
const canMoveCutHere = computed(() => previous.value !== null && playheadInRange.value && Math.round(props.positionMs) !== chapter.value?.startMs)

watch(
  () => [chapter.value?.key, chapter.value?.startMs] as const,
  ([key, startMs], before) => {
    if (key !== undefined && startMs !== undefined && before?.[0] === key && before[1] !== startMs && !dragging.value) {
      announcement.value = t('book.detail.chapters.cut.announce', { time: formatChapterClock(startMs) })
    }
  },
)

function handlePrevious() {
  emit('step', -1)
}
function handleNext() {
  emit('step', 1)
}
function handleNudge(event: MouseEvent) {
  const delta = Number((event.currentTarget as HTMLElement).dataset.delta)
  if (Number.isFinite(delta)) emit('nudge', delta * (event.shiftKey ? 10 : 1))
}
function handleWaveformMove(startMs: number) {
  dragging.value = true
  emit('move', startMs)
}
function handleWaveformCommit() {
  dragging.value = false
  if (chapter.value) announcement.value = t('book.detail.chapters.cut.announce', { time: formatChapterClock(chapter.value.startMs) })
  emit('commit')
}
function handleWaveformNudge(deltaMs: number) {
  emit('nudge', deltaMs)
}
function handleSeek(ms: number) {
  emit('seek', ms)
}
function handleSnap() {
  showSnap.value = false
  emit('snap')
}
function handleSnapShow() {
  showSnap.value = true
}
function handleSnapHide() {
  showSnap.value = false
}
function handleRemoveCut() {
  emit('removeCut')
}
function handleBackToCut() {
  emit('backToCut')
}
function handleToggle() {
  emit('toggle')
}
function handlePlayCut() {
  emit('playCut')
}
function handleBack() {
  emit('skip', -SKIP_MS)
}
function handleForward() {
  emit('skip', SKIP_MS)
}
function handleMoveCutHere() {
  emit('moveCutHere')
}
function handleNewChapterHere() {
  emit('newChapterHere')
}
</script>

<template>
  <section
    class="cut-card flex flex-col rounded-xl border border-border bg-card"
    :aria-label="
      previous ? t('book.detail.chapters.cut.label', { previous: previousTitle, next: title }) : t('book.detail.chapters.cut.firstHeading')
    "
  >
    <div class="flex h-[38px] shrink-0 items-center gap-2 border-b border-border pe-1.5 ps-3.5">
      <h3 class="text-[10.5px] font-bold uppercase leading-none tracking-[0.09em] text-muted-foreground">
        {{ previous ? t('book.detail.chapters.cut.heading') : t('book.detail.chapters.cut.firstHeading') }}
      </h3>
      <span v-if="previous" class="text-[11.5px] leading-none text-muted-foreground tabular-nums">
        {{ t('book.detail.chapters.cut.count', { index: formatNumber(activeIndex), total: formatNumber(rows.length - 1) }) }}
      </span>
      <div class="ms-auto flex items-center">
        <button
          class="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          :aria-label="t('book.detail.chapters.cut.previous')"
          :title="t('book.detail.chapters.cut.previous')"
          :disabled="activeIndex <= 0"
          @click="handlePrevious"
        >
          <ChevronLeft class="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
        <button
          class="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          :aria-label="t('book.detail.chapters.cut.next')"
          :title="t('book.detail.chapters.cut.next')"
          :disabled="activeIndex >= rows.length - 1"
          @click="handleNext"
        >
          <ChevronRight class="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- The cut: where one chapter ends and the next starts -->
    <div v-if="chapter && previous" class="flex flex-col gap-3 px-3.5 pb-3.5 pt-3">
      <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2.5">
        <div class="min-w-0">
          <p class="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{{ t('book.detail.chapters.cut.ends') }}</p>
          <p class="truncate text-[13px] font-semibold leading-5" :title="previousTitle">{{ previousTitle }}</p>
        </div>
        <ArrowRight class="mb-0.5 size-3.5 text-muted-foreground rtl:-scale-x-100" aria-hidden="true" />
        <div class="min-w-0 text-end">
          <p class="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{{ t('book.detail.chapters.cut.starts') }}</p>
          <p class="truncate text-[13px] font-semibold leading-5 text-primary" :title="title">{{ title }}</p>
        </div>
      </div>

      <ChapterWaveformStrip
        :view="waveform.view"
        :loading="waveform.loading"
        :failed="waveform.failed"
        :start-ms="chapter.startMs"
        :min-ms="minStartMs"
        :max-ms="maxStartMs"
        :saved-ms="savedStartMs"
        :snap-ms="snap.targetMs"
        :show-snap="showSnap"
        :boundaries="boundaries"
        :playhead-ms="positionMs"
        :disabled="false"
        @move="handleWaveformMove"
        @commit="handleWaveformCommit"
        @nudge="handleWaveformNudge"
        @seek="handleSeek"
      >
        <template #flag>
          <span
            class="flag relative inline-flex h-[22px] items-center gap-[7px] whitespace-nowrap rounded-md bg-primary px-2 font-mono text-xs font-semibold text-primary-foreground tabular-nums"
          >
            {{ formatChapterClock(chapter.startMs) }}
            <span v-if="moved" class="border-s border-primary-foreground/30 ps-[7px] font-medium">{{ moved }}</span>
          </span>
        </template>
        <template #away="{ side }">
          <button
            v-if="!waveform.loading && !isPlaying"
            class="inline-flex h-[22px] items-center gap-1 rounded-md border border-input bg-card px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="handleBackToCut"
          >
            <ArrowLeft v-if="side === 'before'" class="size-3" aria-hidden="true" />
            {{ t('book.detail.chapters.cut.backToCut') }}
            <ArrowRight v-if="side === 'after'" class="size-3" aria-hidden="true" />
          </button>
        </template>
      </ChapterWaveformStrip>

      <div
        class="stepper grid h-8 grid-cols-4 overflow-hidden rounded-lg border border-input"
        role="group"
        :aria-label="t('book.detail.chapters.cut.move')"
      >
        <button
          v-for="nudge in nudges"
          :key="nudge.deltaMs"
          :data-delta="nudge.deltaMs"
          class="border-s border-input font-mono text-xs tabular-nums transition-colors first:border-s-0 hover:bg-muted focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          :aria-label="nudge.label"
          :title="nudge.label"
          @click="handleNudge"
        >
          {{ nudge.display }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          class="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="isPlaying ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-input hover:bg-muted'"
          :title="isPlaying ? t('book.detail.chapters.cut.stopHint') : t('book.detail.chapters.cut.playCutHint')"
          @click="handlePlayCut"
        >
          <Square v-if="isPlaying" class="size-3.5 fill-current" aria-hidden="true" />
          <Play v-else class="size-3.5" aria-hidden="true" />
          {{ isPlaying ? t('book.detail.chapters.cut.stop') : t('book.detail.chapters.cut.playCut') }}
        </button>

        <button
          v-if="snap.state === 'available' || snap.state === 'unknown'"
          class="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-input px-2.5 text-[12.5px] font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          :disabled="snapping"
          @click="handleSnap"
          @mouseenter="handleSnapShow"
          @mouseleave="handleSnapHide"
          @focus="handleSnapShow"
          @blur="handleSnapHide"
        >
          <Loader2 v-if="snapping" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <Magnet v-else class="size-3.5" aria-hidden="true" />
          {{ t('book.detail.chapters.cut.snap') }}
          <span v-if="snapDelta" class="font-mono text-xs font-semibold tabular-nums">{{ snapDelta }}</span>
        </button>
        <span v-else-if="snap.state === 'on'" class="inline-flex items-center gap-1.5 px-1 text-[12.5px] text-muted-foreground">
          <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
          {{ t('book.detail.chapters.cut.onPause') }}
        </span>
        <span v-else class="inline-flex items-center gap-1.5 px-1 text-[12.5px] text-muted-foreground">
          <Magnet class="size-3.5" aria-hidden="true" />
          {{ t('book.detail.chapters.cut.noPause', { seconds: snapRadiusMs / 1000 }) }}
        </span>
      </div>

      <div class="flex min-w-0 items-center gap-2">
        <button
          class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleRemoveCut"
        >
          <Combine class="size-3.5" aria-hidden="true" />
          {{ t('book.detail.chapters.cut.remove') }}
        </button>
        <span class="min-w-0 truncate text-xs text-muted-foreground">
          {{ t('book.detail.chapters.cut.removeHint', { title, previous: previousTitle }) }}
        </span>
      </div>

      <p class="sr-only" role="status">{{ announcement }}</p>
    </div>

    <div v-else-if="chapter" class="flex items-start gap-2.5 px-3.5 py-3 text-[12.5px] leading-snug text-muted-foreground">
      <Info class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {{ t('book.detail.chapters.cut.first') }}
    </div>

    <!-- The one player: plays from the playhead, which sits on the chosen chapter's start until moved -->
    <div class="flex flex-col gap-3 border-t border-border px-3.5 pb-3.5 pt-3">
      <div class="flex min-w-0 items-center gap-1">
        <button
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('book.detail.chapters.player.back')"
          :title="t('book.detail.chapters.player.back')"
          @click="handleBack"
        >
          <RotateCcw class="size-4" aria-hidden="true" />
        </button>
        <button
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          :aria-label="isPlaying ? t('book.detail.chapters.player.pause') : t('book.detail.chapters.player.play')"
          :title="isPlaying ? t('book.detail.chapters.player.pause') : t('book.detail.chapters.player.play')"
          @click="handleToggle"
        >
          <Loader2 v-if="playerLoading" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <Pause v-else-if="isPlaying" class="size-4 fill-current" aria-hidden="true" />
          <Play v-else class="ms-px size-4 fill-current" aria-hidden="true" />
        </button>
        <button
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('book.detail.chapters.player.forward')"
          :title="t('book.detail.chapters.player.forward')"
          @click="handleForward"
        >
          <RotateCw class="size-4" aria-hidden="true" />
        </button>
        <div class="ms-2.5 flex min-w-0 flex-col gap-[3px]">
          <span class="font-mono text-[13px] font-semibold leading-4 tabular-nums">{{ formatChapterClock(positionMs) }}</span>
          <span class="truncate text-[11.5px] leading-[14px] text-muted-foreground" :title="chapterAtPlayhead?.title">{{
            chapterAtPlayhead?.title
          }}</span>
        </div>
      </div>

      <ChapterTimeline
        :rows="rows"
        :total-duration-ms="totalDurationMs"
        mode="edit"
        :active-key="chapter?.key ?? null"
        :issues-by-key="issuesByKey"
        :playhead-ms="positionMs"
        @seek="handleSeek"
      />

      <div class="grid grid-cols-2 gap-2">
        <button
          class="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-input px-2 text-[12.5px] font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          :disabled="!canMoveCutHere"
          :title="canMoveCutHere ? t('book.detail.chapters.cut.moveHereHint', { time: formatChapterClock(positionMs) }) : undefined"
          @click="handleMoveCutHere"
        >
          <Crosshair class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ t('book.detail.chapters.cut.moveHere') }}</span>
        </button>
        <button
          class="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-input px-2 text-[12.5px] font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :title="t('book.detail.chapters.cut.newChapterHereHint', { time: formatChapterClock(positionMs) })"
          @click="handleNewChapterHere"
        >
          <Scissors class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ t('book.detail.chapters.cut.newChapterHere') }}</span>
        </button>
      </div>
      <p v-if="previous && !playheadInRange" class="text-xs leading-snug text-muted-foreground">
        {{ t('book.detail.chapters.cut.moveHereOutside', { previous: previousTitle, title }) }}
      </p>

      <p v-if="playerError" class="text-[12.5px] text-destructive" role="alert">{{ playerError }}</p>
    </div>
  </section>
</template>

<style scoped>
.cut-card {
  --wave-height: 80px;
}

/* The flag points down at the line it labels. */
.flag::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  translate: -50% 0;
  border: 5px solid transparent;
  border-top-color: var(--primary);
  border-bottom: 0;
}
</style>
