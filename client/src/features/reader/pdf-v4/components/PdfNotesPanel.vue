<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, Search, StickyNote } from '@lucide/vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationItem } from '@bookorbit/types'
import PdfNoteCard from './PdfNoteCard.vue'

const props = defineProps<{
  annotations: AnnotationItem[]
  loadError?: boolean
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
}>()

const emit = defineEmits<{
  navigate: [annotation: AnnotationItem]
  delete: [id: number]
  retry: []
  loadMore: []
}>()

const { t } = useI18n()

const query = ref('')
const colorFilter = ref('all')
const notesOnly = ref(false)

const HIGHLIGHT_COLOR_NAMES: Record<string, string> = Object.fromEntries(
  ANNOTATION_HIGHLIGHT_COLORS.map((color) => [color.hex.toUpperCase(), color.name]),
)

function getHighlightColorLabel(color: string): string {
  const name = HIGHLIGHT_COLOR_NAMES[color.trim().toUpperCase()]
  return name ? t(`annotations.colors.${name}`) : t('reader.sidebar.customColor', { color })
}

const colorOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const annotation of props.annotations) counts.set(annotation.color, (counts.get(annotation.color) ?? 0) + 1)
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, label: getHighlightColorLabel(hex) }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const notedCount = computed(() => props.annotations.filter((annotation) => annotation.note?.trim()).length)

const filtered = computed(() => {
  const search = query.value.trim().toLowerCase()
  return props.annotations
    .filter((annotation) => {
      if (colorFilter.value !== 'all' && annotation.color !== colorFilter.value) return false
      if (notesOnly.value && !annotation.note?.trim()) return false
      if (!search) return true
      return `${annotation.text} ${annotation.note ?? ''}`.toLowerCase().includes(search)
    })
    .sort((a, b) => {
      const pageA = a.pdf?.page ?? a.pageno ?? 0
      const pageB = b.pdf?.page ?? b.pageno ?? 0
      if (pageA !== pageB) return pageA - pageB
      return (a.pdf?.rect.y ?? 0) - (b.pdf?.rect.y ?? 0)
    })
})

function selectAllColors() {
  colorFilter.value = 'all'
}

function selectColor(hex: string) {
  colorFilter.value = colorFilter.value === hex ? 'all' : hex
}

function toggleNotesOnly() {
  notesOnly.value = !notesOnly.value
}

function handleNavigate(annotation: AnnotationItem) {
  emit('navigate', annotation)
}

function handleDelete(id: number) {
  emit('delete', id)
}

function handleRetry() {
  emit('retry')
}

function handleLoadMore() {
  emit('loadMore')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="props.annotations.length > 0" class="shrink-0 space-y-2 border-b border-border p-3">
      <div class="relative">
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="query"
          type="search"
          :placeholder="t('reader.sidebar.searchHighlights')"
          :aria-label="t('reader.sidebar.searchHighlights')"
          class="h-9 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            colorFilter === 'all'
              ? 'border-primary/45 bg-primary/15 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-pressed="colorFilter === 'all'"
          @click="selectAllColors"
        >
          {{ t('reader.sidebar.allColors') }}
          <span class="tabular-nums opacity-75">{{ props.annotations.length }}</span>
        </button>
        <button
          v-for="option in colorOptions"
          :key="option.hex"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            colorFilter === option.hex
              ? 'border-primary/45 bg-primary/15 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-pressed="colorFilter === option.hex"
          :aria-label="option.label"
          @click="selectColor(option.hex)"
        >
          <span aria-hidden="true" class="size-2.5 rounded-full" :style="{ background: option.hex }" />
          <span class="tabular-nums opacity-75">{{ option.count }}</span>
        </button>
        <button
          v-if="notedCount > 0"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            notesOnly ? 'border-primary/45 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-pressed="notesOnly"
          @click="toggleNotesOnly"
        >
          <StickyNote :size="11" aria-hidden="true" />
          {{ t('reader.sidebar.notesOnly') }}
          <span class="tabular-nums opacity-75">{{ notedCount }}</span>
        </button>
      </div>
    </div>

    <div v-if="props.loadError" class="px-4 py-8 text-center" role="alert" aria-live="assertive">
      <p class="text-xs text-destructive">{{ t('reader.pdf.annotationsLoadError') }}</p>
      <button
        type="button"
        class="mt-3 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        @click="handleRetry"
      >
        {{ t('reader.retry') }}
      </button>
    </div>
    <div v-else-if="props.loading" class="flex flex-1 items-center justify-center text-muted-foreground" role="status" aria-live="polite">
      <LoaderCircle :size="22" class="animate-spin" />
      <span class="sr-only">{{ t('reader.pdf.loadingAnnotations') }}</span>
    </div>
    <p v-else-if="filtered.length === 0" class="px-4 py-8 text-center text-xs text-muted-foreground">
      {{ props.annotations.length === 0 ? t('reader.sidebar.noHighlights') : t('reader.sidebar.noHighlightsMatch') }}
    </p>
    <DynamicScroller
      v-else
      v-slot="{ item, index, active }"
      class="min-h-0 min-w-0 flex-1 overflow-x-hidden p-2"
      :items="filtered"
      :min-item-size="72"
      key-field="id"
      data-testid="pdf-notes-list"
    >
      <DynamicScrollerItem :item="item" :active="active" :data-index="index" :size-dependencies="[item.text, item.note]">
        <PdfNoteCard :annotation="item" @navigate="handleNavigate" @delete="handleDelete" />
      </DynamicScrollerItem>
    </DynamicScroller>

    <button
      v-if="props.hasMore && !props.loadError"
      type="button"
      class="m-2 shrink-0 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
      :disabled="props.loadingMore"
      @click="handleLoadMore"
    >
      {{ props.loadingMore ? t('reader.pdf.loadingMoreAnnotations') : t('reader.pdf.loadMoreAnnotations') }}
    </button>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
