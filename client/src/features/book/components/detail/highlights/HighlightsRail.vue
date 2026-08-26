<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from '@lucide/vue'
import type { AnnotationItem, AnnotationStats } from '@bookorbit/types'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { colorLabel } from '@/features/annotations/lib/filter-options'
import { sourcePill } from '@/features/annotations/lib/pill-styles'
import HighlightsExportMenu from '@/features/book/components/detail/tabs/HighlightsExportMenu.vue'

const props = defineProps<{
  stats: AnnotationStats | null
  total: number
  chapterCount: number | null
  selectedColors: string[]
  items: AnnotationItem[]
  bookTitle: string
}>()

const emit = defineEmits<{ toggleColor: [string]; reviewPositions: [] }>()

const { t } = useI18n()

const colorRows = computed(() => {
  const rows = props.stats?.colorBreakdown ?? []
  const max = Math.max(1, ...rows.map((row) => row.count))
  return rows.map((row) => ({
    ...row,
    label: colorLabel(row.color),
    percent: Math.round((row.count / max) * 100),
    active: props.selectedColors.includes(row.color),
  }))
})

const originRows = computed(() =>
  (props.stats?.originBreakdown ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ ...entry, label: sourcePill(entry.origin).label, share: props.total > 0 ? (entry.count / props.total) * 100 : 0 })),
)

const needsAttention = computed(() =>
  props.items.reduce(
    (acc, item) => {
      if (item.positionStatus === 'failed') acc.failed += 1
      if (item.positionStatus === 'repaired') acc.repaired += 1
      return acc
    },
    { failed: 0, repaired: 0 },
  ),
)
const attentionTotal = computed(() => needsAttention.value.failed + needsAttention.value.repaired)

const activity = computed(() => props.stats?.activity ?? [])
const firstMark = computed(() => activity.value.at(-1)?.day ?? null)
const lastMark = computed(() => activity.value[0]?.day ?? null)

function formatDay(day: string | null): string {
  if (!day) return '-'
  const date = new Date(`${day}T00:00:00`)
  return Number.isNaN(date.getTime()) ? '-' : formatLocaleDate(date, { year: 'numeric', month: 'short', day: 'numeric' })
}

function originStyle(origin: AnnotationItem['origin']) {
  return { background: `var(--pill-${origin})` }
}

function handleColorClick(color: string) {
  emit('toggleColor', color)
}

function handleReviewPositions() {
  emit('reviewPositions')
}
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" :aria-label="t('book.detail.highlights.rail.title')">
    <header class="flex h-[34px] flex-none items-center gap-2 border-b border-border px-3">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.rail.title') }}</h2>
    </header>

    <div
      class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-2.5 [mask-image:linear-gradient(to_bottom,#000_calc(100%-13px),transparent)] [scrollbar-gutter:stable]"
    >
      <div class="flex flex-none items-end gap-1.5">
        <b class="text-[28px] font-bold leading-[0.86] tracking-tight text-foreground tabular-nums">{{ total }}</b>
        <span class="pb-px text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {{ t('book.detail.highlights.rail.unit', total) }}
        </span>
      </div>
      <p class="mt-1.5 text-[11px] leading-[1.45] text-muted-foreground">
        <b class="font-semibold text-foreground">{{ stats?.highlightsWithNotes ?? 0 }}</b>
        {{ t('book.detail.highlights.rail.withNotes') }}
        <span aria-hidden="true"> &middot; </span>
        <b class="font-semibold text-foreground">{{ stats?.chaptersWithHighlights ?? 0 }}</b>
        {{
          chapterCount ? t('book.detail.highlights.rail.ofChaptersMarked', { total: chapterCount }) : t('book.detail.highlights.rail.chaptersMarked')
        }}
      </p>

      <div v-if="colorRows.length > 0" class="mt-2.5 flex-none border-t border-border pt-2">
        <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.rail.colour') }}</h3>
        <div class="-mx-1 flex flex-col">
          <button
            v-for="row in colorRows"
            :key="row.color"
            type="button"
            class="grid h-[22px] grid-cols-[10px_minmax(3.5rem,auto)_minmax(0,1fr)_22px] items-center gap-2 rounded-md px-1 text-left transition-colors pointer-coarse:h-8 hover:bg-muted"
            :class="row.active ? 'bg-primary/15' : ''"
            :aria-pressed="row.active"
            :title="t('book.detail.highlights.rail.showOnly', { colour: row.label })"
            @click="() => handleColorClick(row.color)"
          >
            <span class="size-2.5 rounded-[3px]" :style="{ background: row.color }" aria-hidden="true" />
            <span class="truncate text-[11px] leading-4" :class="row.active ? 'text-foreground' : 'text-muted-foreground'">{{ row.label }}</span>
            <span class="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <i class="block h-full rounded-full" :style="{ width: `${row.percent}%`, background: row.color }" />
            </span>
            <span class="text-right text-[11px] font-bold leading-4 tabular-nums text-foreground">{{ row.count }}</span>
          </button>
        </div>
      </div>

      <div v-if="originRows.length > 0" class="mt-2.5 flex-none border-t border-border pt-2">
        <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.rail.source') }}</h3>
        <div class="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span v-for="row in originRows" :key="row.origin" class="h-full" :style="{ width: `${row.share}%`, ...originStyle(row.origin) }" />
        </div>
        <ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <li v-for="row in originRows" :key="row.origin" class="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span class="size-1.5 rounded-full" :style="originStyle(row.origin)" aria-hidden="true" />
            {{ row.label }}
            <b class="font-semibold text-foreground">{{ row.count }}</b>
          </li>
        </ul>
      </div>

      <div v-if="attentionTotal > 0" class="mt-2.5 flex-none border-t border-border pt-2">
        <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.rail.health') }}</h3>
        <div class="grid grid-cols-[14px_minmax(0,1fr)] gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
          <TriangleAlert class="mt-px size-3.5 text-amber-600 dark:text-amber-400" />
          <div>
            <p class="text-[11px] font-semibold leading-4 text-foreground">{{ t('book.detail.highlights.rail.needsAttention', attentionTotal) }}</p>
            <p class="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
              <template v-if="needsAttention.failed > 0">{{ t('book.detail.highlights.rail.anchorLost', needsAttention.failed) }}</template>
              <template v-if="needsAttention.failed > 0 && needsAttention.repaired > 0">, </template>
              <template v-if="needsAttention.repaired > 0">{{ t('book.detail.highlights.rail.reAnchored', needsAttention.repaired) }}</template>
            </p>
            <button
              type="button"
              class="mt-1 inline-flex h-5 items-center text-[10.5px] font-semibold text-amber-600 underline underline-offset-2 transition-colors pointer-coarse:h-8 hover:text-amber-500 dark:text-amber-400"
              @click="handleReviewPositions"
            >
              {{ t('book.detail.highlights.rail.reviewPositions') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="lastMark" class="mt-2.5 flex-none border-t border-border pt-2">
        <h3 class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.rail.span') }}</h3>
        <dl>
          <div class="grid h-[22px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <dt class="truncate text-[11px] leading-4 text-muted-foreground">{{ t('book.detail.highlights.rail.firstMark') }}</dt>
            <dd class="text-[11px] font-semibold leading-4 text-foreground">{{ formatDay(firstMark) }}</dd>
          </div>
          <div class="grid h-[22px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border/60">
            <dt class="truncate text-[11px] leading-4 text-muted-foreground">{{ t('book.detail.highlights.rail.lastMark') }}</dt>
            <dd class="text-[11px] font-semibold leading-4 text-foreground">{{ formatDay(lastMark) }}</dd>
          </div>
          <div class="grid h-[22px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border/60">
            <dt class="truncate text-[11px] leading-4 text-muted-foreground">{{ t('book.detail.highlights.rail.markingDays') }}</dt>
            <dd class="text-[11px] font-semibold leading-4 tabular-nums text-foreground">{{ activity.length }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div v-if="items.length > 0" class="flex flex-none items-center border-t border-border px-3 py-2">
      <HighlightsExportMenu :items="items" :book-title="bookTitle" :label="t('book.detail.highlights.rail.exportCount', { count: items.length })" />
    </div>
  </section>
</template>
