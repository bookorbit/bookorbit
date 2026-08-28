<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from '@lucide/vue'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationStats } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import AnnotationActivitySpark from '@/features/annotations/components/shared/AnnotationActivitySpark.vue'
import { busiestWeek, foldDaysIntoWeeks, longestQuietWeeks } from '@/features/book/lib/highlight-activity'
import type { HighlightGroup } from '@/features/book/lib/highlight-groups'

const props = defineProps<{
  stats: AnnotationStats
  /** Chapter groups in reading order, carrying counts from the server aggregate. */
  chapterGroups: HighlightGroup[]
  selectedColors: string[]
  selectedChapter: string
  bookTitle: string
}>()

const emit = defineEmits<{
  toggleColor: [hex: string]
  selectChapter: [title: string | null]
  reviewPositions: []
}>()

const { t } = useI18n()

const COLOR_PREVIEW = 6

const weeks = computed(() => foldDaysIntoWeeks(props.stats.activity))
const originTotal = computed(() =>
  Math.max(
    1,
    props.stats.originBreakdown.reduce((sum, entry) => sum + entry.count, 0),
  ),
)
const colors = computed(() => props.stats.colorBreakdown.slice(0, COLOR_PREVIEW))
const overflowColors = computed(() => props.stats.colorBreakdown.length - colors.value.length)
const markedChapters = computed(() => props.chapterGroups.filter((group) => group.total > 0))
const maxChapterCount = computed(() => Math.max(1, ...markedChapters.value.map((group) => group.total)))

function colorName(hex: string): string {
  const match = ANNOTATION_HIGHLIGHT_COLORS.find((color) => color.hex === hex)
  return match ? t(`annotations.colors.${match.name}`) : hex
}

function chapterLabel(group: HighlightGroup): string {
  return group.label ?? t('book.detail.highlights.noChapter')
}

function isSelected(group: HighlightGroup): boolean {
  return group.label != null && props.selectedChapter === group.label
}

function handleReview() {
  emit('reviewPositions')
}
</script>

<template>
  <aside class="flex min-h-0 flex-col self-start overflow-hidden rounded-xl border border-border bg-card">
    <header class="flex h-[42px] flex-none items-center gap-2 border-b border-border px-3">
      <h2 class="truncate text-[13px] font-bold text-foreground">
        {{
          t('book.detail.highlights.railTitle', { marks: formatNumber(stats.totalHighlights), chapters: formatNumber(stats.chaptersWithHighlights) })
        }}
      </h2>
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto xl:overflow-visible">
      <section v-if="weeks.length > 0" class="flex-none border-b border-border px-3 pb-3 pt-2.5">
        <h3 class="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{{ t('book.detail.highlights.whenMarked') }}</h3>
        <AnnotationActivitySpark
          :weeks="weeks"
          :busiest-week="busiestWeek(weeks)"
          :longest-quiet-weeks="longestQuietWeeks(weeks)"
          :top-book-title="null"
        />
      </section>

      <section v-if="colors.length > 0" class="flex-none border-b border-border px-3 pb-3 pt-2.5">
        <h3 class="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{{ t('annotations.hub.colour') }}</h3>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="entry in colors"
            :key="entry.color"
            type="button"
            class="inline-flex h-6 items-center gap-1.5 rounded-md border py-0 pl-1.5 pr-2 text-[11.5px] font-semibold transition-colors"
            :class="
              selectedColors.includes(entry.color)
                ? 'border-primary/50 bg-primary/15 text-foreground'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            "
            :aria-pressed="selectedColors.includes(entry.color)"
            @click="emit('toggleColor', entry.color)"
          >
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: entry.color }" />
            {{ colorName(entry.color) }}
            {{ formatNumber(entry.count) }}
          </button>
          <span
            v-if="overflowColors > 0"
            class="inline-flex h-6 items-center rounded-md border border-border bg-muted/40 px-2 text-[11.5px] font-semibold text-muted-foreground"
          >
            +{{ overflowColors }}
          </span>
        </div>
      </section>

      <section v-if="stats.originBreakdown.length > 0" class="flex-none border-b border-border px-3 pb-3 pt-2.5">
        <h3 class="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{{ t('annotations.hub.whereFrom') }}</h3>
        <div class="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            v-for="entry in stats.originBreakdown"
            :key="entry.origin"
            class="h-full"
            :style="{ width: `${(entry.count / originTotal) * 100}%`, backgroundColor: `var(--pill-${entry.origin})` }"
          />
        </div>
        <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          <span
            v-for="entry in stats.originBreakdown"
            :key="entry.origin"
            class="inline-flex h-6 items-center gap-1.5 text-[11.5px] text-muted-foreground"
          >
            <span class="size-1.5 rounded-full" :style="{ backgroundColor: `var(--pill-${entry.origin})` }" />
            {{ t(`annotations.sources.${entry.origin}`) }}
            <b class="font-semibold text-foreground">{{ formatNumber(entry.count) }}</b>
          </span>
        </div>
        <div
          v-if="stats.highlightsNeedingReview > 0"
          class="mt-2.5 grid grid-cols-[14px_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--pill-repaired)]/30 bg-[var(--pill-repaired)]/10 px-2.5 py-2"
        >
          <TriangleAlert :size="14" class="text-[var(--pill-repaired)]" />
          <div>
            <p class="text-[11.5px] font-bold leading-4 text-foreground">
              {{ t('annotations.hub.anchorsUnplaced', { count: stats.highlightsNeedingReview }) }}
            </p>
            <button
              type="button"
              class="-mx-1 mt-0.5 inline-flex h-6 items-center rounded px-1 text-[11.5px] font-semibold text-[var(--pill-repaired)] underline underline-offset-2"
              @click="handleReview"
            >
              {{ t('annotations.hub.reviewThem') }}
            </button>
          </div>
        </div>
      </section>

      <!-- Chapters take the place the library hub gives its shelf: the book's own index. -->
      <section v-if="markedChapters.length > 0" class="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2.5">
        <h3 class="mb-1.5 flex-none text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {{ t('book.detail.highlights.chapters') }}
        </h3>
        <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <button
            v-for="group in markedChapters"
            :key="group.key"
            type="button"
            class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors"
            :class="isSelected(group) ? 'bg-primary/15' : 'hover:bg-muted'"
            :aria-pressed="isSelected(group)"
            @click="emit('selectChapter', group.label)"
          >
            <span class="flex min-w-0 flex-col gap-1">
              <span class="truncate text-[12px] leading-4 text-foreground">{{ chapterLabel(group) }}</span>
              <span class="flex h-1 overflow-hidden rounded-full bg-muted" :style="{ width: `${(group.total / maxChapterCount) * 100}%` }">
                <span
                  v-for="entry in group.colours"
                  :key="entry.color"
                  class="h-full"
                  :style="{ width: `${(entry.count / group.total) * 100}%`, backgroundColor: entry.color }"
                />
              </span>
            </span>
            <span class="text-[11.5px] font-bold text-muted-foreground">{{ formatNumber(group.total) }}</span>
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>
