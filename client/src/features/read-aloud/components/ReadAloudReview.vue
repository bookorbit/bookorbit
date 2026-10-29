<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AudioLines, ChevronDown, CircleCheck, CircleMinus, CircleHelp, Loader2, TriangleAlert } from '@lucide/vue'
import { readAloudChapterLabel, type ReadAloudChapterReport, type ReadAloudDecisions, type ReadAloudJob } from '@bookorbit/types'
import { formatPercent } from '@/i18n/formatters'
import { chapterStatusKey, OUTSIDE_NARRATION_STATUS_KEY } from '../lib/read-aloud'
import type { ReadAloudAction } from '../composables/useReadAloud'
import { useReadAloudReport } from '../composables/useReadAloudReport'
import ReadAloudInlineConfirm from './ReadAloudInlineConfirm.vue'

const props = defineProps<{
  job: ReadAloudJob
  action: ReadAloudAction | null
  /** The chapter table of a finished job: no choices to make, nothing to re-sync. */
  readonly?: boolean
}>()
const emit = defineEmits<{ resync: [decisions: ReadAloudDecisions]; publish: []; discard: [] }>()

const { t } = useI18n()
const ids = useId()
const jobId = computed(() => props.job.id)
const { report, loading, failed, reload } = useReadAloudReport(jobId)

/** Chapters the user flipped, keyed by href: true to include, false to exclude. Only real changes are kept. */
const overrides = ref<Record<string, boolean>>({})
const expanded = ref<Set<string>>(new Set())

watch(jobId, () => {
  overrides.value = {}
  expanded.value = new Set()
})

const canManage = computed(() => props.job.canManage && !props.readonly)
const busy = computed(() => props.action !== null)

function baselineIncluded(chapter: ReadAloudChapterReport): boolean {
  const decision = props.job.decisions.chapters[chapter.href] ?? chapter.decision
  if (decision === 'excluded') return false
  if (decision === 'included' || decision === 'approved') return true
  return chapter.status !== 'excluded'
}

function zoneLabel(zone: ReadAloudChapterReport['zone']): string | null {
  if (zone === 'front') return t('book.detail.files.readAloud.review.zones.front')
  if (zone === 'body') return t('book.detail.files.readAloud.review.zones.body')
  if (zone === 'back') return t('book.detail.files.readAloud.review.zones.back')
  return null
}

const rows = computed(() =>
  (report.value?.chapters ?? []).map((chapter) => {
    const baseline = baselineIncluded(chapter)
    const included = overrides.value[chapter.href] ?? baseline
    // Text the audiobook never reads is expected to have no audio, so it is labelled, not flagged.
    const outside = chapter.outsideNarration === true
    return {
      href: chapter.href,
      key: `${chapter.index}:${chapter.href}`,
      title: readAloudChapterLabel(chapter),
      zone: zoneLabel(chapter.zone),
      status: outside ? 'outside' : chapter.status,
      statusLabel: t(outside ? OUTSIDE_NARRATION_STATUS_KEY : chapterStatusKey(chapter.status)),
      matched: chapter.sentenceCount > 0 ? formatPercent(chapter.matchedSentenceCount / chapter.sentenceCount) : null,
      // Front and back matter that aligned cleanly needs no decision; everything else may.
      toggleable: canManage.value && (chapter.zone === 'body' || chapter.status !== 'aligned'),
      included,
      attention: included && !outside && (chapter.status === 'not-found' || chapter.status === 'too-short'),
      preview: chapter.preview,
      firstMatch: chapter.firstMatch,
      lastMatch: chapter.lastMatch,
    }
  }),
)

const changedCount = computed(() => Object.keys(overrides.value).length)
const attentionCount = computed(() => rows.value.filter((row) => row.attention).length)

function toggleChapter(href: string): void {
  const chapter = report.value?.chapters.find((entry) => entry.href === href)
  if (!chapter) return
  const baseline = baselineIncluded(chapter)
  const nextIncluded = !(overrides.value[href] ?? baseline)
  const next = { ...overrides.value }
  if (nextIncluded === baseline) delete next[href]
  else next[href] = nextIncluded
  overrides.value = next
}

function toggleText(href: string): void {
  const next = new Set(expanded.value)
  if (next.has(href)) next.delete(href)
  else next.add(href)
  expanded.value = next
}

/** The job's own decisions with this review's changes on top, so earlier choices survive a second re-sync. */
function buildDecisions(): ReadAloudDecisions {
  const chapters = { ...props.job.decisions.chapters }
  for (const [href, included] of Object.entries(overrides.value)) chapters[href] = included ? 'included' : 'excluded'
  return { chapters, audio: props.job.decisions.audio.map((entry) => ({ ...entry })) }
}

function handleResync(): void {
  if (changedCount.value === 0 || busy.value) return
  emit('resync', buildDecisions())
}

function handlePublish(): void {
  if (busy.value) return
  emit('publish')
}

function handleDiscard(): void {
  emit('discard')
}

function handleReload(): void {
  void reload()
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div v-if="loading" class="flex flex-col gap-1.5" role="status" :aria-label="t('book.detail.files.readAloud.review.loading')">
      <span v-for="index in 3" :key="index" class="block h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
    </div>

    <p v-else-if="failed && !report" class="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
      {{ t('book.detail.files.readAloud.review.loadFailed') }}
      <button
        type="button"
        class="rounded font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleReload"
      >
        {{ t('book.detail.files.readAloud.review.tryAgain') }}
      </button>
    </p>

    <p v-else-if="report && readonly && rows.length === 0" class="text-[12.5px] text-muted-foreground">
      {{ t('book.detail.files.readAloud.review.noReport') }}
    </p>

    <template v-else-if="report">
      <p class="text-[12.5px] text-muted-foreground">
        {{ t('book.detail.files.readAloud.review.summary', { count: rows.length, attention: attentionCount }) }}
      </p>

      <div class="overflow-hidden rounded-lg border border-border">
        <div class="review-row review-head border-b border-border bg-muted/40 px-2.5 py-1.5" aria-hidden="true">
          <span />
          <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{
            t('book.detail.files.readAloud.review.chapter')
          }}</span>
          <span class="review-col text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{
            t('book.detail.files.readAloud.review.part')
          }}</span>
          <span class="review-col text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{
            t('book.detail.files.readAloud.review.statusLabel')
          }}</span>
          <span class="review-col text-end text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{
            t('book.detail.files.readAloud.review.matched')
          }}</span>
          <span />
        </div>

        <ul class="max-h-[26rem] overflow-y-auto" :aria-label="t('book.detail.files.readAloud.review.heading')">
          <li v-for="row in rows" :key="row.key" class="review-row border-b border-border px-2.5 py-2 last:border-b-0">
            <input
              v-if="row.toggleable"
              type="checkbox"
              class="size-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :checked="row.included"
              :aria-label="t('book.detail.files.readAloud.review.include', { title: row.title })"
              :disabled="busy"
              @change="toggleChapter(row.href)"
            />
            <span v-else aria-hidden="true" />

            <span class="min-w-0">
              <span class="block truncate text-[13px]" :class="row.included ? 'text-foreground' : 'text-muted-foreground'" :title="row.title">
                {{ row.title }}
              </span>
              <span class="review-stacked mt-0.5 hidden flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
                <span v-if="row.zone">{{ row.zone }}</span>
                <span v-if="row.zone" aria-hidden="true">·</span>
                <span class="inline-flex items-center gap-1">
                  <CircleCheck v-if="row.status === 'aligned'" class="size-3.5 text-success" aria-hidden="true" />
                  <TriangleAlert
                    v-else-if="row.status === 'not-found' || row.status === 'too-short'"
                    class="size-3.5 text-warning"
                    aria-hidden="true"
                  />
                  <CircleMinus v-else-if="row.status === 'excluded' || row.status === 'outside'" class="size-3.5" aria-hidden="true" />
                  <AudioLines v-else-if="row.status === 'audio-only'" class="size-3.5" aria-hidden="true" />
                  <CircleHelp v-else class="size-3.5" aria-hidden="true" />
                  {{ row.statusLabel }}
                </span>
                <template v-if="row.matched">
                  <span aria-hidden="true">·</span>
                  <span class="tabular-nums">{{ t('book.detail.files.readAloud.review.matchedValue', { percent: row.matched }) }}</span>
                </template>
              </span>
            </span>

            <span class="review-col truncate text-[12.5px] text-muted-foreground">{{ row.zone }}</span>
            <span class="review-col inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-foreground">
              <CircleCheck v-if="row.status === 'aligned'" class="size-3.5 shrink-0 text-success" aria-hidden="true" />
              <TriangleAlert
                v-else-if="row.status === 'not-found' || row.status === 'too-short'"
                class="size-3.5 shrink-0 text-warning"
                aria-hidden="true"
              />
              <CircleMinus
                v-else-if="row.status === 'excluded' || row.status === 'outside'"
                class="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <AudioLines v-else-if="row.status === 'audio-only'" class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <CircleHelp v-else class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="truncate">{{ row.statusLabel }}</span>
            </span>
            <span class="review-col text-end text-[12.5px] tabular-nums text-foreground">
              <template v-if="row.matched">
                <span class="sr-only">{{ t('book.detail.files.readAloud.review.matched') }}</span>
                {{ row.matched }}
              </template>
            </span>

            <button
              type="button"
              class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-expanded="expanded.has(row.href)"
              :aria-controls="`${ids}-${row.key}`"
              :aria-label="
                expanded.has(row.href)
                  ? t('book.detail.files.readAloud.review.hideText', { title: row.title })
                  : t('book.detail.files.readAloud.review.showText', { title: row.title })
              "
              @click="toggleText(row.href)"
            >
              <ChevronDown
                class="size-4 transition-transform motion-reduce:transition-none"
                :class="expanded.has(row.href) ? 'rotate-180' : ''"
                aria-hidden="true"
              />
            </button>

            <div
              v-if="expanded.has(row.href)"
              :id="`${ids}-${row.key}`"
              class="review-text mt-1.5 space-y-1 rounded-md bg-muted/40 px-2.5 py-2 text-[12.5px]"
            >
              <p v-if="row.preview">
                <span class="font-medium text-foreground">{{ t('book.detail.files.readAloud.review.preview') }}:</span>
                <span class="text-muted-foreground"> {{ row.preview }}</span>
              </p>
              <p v-if="row.firstMatch">
                <span class="font-medium text-foreground">{{ t('book.detail.files.readAloud.review.firstMatch') }}:</span>
                <span class="text-muted-foreground"> {{ row.firstMatch }}</span>
              </p>
              <p v-if="row.lastMatch">
                <span class="font-medium text-foreground">{{ t('book.detail.files.readAloud.review.lastMatch') }}:</span>
                <span class="text-muted-foreground"> {{ row.lastMatch }}</span>
              </p>
              <p v-if="!row.preview && !row.firstMatch && !row.lastMatch" class="text-muted-foreground">
                {{ t('book.detail.files.readAloud.review.noText') }}
              </p>
            </div>
          </li>
        </ul>
      </div>
    </template>

    <template v-if="canManage">
      <p v-if="changedCount > 0" class="text-[12.5px] text-muted-foreground">
        {{ t('book.detail.files.readAloud.review.pending', { count: changedCount }) }}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          :class="changedCount > 0 ? 'border border-input text-foreground hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/90'"
          :disabled="busy"
          @click="handlePublish"
        >
          <Loader2 v-if="action === 'publish'" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('book.detail.files.readAloud.review.publishAnyway') }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          :class="changedCount > 0 ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-input text-foreground hover:bg-muted'"
          :disabled="changedCount === 0 || busy"
          @click="handleResync"
        >
          <Loader2 v-if="action === 'resync'" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('book.detail.files.readAloud.review.resync') }}
        </button>
        <ReadAloudInlineConfirm
          v-if="job.cancellable"
          :label="t('book.detail.files.readAloud.review.discard')"
          :prompt="t('book.detail.files.readAloud.review.discardPrompt')"
          :confirm-label="t('book.detail.files.readAloud.review.discard')"
          :keep-label="t('book.detail.files.readAloud.review.keep')"
          :busy="action === 'cancel'"
          :disabled="busy && action !== 'cancel'"
          @confirm="handleDiscard"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * Columns while the tab can hold them; below that each chapter goes two-line, its part, status and
 * match rate under the title, like the file rows beside it.
 */
.review-row {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr) 6.5rem 10rem 3.75rem 1.75rem;
  align-items: center;
  column-gap: 0.625rem;
}

.review-text {
  grid-column: 2 / -1;
}

@container filestab (max-width: 48rem) {
  .review-row {
    grid-template-columns: 1rem minmax(0, 1fr) 1.75rem;
    align-items: start;
  }

  .review-row .review-col {
    display: none;
  }

  .review-row .review-stacked {
    display: flex;
  }

  .review-head {
    display: none;
  }
}
</style>
