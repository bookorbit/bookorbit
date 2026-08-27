<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ANNOTATION_HIGHLIGHT_COLORS, READER_OPENABLE_FORMATS, type AnnotationItem, type BookDetail } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { useDeferredLoading } from '@/composables/useDeferredLoading'
import AnnotationStream from '@/features/annotations/components/shared/AnnotationStream.vue'
import AnnotationEntry from '@/features/annotations/components/shared/AnnotationEntry.vue'
import AnnotationEntryDetail from '@/features/annotations/components/shared/AnnotationEntryDetail.vue'
import { buildHubChips } from '@/features/annotations/lib/hub-chips'
import type { StreamGroup } from '@/features/annotations/lib/stream-groups'
import { useDensity } from '@/features/annotations/composables/useDensity'
import { useBookHighlights } from '@/features/book/composables/useBookHighlights'
import { HIGHLIGHT_VIEW_KEYS, type HighlightViewKey } from '@/features/book/lib/highlight-views'
import HighlightsSideRail from '@/features/book/components/detail/highlights/HighlightsSideRail.vue'
import HighlightsEmptyStage from '@/features/book/components/detail/highlights/HighlightsEmptyStage.vue'

const props = defineProps<{ book: BookDetail }>()

const { t } = useI18n()
const router = useRouter()
const bookIdRef = computed(() => props.book.id)
const hl = useBookHighlights(bookIdRef)
const { density } = useDensity()

/**
 * Same rule as the library hub: the source margin only earns a column when there is room for
 * it and a cursor to scan with, and a 1366px tablet is still a finger.
 */
const stacked = useMediaQuery('(max-width: 1535px), (pointer: coarse)')
const compact = computed(() => density.value === 'compact')

/** Held until the first load settles, so the tab never flashes its empty state on the way in. */
const resolved = ref(false)
watch(hl.loading, (busy) => {
  if (!busy) resolved.value = true
})
const showFirstLoadSkeleton = useDeferredLoading(computed(() => !resolved.value))

const bookTitle = computed(() => props.book.title ?? t('book.detail.highlights.untitled'))
const blank = computed(() => resolved.value && hl.total.value === 0 && !hl.hasActiveFilters.value)
const readableFile = computed(() => props.book.files.find((file) => file.format != null && READER_OPENABLE_FORMATS.has(file.format as never)) ?? null)

const viewOptions = computed(() => HIGHLIGHT_VIEW_KEYS.map((key) => ({ value: key, label: t(`book.detail.highlights.views.${key}`) })))

/** The book's own axes, translated here where the vocabulary lives. */
const groups = computed<StreamGroup[]>(() =>
  hl.streamGroups.value.map((group) => {
    if (group.mode === 'colour') {
      const match = ANNOTATION_HIGHLIGHT_COLORS.find((color) => color.hex === group.key)
      return {
        key: group.key,
        label: match ? t(`annotations.colors.${match.name}`) : group.key,
        swatch: group.key,
        count: group.total,
        items: group.items,
      }
    }
    if (group.mode === 'source') {
      return {
        key: group.key,
        label: t(`annotations.sources.${group.key}`),
        swatch: `var(--pill-${group.key})`,
        count: group.total,
        items: group.items,
      }
    }
    if (group.mode === 'day') {
      const first = group.items[0]
      return {
        key: group.key,
        label: first ? formatDate(new Date(first.createdAt), { day: 'numeric', month: 'long', year: 'numeric' }) : group.key,
        count: group.total,
        items: group.items,
      }
    }
    return { key: group.key, label: group.label ?? t('book.detail.highlights.noChapter'), count: group.total, items: group.items }
  }),
)

const chips = computed(() => {
  const built = buildHubChips(
    { colors: hl.colors.value, styleFilter: 'all', originFilter: 'all', dateFrom: hl.dateFrom.value, dateTo: hl.dateTo.value },
    t,
    (value) => formatDate(new Date(`${value}T00:00:00`), { day: 'numeric', month: 'short', year: 'numeric' }),
  )
  if (hl.chapter.value) built.push({ id: 'chapter', label: hl.chapter.value })
  return built
})

function handleOpen(id: number) {
  if (hl.activeId.value === id) hl.closeInspector()
  else hl.openInspector(id)
}

function handleViewChange(value: string) {
  hl.view.value = value as HighlightViewKey
}

function handleJump(annotation: AnnotationItem) {
  if (!annotation.jumpFileId) return
  const query: Record<string, string> = {}
  const file = props.book.files.find((bookFile) => bookFile.id === annotation.jumpFileId)
  if (file?.format) query.format = file.format
  if (annotation.cfi) query.cfi = annotation.cfi
  else if (annotation.pageno != null) query.page = String(annotation.pageno)
  void router.push({ name: 'reader', params: { bookId: annotation.bookId, fileId: annotation.jumpFileId }, query })
}

function handleOpenReader() {
  const file = readableFile.value
  if (!file) return
  void router.push({ name: 'reader', params: { bookId: props.book.id, fileId: file.id } })
}

function handleToggleDensity() {
  density.value = compact.value ? 'comfortable' : 'compact'
}

function handleRemoveChip(id: string) {
  if (id === 'chapter') hl.setChapterFilter(null)
  else hl.removeFilterChip(id)
}

function handleReviewPositions() {
  hl.onlyNeedsReview.value = true
}

function handleSelectChapter(title: string | null) {
  hl.setChapterFilter(title)
}

async function handleTrash(id: number) {
  await hl.deleteHighlight(id)
}

async function handleUpdateNote(id: number, note: string | null) {
  await hl.updateNote(id, note)
  toast.success(t('annotations.hub.toast.noteSaved'))
}

function handleUpdateColor(id: number, color: string) {
  void hl.updateColor(id, color)
}

function handleUpdateStyle(id: number, style: string) {
  void hl.updateStyle(id, style)
}

async function handleBulkColor(color: string) {
  const affected = await hl.bulkRestyle([...hl.selectedIds.value], { color })
  if (affected > 0) {
    hl.clearSelection()
    toast.success(t('annotations.hub.toast.bulkRecolored', { count: affected }))
  }
}

async function handleBulkTrash() {
  const affected = await hl.bulkTrash([...hl.selectedIds.value])
  if (affected > 0) {
    hl.clearSelection()
    toast.success(t('annotations.hub.toast.bulkTrashed', { count: affected }))
  }
}

function handleExport(format: 'md' | 'csv' | 'json') {
  window.open(`/api/v1/annotations/export?format=${format}&bookId=${props.book.id}`, '_blank')
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (isTypingTarget(event.target)) {
    if (event.key === 'Escape') (event.target as HTMLElement).blur()
    return
  }
  if (event.key === 'j') {
    hl.stepInspector(1)
    event.preventDefault()
  } else if (event.key === 'k') {
    hl.stepInspector(-1)
    event.preventDefault()
  } else if (event.key === 'Escape') {
    hl.closeInspector()
  } else if (event.key === 'x' && hl.activeId.value != null) {
    hl.toggleSelected(hl.activeId.value)
  }
}

function bindShortcuts() {
  window.addEventListener('keydown', handleKeydown)
}

function unbindShortcuts() {
  window.removeEventListener('keydown', handleKeydown)
}

watch(
  () => hl.items.value,
  (items) => {
    if (hl.activeId.value != null && !items.some((item) => item.id === hl.activeId.value)) hl.closeInspector()
  },
)

onMounted(bindShortcuts)
onBeforeUnmount(unbindShortcuts)
onDeactivated(unbindShortcuts)

let activatedBefore = false
onActivated(() => {
  bindShortcuts()
  if (!activatedBefore) {
    activatedBefore = true
    return
  }
  // A sync can add highlights while another tab is open. Silent, because the stream already holds
  // the right rows and a skeleton over them is the flash this avoids.
  void hl.fetchHighlights({ silent: true })
})
</script>

<template>
  <div class="flex flex-col gap-4 xl:h-full xl:min-h-0">
    <div v-if="hl.error.value" role="alert" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ hl.error.value }}
    </div>

    <!-- One placeholder spanning the columns both settled layouts fill, so nothing moves. -->
    <div v-else-if="showFirstLoadSkeleton" class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div class="h-full min-h-[24rem] animate-shimmer rounded-xl bg-muted" />
      <div class="hidden h-full min-h-[24rem] animate-shimmer rounded-xl bg-muted xl:block" />
    </div>

    <div v-else-if="blank" class="flex min-h-0 flex-1 flex-col">
      <HighlightsEmptyStage :book-title="bookTitle" :can-read="readableFile != null" @read="handleOpenReader" />
    </div>

    <!--
      Two surfaces, the same as /annotations. The reading column owns the height; the rail
      hugs its content so a lightly marked book does not print an empty box.
    -->
    <div v-else class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <AnnotationStream
        v-model:search="hl.search.value"
        v-model:colors="hl.colors.value"
        v-model:date-from="hl.dateFrom.value"
        v-model:date-to="hl.dateTo.value"
        class="order-1"
        :groups="groups"
        :loaded-count="hl.items.value.length"
        :total="hl.total.value"
        :view="hl.view.value"
        :view-options="viewOptions"
        :show-book="false"
        :chapter-in-rule="hl.groupMode.value === 'chapter'"
        :stacked="stacked"
        :compact="compact"
        :loading="hl.loading.value"
        :loading-more="hl.loadingMore.value"
        :has-more="hl.hasMore.value"
        :trashed="false"
        :notes-only="hl.onlyNotes.value"
        :needs-review-only="hl.onlyNeedsReview.value"
        :note-count="hl.noteCount.value"
        :review-count="hl.needsReviewCount.value"
        :filtered="hl.hasActiveFilters.value"
        :chips="chips"
        :selection-count="hl.selectedIds.value.size"
        @update:view="handleViewChange"
        @toggle-notes="hl.toggleNotesOnly"
        @toggle-review="hl.toggleNeedsReviewOnly"
        @toggle-density="handleToggleDensity"
        @remove-chip="handleRemoveChip"
        @reset-filters="hl.resetAllFilters"
        @load-more="hl.loadMore"
        @export="handleExport"
        @select-all="hl.selectAllOnPage"
        @clear-selection="hl.clearSelection"
        @bulk-color="handleBulkColor"
        @bulk-trash="handleBulkTrash"
      >
        <template #entry="{ item, showDay, showBook, showChapter }">
          <AnnotationEntry
            :key="item.id"
            :annotation="item"
            :stacked="stacked"
            :selected="hl.selectedIds.value.has(item.id)"
            :selecting="hl.selectedIds.value.size > 0"
            :active="hl.activeId.value === item.id"
            :compact="compact"
            :trashed="false"
            :show-day="showDay"
            :show-book="showBook"
            :show-chapter="showChapter"
            :narrow-margin="true"
            :location-label="item.pageno == null ? null : t('annotations.listItem.pageNumber', { page: item.pageno })"
            @toggle-select="hl.toggleSelected"
            @open="handleOpen"
            @jump="handleJump"
            @trash="handleTrash"
          >
            <template #detail>
              <AnnotationEntryDetail
                v-if="hl.activeItem.value"
                :annotation="hl.activeItem.value"
                :can-jump="hl.activeItem.value.jumpFileId != null"
                :trashed="false"
                @close="hl.closeInspector"
                @jump="handleJump"
                @trash="handleTrash"
                @update-note="handleUpdateNote"
                @update-color="handleUpdateColor"
                @update-style="handleUpdateStyle"
              />
            </template>
          </AnnotationEntry>
        </template>
      </AnnotationStream>

      <HighlightsSideRail
        v-if="hl.stats.value"
        class="order-2 max-h-full"
        :stats="hl.stats.value"
        :chapter-groups="hl.chapterGroups.value"
        :selected-colors="hl.colors.value"
        :selected-chapter="hl.chapter.value"
        :book-title="bookTitle"
        @toggle-color="hl.toggleColorFilter"
        @select-chapter="handleSelectChapter"
        @review-positions="handleReviewPositions"
      />
    </div>
  </div>
</template>
