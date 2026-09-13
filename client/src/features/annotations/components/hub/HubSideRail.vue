<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ChevronRight, Smartphone, Trash2, TriangleAlert } from '@lucide/vue'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubOverview } from '@bookorbit/types'
import { formatNumber, formatRelativeFromNow } from '@/i18n/formatters'
import AnnotationBookThumb from '../AnnotationBookThumb.vue'
import AnnotationActivitySpark from '../shared/AnnotationActivitySpark.vue'

const props = defineProps<{
  overview: AnnotationHubOverview
  selectedColors: string[]
  selectedBookId: number | 'all'
  selectedOrigin: string
  trashOpen: boolean
}>()

const emit = defineEmits<{
  toggleColor: [hex: string]
  toggleOrigin: [origin: string]
  toggleBook: [bookId: number, title: string | null]
  reviewPositions: []
  openTrash: []
}>()

const { t } = useI18n()

const COLOR_PREVIEW = 6

const originTotal = computed(() =>
  Math.max(
    1,
    props.overview.originBreakdown.reduce((sum, entry) => sum + entry.count, 0),
  ),
)
const colors = computed(() => props.overview.colorBreakdown.slice(0, COLOR_PREVIEW))
const overflowColors = computed(() => props.overview.colorBreakdown.length - colors.value.length)
const topBookTitle = computed(() => props.overview.shelf[0]?.bookTitle ?? null)

function colorName(hex: string): string {
  const match = ANNOTATION_HIGHLIGHT_COLORS.find((color) => color.hex === hex)
  return match ? t(`annotations.colors.${match.name}`) : hex
}

function deviceLabel(device: AnnotationHubOverview['devices'][number]): string {
  return device.deviceName ?? t(`annotations.sources.${device.source}`)
}

function handleReview() {
  emit('reviewPositions')
}

function handleOpenTrash() {
  emit('openTrash')
}
</script>

<template>
  <aside class="flex min-h-0 flex-col self-start overflow-hidden rounded-xl border border-border bg-card">
    <header class="flex h-[42px] flex-none items-center gap-2 border-b border-border px-3">
      <h2 class="truncate text-[13px] font-bold text-foreground">
        {{ t('annotations.hub.railTitle', { marks: formatNumber(overview.total), books: formatNumber(overview.books) }) }}
      </h2>
      <button
        v-if="overview.trashed > 0"
        type="button"
        class="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold transition-colors"
        :class="trashOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
        :aria-pressed="trashOpen"
        @click="handleOpenTrash"
      >
        <Trash2 :size="12" />
        {{ formatNumber(overview.trashed) }}
      </button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto xl:overflow-visible">
      <section v-if="overview.weeks.length > 0" class="flex-none border-b border-border px-3 pb-3 pt-2.5">
        <h3 class="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{{ t('annotations.hub.lastTwelveMonths') }}</h3>
        <AnnotationActivitySpark
          :weeks="overview.weeks"
          :busiest-week="overview.busiestWeek"
          :longest-quiet-weeks="overview.longestQuietWeeks"
          :top-book-title="topBookTitle"
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

      <section v-if="overview.originBreakdown.length > 0" class="flex-none border-b border-border px-3 pb-3 pt-2.5">
        <h3 class="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{{ t('annotations.hub.whereFrom') }}</h3>
        <div class="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            v-for="entry in overview.originBreakdown"
            :key="entry.origin"
            class="h-full"
            :style="{ width: `${(entry.count / originTotal) * 100}%`, backgroundColor: `var(--pill-${entry.origin})` }"
          />
        </div>
        <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          <button
            v-for="entry in overview.originBreakdown"
            :key="entry.origin"
            type="button"
            class="-mx-1 inline-flex h-6 items-center gap-1.5 rounded px-1 text-[11.5px] transition-colors"
            :class="selectedOrigin === entry.origin ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="selectedOrigin === entry.origin"
            @click="emit('toggleOrigin', entry.origin)"
          >
            <span class="size-1.5 rounded-full" :style="{ backgroundColor: `var(--pill-${entry.origin})` }" />
            {{ t(`annotations.sources.${entry.origin}`) }}
            <b class="font-semibold text-foreground">{{ formatNumber(entry.count) }}</b>
          </button>
        </div>
        <div
          v-if="overview.needsReview > 0"
          class="mt-2.5 grid grid-cols-[14px_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--pill-repaired)]/30 bg-[var(--pill-repaired)]/10 px-2.5 py-2"
        >
          <TriangleAlert :size="14" class="text-[var(--pill-repaired)]" />
          <div>
            <p class="text-[11.5px] font-bold leading-4 text-foreground">
              {{ t('annotations.hub.anchorsUnplaced', { count: overview.needsReview }) }}
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

      <section v-if="overview.shelf.length > 0" class="flex min-h-0 flex-1 flex-col border-b border-border px-3 pb-3 pt-2.5">
        <h3 class="mb-1.5 flex-none text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{{ t('annotations.hub.theShelf') }}</h3>
        <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <button
            v-for="book in overview.shelf"
            :key="book.bookId"
            type="button"
            class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors"
            :class="selectedBookId === book.bookId ? 'bg-primary/15' : 'hover:bg-muted'"
            :aria-pressed="selectedBookId === book.bookId"
            @click="emit('toggleBook', book.bookId, book.bookTitle)"
          >
            <AnnotationBookThumb :book-id="book.bookId" :title="book.bookTitle" class="h-[39px] w-[26px]" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-[12px] leading-4 text-foreground">{{ book.bookTitle ?? t('annotations.unknownBook') }}</span>
              <span v-if="book.author" class="truncate text-[10.5px] leading-[14px] text-muted-foreground">{{ book.author }}</span>
            </span>
            <span class="text-[11.5px] font-bold text-muted-foreground">{{ formatNumber(book.count) }}</span>
          </button>
        </div>
        <RouterLink
          v-if="overview.books > overview.shelf.length"
          :to="{ name: 'libraries' }"
          class="mt-1 inline-flex h-6 flex-none items-center gap-1 rounded px-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-primary"
        >
          {{ t('annotations.hub.allBooks', { count: overview.books }) }}
          <ChevronRight :size="10" />
        </RouterLink>
      </section>

      <section v-if="overview.devices.length > 0" class="flex-none px-3 pb-3 pt-2.5">
        <h3 class="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{{ t('annotations.hub.devices') }}</h3>
        <div
          v-for="device in overview.devices"
          :key="`${device.source}-${device.deviceId}`"
          class="grid h-6 grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2 border-t border-border/50 first:border-t-0"
        >
          <span class="size-1.5 rounded-full" :class="device.behind === 0 ? 'bg-[var(--pill-success)]' : 'bg-[var(--pill-warning)]'" />
          <span class="flex min-w-0 items-center gap-1.5">
            <Smartphone :size="10" class="shrink-0 text-muted-foreground" />
            <span class="truncate text-[11.5px] leading-4 text-foreground">{{ deviceLabel(device) }}</span>
          </span>
          <span class="whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
            <template v-if="device.behind > 0">{{ t('annotations.hub.behindCount', { count: device.behind }) }} &middot; </template>
            {{ formatRelativeFromNow(new Date(device.lastSyncedAt)) }}
          </span>
        </div>
      </section>
    </div>
  </aside>
</template>
