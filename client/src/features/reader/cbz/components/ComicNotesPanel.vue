<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, Plus, StickyNote, X } from '@lucide/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { formatNumber } from '@/i18n/formatters'
import type { ComicNote } from '../composables/useComicNotes'
import ComicNoteRow from './ComicNoteRow.vue'

const ROW_SIZE = 72

const props = defineProps<{
  notes: readonly ComicNote[]
  total: number
  /** Zero-based pages on screen, in page order. */
  currentPages: readonly number[]
  thumbnailUrl: (page: number) => string
  showClose: boolean
  loading?: boolean
  loadError?: boolean
  loadingMore?: boolean
  hasMore?: boolean
}>()

const emit = defineEmits<{
  add: []
  open: [note: ComicNote]
  edit: [note: ComicNote]
  delete: [note: ComicNote]
  close: []
  retry: []
  loadMore: []
}>()

const { t } = useI18n()
const scroller = ref<{ scrollToItem: (index: number) => void } | null>(null)

const items = computed(() => props.notes.map((note) => ({ id: note.annotation.id, note })))
const count = computed(() => formatNumber(Math.max(props.total, props.notes.length)))

const addLabel = computed(() => {
  const [start, end] = props.currentPages
  if (start === undefined) return t('reader.cbz.notes.addToPage', { page: 1 })
  if (end === undefined) return t('reader.cbz.notes.addToPage', { page: start + 1 })
  return t('reader.cbz.notes.addToPages', { start: start + 1, end: end + 1 })
})

function isCurrent(note: ComicNote) {
  return props.currentPages.includes(note.page)
}

// Opening the panel lands on the notes for the pages on screen, not on page one.
async function revealCurrent() {
  const first = props.currentPages[0]
  if (first === undefined || props.notes.length === 0) return
  const index = props.notes.findIndex((note) => note.page >= first)
  if (index <= 0) return
  await nextTick()
  scroller.value?.scrollToItem(index)
}

onMounted(revealCurrent)
watch(
  () => props.loading,
  (loading, wasLoading) => {
    if (wasLoading && !loading) void revealCurrent()
  },
)

function handleAdd() {
  emit('add')
}

function handleOpen(note: ComicNote) {
  emit('open', note)
}

function handleEdit(note: ComicNote) {
  emit('edit', note)
}

function handleDelete(note: ComicNote) {
  emit('delete', note)
}

function handleClose() {
  emit('close')
}

function handleRetry() {
  emit('retry')
}

function handleLoadMore() {
  emit('loadMore')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="comic-notes-panel">
    <div class="flex shrink-0 items-center gap-2 ps-4 pe-2" :class="props.showClose ? 'h-12 border-b border-border' : 'pb-2'">
      <h2 class="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-semibold text-foreground">
        <span>{{ t('reader.cbz.notes.title') }}</span>
        <span v-if="!props.loading && !props.loadError" class="text-xs font-medium tabular-nums text-muted-foreground">{{ count }}</span>
      </h2>
      <button
        v-if="props.showClose"
        type="button"
        class="viewer-btn focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        :aria-label="t('reader.cbz.notes.close')"
        :title="t('reader.cbz.notes.close')"
        @click="handleClose"
      >
        <X :size="17" />
      </button>
    </div>

    <div class="shrink-0 px-3 py-3" :class="props.showClose ? 'border-b border-border' : 'pt-0'">
      <button
        type="button"
        class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
        :disabled="props.currentPages.length === 0"
        data-testid="comic-note-add"
        @click="handleAdd"
      >
        <Plus :size="16" aria-hidden="true" />
        {{ addLabel }}
      </button>
    </div>

    <div v-if="props.loadError" class="px-4 py-8 text-center" role="alert">
      <p class="text-xs text-destructive">{{ t('reader.cbz.notes.loadError') }}</p>
      <button
        type="button"
        class="mt-3 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
        @click="handleRetry"
      >
        {{ t('reader.retry') }}
      </button>
    </div>
    <div v-else-if="props.loading" class="flex flex-1 items-center justify-center text-muted-foreground" role="status">
      <LoaderCircle :size="22" class="animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('reader.cbz.notes.loading') }}</span>
    </div>
    <div v-else-if="props.notes.length === 0" class="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <StickyNote :size="20" class="text-muted-foreground" aria-hidden="true" />
      <p class="text-sm font-medium text-foreground">{{ t('reader.cbz.notes.empty') }}</p>
      <p class="text-xs text-muted-foreground">{{ t('reader.cbz.notes.emptyHint') }}</p>
    </div>
    <RecycleScroller
      v-else
      ref="scroller"
      v-slot="{ item }"
      class="min-h-0 min-w-0 flex-1 overflow-x-hidden px-2 py-2"
      :items="items"
      :item-size="ROW_SIZE"
      key-field="id"
      data-testid="comic-notes-list"
    >
      <ComicNoteRow
        :note="item.note"
        :thumbnail-url="props.thumbnailUrl(item.note.page)"
        :current="isCurrent(item.note)"
        @open="handleOpen"
        @edit="handleEdit"
        @delete="handleDelete"
      />
    </RecycleScroller>

    <button
      v-if="props.hasMore && !props.loadError && !props.loading"
      type="button"
      class="m-2 shrink-0 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
      :disabled="props.loadingMore"
      @click="handleLoadMore"
    >
      {{ props.loadingMore ? t('reader.cbz.notes.loadingMore') : t('reader.cbz.notes.loadMore') }}
    </button>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
