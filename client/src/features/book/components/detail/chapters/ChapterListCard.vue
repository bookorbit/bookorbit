<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Check, CircleAlert, Play, TriangleAlert } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import { chapterEndMs, indexAtTime, type ChapterIssue, type DraftChapter } from '@/features/book/lib/chapter-edit'
import { formatChapterClock, formatChapterLength, parseChapterClock } from '@/features/book/lib/chapter-time'

const props = defineProps<{
  rows: DraftChapter[]
  editing: boolean
  activeKey: string | null
  selected: Set<string>
  issuesByKey: Map<string, ChapterIssue[]>
  totalDurationMs: number | null
  /** Where the reader last listened, for the "you are here" marker. */
  listeningMs: number | null
}>()

const emit = defineEmits<{
  activate: [key: string]
  toggleSelect: [key: string, range: boolean]
  updateTitle: [key: string, title: string]
  commitStart: [key: string, startMs: number]
  settle: []
  /** Opens the reader at the row's start. */
  listen: [startMs: number]
}>()

defineSlots<{
  toolbar(): unknown
  band(): unknown
}>()

const { t } = useI18n()

const ISSUE_KEYS: Record<ChapterIssue['code'], string> = {
  emptyTitle: 'book.detail.chapters.issues.emptyTitle',
  firstNotZero: 'book.detail.chapters.issues.firstNotZero',
  notAscending: 'book.detail.chapters.issues.notAscending',
  pastEnd: 'book.detail.chapters.issues.pastEnd',
  tooShort: 'book.detail.chapters.issues.tooShort',
  tooMany: 'book.detail.chapters.issues.tooMany',
  titleTooLong: 'book.detail.chapters.issues.titleTooLong',
  invalidStart: 'book.detail.chapters.issues.invalidStart',
}

const scroller = ref<HTMLElement | null>(null)
const { width: scrollerWidth } = useElementSize(scroller)
/** Too narrow for start, title and actions on one line: the title gets a line of its own. */
const compact = computed(() => scrollerWidth.value > 0 && scrollerWidth.value < 560)
const rowHeight = computed(() => (props.editing ? (compact.value ? 84 : 46) : 40))

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.rows.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => rowHeight.value,
    overscan: 8,
    getItemKey: (index: number) => props.rows[index]?.key ?? index,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
watch(rowHeight, () => virtualizer.value.measure())
const totalSize = computed(() => virtualizer.value.getTotalSize())

const listeningIndex = computed(() => (props.listeningMs === null ? -1 : indexAtTime(props.rows, props.listeningMs)))
const selectionCount = computed(() => props.selected.size)
const total = computed(() => props.totalDurationMs ?? props.rows.at(-1)?.startMs ?? 1)

/** Text typed into a start field, held until Enter or blur so a half-typed clock is never applied. */
const startText = reactive(new Map<string, string>())
const invalidStarts = reactive(new Set<string>())

function row(index: number): DraftChapter {
  return props.rows[index]!
}

function lengthMs(index: number): number | null {
  const end = chapterEndMs(props.rows, index, props.totalDurationMs)
  return end === null ? null : Math.max(0, end - row(index).startMs)
}

function lengthLabel(index: number): string {
  const length = lengthMs(index)
  return length === null ? '' : formatChapterLength(length)
}

/** Where a row stands for the listener: heard, being heard, or ahead. */
function listenState(index: number): 'done' | 'now' | 'ahead' {
  if (props.listeningMs === null) return 'ahead'
  if (index === listeningIndex.value) return 'now'
  return index < listeningIndex.value ? 'done' : 'ahead'
}

function leftInChapter(index: number): string {
  const end = chapterEndMs(props.rows, index, props.totalDurationMs) ?? total.value
  return formatChapterLength(Math.max(0, end - (props.listeningMs ?? 0)))
}

/** The chapter's stretch of the whole book, filled as far as it has been heard. */
function positionStyle(index: number) {
  const start = row(index).startMs
  const length = lengthMs(index) ?? 0
  const state = listenState(index)
  const heard = state === 'done' ? 100 : state === 'now' && length > 0 ? (((props.listeningMs ?? start) - start) / length) * 100 : 0
  return {
    left: `${(start / total.value) * 100}%`,
    width: `${Math.max(0.25, (length / total.value) * 100)}%`,
    background: `linear-gradient(to right, var(--primary) ${heard}%, color-mix(in oklab, var(--foreground) 40%, transparent) ${heard}%)`,
  }
}

function startValue(chapter: DraftChapter): string {
  return startText.get(chapter.key) ?? formatChapterClock(chapter.startMs)
}

function worstIssue(key: string): ChapterIssue | null {
  const issues = props.issuesByKey.get(key)
  if (!issues?.length) return null
  return issues.find((issue) => issue.severity === 'error') ?? issues[0]!
}

function issueText(key: string): string {
  return (props.issuesByKey.get(key) ?? []).map((issue) => t(ISSUE_KEYS[issue.code])).join(' ')
}

function itemStyle(start: number) {
  return { transform: `translateY(${start}px)` }
}

/** Pressing or tabbing into a row makes it the one the cut card edits; nothing in the list moves. */
function activateFromRow(key: string) {
  if (key !== props.activeKey) emit('activate', key)
}

function handleCheck(key: string, event: MouseEvent) {
  emit('toggleSelect', key, event.shiftKey)
}

function handleTitleInput(key: string, event: Event) {
  emit('updateTitle', key, (event.target as HTMLInputElement).value)
}

function handleSettle() {
  emit('settle')
}

function handleStartInput(key: string, event: Event) {
  startText.set(key, (event.target as HTMLInputElement).value)
  invalidStarts.delete(key)
}

function commitStart(key: string) {
  const text = startText.get(key)
  if (text === undefined) return
  const ms = parseChapterClock(text)
  if (ms === null) {
    invalidStarts.add(key)
    return
  }
  startText.delete(key)
  invalidStarts.delete(key)
  emit('commitStart', key, ms)
}

function cancelStart(key: string) {
  startText.delete(key)
  invalidStarts.delete(key)
}

function handleListen(startMs: number) {
  emit('listen', startMs)
}

function scrollToKey(key: string) {
  const index = props.rows.findIndex((candidate) => candidate.key === key)
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'auto' })
}

function commitPendingStarts(): boolean {
  const keys = new Set(props.rows.map((row) => row.key))
  for (const key of startText.keys()) {
    if (keys.has(key)) commitStart(key)
    else cancelStart(key)
  }
  return invalidStarts.size === 0
}

defineExpose({ scrollToKey, commitPendingStarts })
</script>

<template>
  <section
    class="chapter-list flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('book.detail.chapters.heading')"
  >
    <div class="flex min-h-[38px] shrink-0 flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-1.5">
      <h3 class="text-[10.5px] font-bold uppercase leading-none tracking-[0.09em] text-muted-foreground">{{ t('book.detail.chapters.heading') }}</h3>
      <span class="text-[11.5px] leading-none text-muted-foreground tabular-nums">{{ formatNumber(rows.length) }}</span>
      <span v-if="editing && selectionCount > 0" class="text-[11.5px] leading-none text-muted-foreground tabular-nums">
        {{ t('book.detail.chapters.selectedCount', { count: selectionCount }) }}
      </span>
      <div class="ms-auto flex items-center gap-1">
        <slot name="toolbar" />
      </div>
    </div>

    <slot name="band" />

    <div
      v-if="rows.length && !editing"
      class="listen-grid column-heads h-[30px] shrink-0 items-center border-b border-border px-[18px] text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      aria-hidden="true"
    >
      <span class="text-end">#</span>
      <span>{{ t('book.detail.chapters.columns.chapter') }}</span>
      <span class="listen-position">{{ t('book.detail.chapters.columns.inBook') }}</span>
      <span class="listen-start text-end">{{ t('book.detail.chapters.columns.starts') }}</span>
      <span class="text-end">{{ t('book.detail.chapters.columns.length') }}</span>
      <span />
    </div>
    <div
      v-else-if="rows.length && !compact"
      class="column-heads flex h-[30px] shrink-0 items-center gap-2 border-b border-border px-3.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      aria-hidden="true"
    >
      <span class="w-3.5 shrink-0" />
      <span class="w-7 shrink-0 text-end">#</span>
      <span class="w-[7.25rem] shrink-0 ps-[9px]">{{ t('book.detail.chapters.columns.start') }}</span>
      <span class="min-w-0 flex-1 ps-[9px]">{{ t('book.detail.chapters.columns.title') }}</span>
      <span class="w-[3.75rem] shrink-0 text-end">{{ t('book.detail.chapters.columns.length') }}</span>
      <span class="w-5 shrink-0" />
    </div>

    <div ref="scroller" class="chapter-scroller min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
      <div role="list" class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtual in virtualRows"
          :key="String(virtual.key)"
          :data-index="virtual.index"
          role="listitem"
          class="absolute start-0 top-0 w-full py-0.5"
          :style="itemStyle(virtual.start)"
        >
          <!-- Listening: the whole row opens the reader there -->
          <button
            v-if="!editing"
            type="button"
            class="listen-grid listen-row h-9 w-full items-center rounded-[10px] px-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            :class="listenState(virtual.index) === 'now' ? 'bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-muted/55'"
            :aria-label="t('book.detail.chapters.playFrom', { title: row(virtual.index).title })"
            :aria-current="listenState(virtual.index) === 'now' ? 'true' : undefined"
            @click="handleListen(row(virtual.index).startMs)"
          >
            <span class="flex justify-end text-[11.5px] text-muted-foreground tabular-nums">
              <Check v-if="listenState(virtual.index) === 'done'" class="size-[13px]" aria-hidden="true" />
              <template v-else>{{ formatNumber(virtual.index + 1) }}</template>
            </span>
            <span class="listen-title flex min-w-0 items-center gap-2.5">
              <span class="truncate text-[13.5px] leading-tight" :title="row(virtual.index).title">{{ row(virtual.index).title }}</span>
              <span
                v-if="listenState(virtual.index) === 'now'"
                class="inline-flex h-[18px] shrink-0 items-center rounded bg-primary/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-primary"
              >
                {{ t('book.detail.chapters.youAreHere') }}
              </span>
            </span>
            <span class="listen-position relative h-1 rounded-sm bg-foreground/[0.08]" aria-hidden="true">
              <i class="absolute -inset-y-px min-w-[3px] rounded-[3px]" :style="positionStyle(virtual.index)" />
            </span>
            <span class="listen-start text-end font-mono text-xs text-muted-foreground tabular-nums">
              {{ formatChapterClock(row(virtual.index).startMs, { withMs: false }) }}
            </span>
            <span class="whitespace-nowrap text-end text-[12.5px] text-muted-foreground tabular-nums">
              <i18n-t v-if="listenState(virtual.index) === 'now'" keypath="book.detail.chapters.listen.left" scope="global">
                <template #time>
                  <b class="font-semibold text-foreground">{{ leftInChapter(virtual.index) }}</b>
                </template>
              </i18n-t>
              <template v-else>{{ lengthLabel(virtual.index) }}</template>
            </span>
            <span class="listen-play grid size-7 place-items-center rounded-lg text-foreground transition-colors" aria-hidden="true">
              <Play class="size-3.5" />
            </span>
          </button>

          <!-- Editing -->
          <div
            v-else
            class="edit-row flex items-center gap-2 rounded-[10px] px-1.5 transition-colors"
            :class="[
              row(virtual.index).key === activeKey ? 'bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-muted/40',
              compact ? 'compact-row min-h-20 py-1.5' : 'h-[42px]',
            ]"
            :data-row-key="row(virtual.index).key"
            @focusin="activateFromRow(row(virtual.index).key)"
            @pointerdown="activateFromRow(row(virtual.index).key)"
          >
            <input
              type="checkbox"
              class="cell-check size-3.5 shrink-0 accent-[var(--primary)]"
              :checked="selected.has(row(virtual.index).key)"
              :aria-label="t('book.detail.chapters.selectRow', { index: virtual.index + 1 })"
              @click="handleCheck(row(virtual.index).key, $event)"
            />
            <span class="cell-index w-7 shrink-0 text-end text-[11.5px] text-muted-foreground tabular-nums">{{
              formatNumber(virtual.index + 1)
            }}</span>
            <input
              class="cell-start start-input h-8 w-[7.25rem] shrink-0 rounded-lg border bg-background px-2 font-mono text-[12.5px] tabular-nums focus:outline-none focus:ring-2 focus:ring-ring read-only:text-muted-foreground"
              :class="invalidStarts.has(row(virtual.index).key) ? 'border-destructive' : 'border-input'"
              :value="startValue(row(virtual.index))"
              :readonly="virtual.index === 0 && row(virtual.index).startMs === 0"
              inputmode="decimal"
              spellcheck="false"
              :aria-label="t('book.detail.chapters.startOf', { index: virtual.index + 1 })"
              :aria-invalid="invalidStarts.has(row(virtual.index).key) ? 'true' : undefined"
              @input="handleStartInput(row(virtual.index).key, $event)"
              @keydown.enter.prevent="commitStart(row(virtual.index).key)"
              @keydown.esc="cancelStart(row(virtual.index).key)"
              @blur="commitStart(row(virtual.index).key)"
            />
            <input
              class="cell-title h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-ring"
              :value="row(virtual.index).title"
              :placeholder="t('book.detail.chapters.titlePlaceholder')"
              maxlength="500"
              :aria-label="t('book.detail.chapters.titleOf', { index: virtual.index + 1 })"
              @input="handleTitleInput(row(virtual.index).key, $event)"
              @blur="handleSettle"
            />
            <span class="cell-length w-[3.75rem] shrink-0 text-end text-xs text-muted-foreground tabular-nums">{{ lengthLabel(virtual.index) }}</span>
            <span class="cell-issue flex w-5 shrink-0 justify-center">
              <template v-if="worstIssue(row(virtual.index).key)">
                <CircleAlert
                  v-if="worstIssue(row(virtual.index).key)!.severity === 'error'"
                  class="size-4 text-destructive"
                  :aria-label="issueText(row(virtual.index).key)"
                  role="img"
                />
                <TriangleAlert v-else class="size-4 text-warning" :aria-label="issueText(row(virtual.index).key)" role="img" />
                <span class="sr-only">{{ issueText(row(virtual.index).key) }}</span>
              </template>
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* A phone has no pane height to fill, so the list gets its own scroll box for the virtualizer. */
.chapter-scroller {
  max-height: 70svh;
}

.listen-grid {
  display: grid;
  grid-template-columns: 28px minmax(0, 1.2fr) minmax(0, 1fr) 76px 104px 28px;
  column-gap: 14px;
}

.listen-row:hover .listen-play {
  background: var(--muted);
}

@container chapterstab (min-width: 62.5rem) {
  .chapter-list {
    height: 100%;
  }

  .chapter-scroller {
    max-height: none;
  }
}

/* A phone drops the position bar and start time; the "you are here" chip moves under the title. */
@container chapterstab (max-width: 40rem) {
  .listen-grid {
    grid-template-columns: 22px minmax(0, 1fr) auto 28px;
    column-gap: 10px;
  }

  .listen-position,
  .listen-start {
    display: none;
  }

  .listen-row:has([aria-current]),
  .listen-row[aria-current] {
    height: auto;
    min-height: 2.25rem;
    padding-block: 6px;
  }

  .listen-title {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  .listen-title > span:first-child {
    max-width: 100%;
  }
}

/* Start time and actions on the first line, the title across the second. */
.compact-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  align-content: center;
  row-gap: 0.375rem;
}

.compact-row .cell-check {
  grid-area: 1 / 1;
}

.compact-row .cell-index {
  grid-area: 1 / 2;
}

.compact-row .cell-start {
  grid-area: 1 / 3;
  justify-self: start;
}

.compact-row .cell-length {
  grid-area: 1 / 4;
}

.compact-row .cell-issue {
  grid-area: 2 / 1;
}

.compact-row .cell-title {
  grid-area: 2 / 2 / 3 / 5;
}
</style>
