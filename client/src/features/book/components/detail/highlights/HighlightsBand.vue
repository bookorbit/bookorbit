<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnnotationStats } from '@bookorbit/types'

const props = defineProps<{ stats: AnnotationStats | null; activeChapter: string | null }>()
const emit = defineEmits<{ select: [string | null] }>()

const { t } = useI18n()

const chapters = computed(() => props.stats?.chapterBreakdown ?? [])
const max = computed(() => Math.max(1, ...chapters.value.map((chapter) => chapter.count)))
const densest = computed(() =>
  chapters.value.reduce<(typeof chapters.value)[number] | null>((best, c) => (!best || c.count > best.count ? c : best), null),
)

/**
 * The x axis is the book's marked chapters in reading order, not a page scale: a page-accurate
 * axis needs a position for every highlight, and only some formats carry one. Chapter order is
 * the finest granularity every source agrees on.
 */
const bars = computed(() =>
  chapters.value.map((chapter) => ({
    key: chapter.title ?? '',
    title: chapter.title,
    count: chapter.count,
    colour: chapter.colors[0]?.color ?? 'var(--muted-foreground)',
    height: Math.max(10, Math.round((chapter.count / max.value) * 100)),
    active: props.activeChapter === chapter.title,
  })),
)

/** Chapters the reader passed through without marking anything, as a run of empty slots. */
const unmarkedGap = computed(() => {
  const positioned = chapters.value.filter((chapter) => chapter.order != null).map((chapter) => chapter.order as number)
  if (positioned.length < 2) return 0
  let widest = 0
  for (let i = 1; i < positioned.length; i += 1) widest = Math.max(widest, (positioned[i] ?? 0) - (positioned[i - 1] ?? 0) - 1)
  return widest
})

function handleSelect(title: string | null) {
  emit('select', title)
}
</script>

<template>
  <section
    v-if="chapters.length > 0"
    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card px-3 pb-2.5 pt-2"
    :aria-label="t('book.detail.highlights.band.title')"
  >
    <div class="flex h-[15px] flex-none items-center gap-2">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.band.title') }}</h2>
      <p class="hidden truncate text-[11px] text-muted-foreground md:block">{{ t('book.detail.highlights.band.subtitle') }}</p>
    </div>

    <div class="mt-2 flex min-h-0 flex-1 items-end gap-px border-b border-border/70">
      <button
        v-for="bar in bars"
        :key="bar.key"
        type="button"
        class="group relative flex h-full min-w-0 flex-1 items-end rounded-t-sm transition-colors hover:bg-muted/60"
        :title="t('book.detail.highlights.band.barTitle', { chapter: bar.title ?? t('book.detail.highlights.uncategorized'), count: bar.count })"
        :aria-label="t('book.detail.highlights.band.barTitle', { chapter: bar.title ?? t('book.detail.highlights.uncategorized'), count: bar.count })"
        @click="() => handleSelect(bar.title)"
      >
        <span
          class="mx-auto block w-full max-w-7 rounded-t-sm transition-[height]"
          :style="{ height: `${bar.height}%`, background: bar.colour, opacity: bar.active ? 1 : 0.82 }"
        />
        <span v-if="bar.active" class="absolute inset-x-0 -top-1 mx-auto size-1.5 rounded-full bg-primary" aria-hidden="true" />
      </button>
    </div>

    <div class="mt-1.5 flex h-[15px] flex-none items-center gap-3.5 overflow-hidden">
      <span class="whitespace-nowrap text-[10.5px] leading-4 text-muted-foreground">{{ t('book.detail.highlights.band.start') }}</span>
      <span v-if="densest && densest.count > 1" class="hidden truncate text-[10.5px] leading-4 text-muted-foreground sm:inline">
        {{ t('book.detail.highlights.band.densest') }}
        <b class="font-semibold text-foreground">{{ densest.title ?? t('book.detail.highlights.uncategorized') }}</b
        >, {{ t('book.detail.highlights.band.marks', densest.count) }}
      </span>
      <span v-if="unmarkedGap > 1" class="hidden whitespace-nowrap text-[10.5px] leading-4 text-muted-foreground lg:inline">
        {{ t('book.detail.highlights.band.longestGap') }}
        <b class="font-semibold text-foreground">{{ t('book.detail.highlights.band.chapters', unmarkedGap) }}</b>
      </span>
      <span class="ml-auto whitespace-nowrap text-[10.5px] leading-4 text-muted-foreground">{{ t('book.detail.highlights.band.end') }}</span>
    </div>
  </section>
</template>
