<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { AnnotationItem, BookDetail } from '@bookorbit/types'
import { READER_OPENABLE_FORMATS } from '@bookorbit/types'
import { useBookHighlights } from '@/features/book/composables/useBookHighlights'
import { useDensity } from '@/features/annotations/composables/useDensity'
import { HIGHLIGHT_GROUP_MODES, NO_CHAPTER_KEY, type HighlightGroup } from '@/features/book/lib/highlight-groups'
import HighlightsRail from '@/features/book/components/detail/highlights/HighlightsRail.vue'
import HighlightsStream from '@/features/book/components/detail/highlights/HighlightsStream.vue'
import HighlightsIndex from '@/features/book/components/detail/highlights/HighlightsIndex.vue'
import HighlightsActivity from '@/features/book/components/detail/highlights/HighlightsActivity.vue'
import HighlightInspector from '@/features/book/components/detail/highlights/HighlightInspector.vue'
import HighlightsBand from '@/features/book/components/detail/highlights/HighlightsBand.vue'
import HighlightsEmptyStage from '@/features/book/components/detail/highlights/HighlightsEmptyStage.vue'
import HighlightsShortcutsDialog from '@/features/book/components/detail/highlights/HighlightsShortcutsDialog.vue'

const props = defineProps<{ book: BookDetail }>()

const { t } = useI18n()
const router = useRouter()
const bookIdRef = computed(() => props.book.id)
const hl = useBookHighlights(bookIdRef)
const { density } = useDensity()

/** Below xl the three columns stack, so the inspector takes over the stream the way the Files
 *  tab swaps its tree for a file: a detail panel below a 55-row list is a panel nobody finds. */
const isStacked = useMediaQuery('(max-width: 1279px)')
const shortcutsOpen = ref(false)
const editingNoteId = ref<number | null>(null)

const bookTitle = computed(() => props.book.title ?? t('book.detail.highlights.untitled'))
const blank = computed(() => !hl.loading.value && hl.total.value === 0 && !hl.hasActiveFilters.value)
const stackedDetail = computed(() => isStacked.value && hl.activeItem.value != null)

const readableFile = computed(() => props.book.files.find((file) => file.format != null && READER_OPENABLE_FORMATS.has(file.format as never)) ?? null)
const jumpableIds = computed(() => {
  const ids = new Set<number>()
  for (const item of hl.items.value) if (item.jumpFileId != null) ids.add(item.id)
  return ids
})

const activeGroupKey = computed(() => {
  const active = hl.activeItem.value
  if (!active) return null
  if (hl.groupMode.value === 'colour') return active.color
  return active.chapterTitle ?? NO_CHAPTER_KEY
})

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

function handleOpen(id: number) {
  hl.openInspector(id)
}

function handleCloseInspector() {
  hl.closeInspector()
  editingNoteId.value = null
}

function handleStep(delta: number) {
  hl.stepInspector(delta)
}

function handleEditNote(id: number) {
  hl.openInspector(id)
  editingNoteId.value = id
}

function handleCancelNote() {
  editingNoteId.value = null
}

async function handleUpdateNote(id: number, note: string | null) {
  await hl.updateNote(id, note)
  editingNoteId.value = null
}

function handleRestyle(id: number) {
  hl.openInspector(id)
}

async function handleTrash(id: number) {
  await hl.deleteHighlight(id)
}

function handleSelectGroup(group: HighlightGroup) {
  if (group.mode === 'colour') {
    hl.toggleColorFilter(group.key)
    return
  }
  if (group.mode === 'chapter') {
    hl.setChapterFilter(group.label)
    return
  }
  const first = group.items[0]
  if (first) hl.openInspector(first.id)
}

function handleSelectChapter(title: string | null) {
  hl.setChapterFilter(title)
}

function handleToggleDensity() {
  density.value = density.value === 'comfortable' ? 'compact' : 'comfortable'
}

function handleShowShortcuts() {
  shortcutsOpen.value = true
}

function handleSelectAll() {
  hl.selectAllOnPage()
}

async function handleBulkColor(color: string) {
  const affected = await hl.bulkRestyle([...hl.selectedIds.value], { color })
  if (affected > 0) hl.clearSelection()
}

async function handleBulkTrash() {
  const affected = await hl.bulkTrash([...hl.selectedIds.value])
  if (affected > 0) hl.clearSelection()
}

function handleReviewPositions() {
  hl.onlyNeedsReview.value = true
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
  switch (event.key) {
    case 'j':
      hl.stepInspector(1)
      event.preventDefault()
      break
    case 'k':
      hl.stepInspector(-1)
      event.preventDefault()
      break
    case 'Escape':
      if (shortcutsOpen.value) shortcutsOpen.value = false
      else handleCloseInspector()
      break
    case '?':
      shortcutsOpen.value = true
      event.preventDefault()
      break
    case 'g': {
      const next = (HIGHLIGHT_GROUP_MODES.indexOf(hl.groupMode.value) + 1) % HIGHLIGHT_GROUP_MODES.length
      hl.groupMode.value = HIGHLIGHT_GROUP_MODES[next] ?? 'chapter'
      event.preventDefault()
      break
    }
    case 'x':
      if (hl.activeId.value != null) hl.toggleSelected(hl.activeId.value)
      break
    default:
      break
  }
}

watch(
  () => hl.activeId.value,
  (id) => {
    if (id == null) editingNoteId.value = null
  },
)

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="flex flex-col gap-4 xl:h-full xl:min-h-0">
    <div v-if="hl.error.value" role="alert" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ hl.error.value }}
    </div>

    <div v-if="blank" class="flex min-h-0 flex-1 flex-col">
      <HighlightsEmptyStage :book-title="bookTitle" :can-read="readableFile != null" @read="handleOpenReader" />
    </div>

    <!--
      A+ Ledger. Below xl the tab is a single scrolling column. From xl the pane owns the height:
      the rail, the stream and the index fill row one, and the position band takes row two. The
      side columns hug their content so a lightly marked book does not print two empty boxes.
    -->
    <div
      v-else
      class="flex flex-col gap-4 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[17rem_minmax(0,1fr)_19.25rem] xl:grid-rows-[minmax(0,1fr)_7.25rem] xl:gap-x-[18px] xl:gap-y-[14px]"
    >
      <HighlightsRail
        v-show="!stackedDetail"
        class="order-3 xl:order-none xl:col-start-1 xl:row-start-1 xl:max-h-full xl:self-start"
        :stats="hl.stats.value"
        :total="hl.total.value"
        :chapter-count="null"
        :selected-colors="hl.colors.value"
        :items="hl.items.value"
        :book-title="bookTitle"
        @toggle-color="hl.toggleColorFilter"
        @review-positions="handleReviewPositions"
      />

      <HighlightsStream
        v-model:search="hl.search.value"
        v-model:sort-key="hl.sortKey.value"
        v-model:only-notes="hl.onlyNotes.value"
        v-model:only-needs-review="hl.onlyNeedsReview.value"
        v-model:colors="hl.colors.value"
        v-model:date-from="hl.dateFrom.value"
        v-model:date-to="hl.dateTo.value"
        v-show="!stackedDetail"
        class="order-1 max-h-[34rem] xl:order-none xl:col-start-2 xl:row-start-1 xl:max-h-none"
        :groups="hl.streamGroups.value"
        :total="hl.total.value"
        :loading="hl.loading.value"
        :loading-more="hl.loadingMore.value"
        :has-more="hl.hasMore.value"
        :notes-count="hl.stats.value?.highlightsWithNotes ?? 0"
        :review-count="hl.needsReviewCount.value"
        :selected-ids="hl.selectedIds.value"
        :active-id="hl.activeId.value"
        :density="density"
        :jumpable-ids="jumpableIds"
        :has-active-filters="hl.hasActiveFilters.value"
        :filter-count="hl.popoverFilterCount.value"
        @open="handleOpen"
        @toggle-select="hl.toggleSelected"
        @jump="handleJump"
        @edit-note="handleEditNote"
        @restyle="handleRestyle"
        @trash="handleTrash"
        @load-more="hl.loadMore"
        @toggle-density="handleToggleDensity"
        @show-shortcuts="handleShowShortcuts"
        @select-all="handleSelectAll"
        @clear-selection="hl.clearSelection"
        @bulk-color="handleBulkColor"
        @bulk-trash="handleBulkTrash"
        @clear-filters="hl.clearPopoverFilters"
        @reset-all="hl.resetAllFilters"
      />

      <div
        class="order-2 flex min-h-0 flex-col gap-[14px] xl:order-none xl:col-start-3 xl:row-start-1 xl:max-h-full"
        :class="hl.activeItem.value ? 'xl:self-stretch' : 'xl:self-start'"
      >
        <HighlightInspector
          v-if="hl.activeItem.value"
          class="xl:min-h-0 xl:max-h-none xl:flex-1"
          :annotation="hl.activeItem.value"
          :position="hl.activeIndex.value + 1"
          :total="hl.items.value.length"
          :saving="hl.savingIds.value.has(hl.activeItem.value.id)"
          :can-jump="jumpableIds.has(hl.activeItem.value.id)"
          :editing-note="editingNoteId === hl.activeItem.value.id"
          @close="handleCloseInspector"
          @step="handleStep"
          @jump="handleJump"
          @update-note="handleUpdateNote"
          @update-color="hl.updateColor"
          @update-style="hl.updateStyle"
          @trash="handleTrash"
          @edit-note="handleEditNote"
          @cancel-note="handleCancelNote"
        />
        <template v-if="!hl.activeItem.value">
          <HighlightsIndex
            v-model:mode="hl.groupMode.value"
            class="max-h-80 xl:min-h-0 xl:max-h-none xl:flex-1"
            :groups="hl.groups.value"
            :active-key="activeGroupKey"
            @select="handleSelectGroup"
          />
          <HighlightsActivity :stats="hl.stats.value" />
        </template>
      </div>

      <HighlightsBand
        v-show="!stackedDetail"
        class="order-4 h-32 xl:order-none xl:col-span-full xl:row-start-2 xl:h-auto"
        :stats="hl.stats.value"
        :active-chapter="hl.activeItem.value?.chapterTitle ?? (hl.chapter.value || null)"
        @select="handleSelectChapter"
      />
    </div>

    <HighlightsShortcutsDialog v-model:open="shortcutsOpen" />
  </div>
</template>
