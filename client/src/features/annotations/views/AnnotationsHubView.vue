<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubItem, type AnnotationItem } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import AnnotationStream from '../components/shared/AnnotationStream.vue'
import AnnotationEntry from '../components/shared/AnnotationEntry.vue'
import AnnotationEntryDetail from '../components/shared/AnnotationEntryDetail.vue'
import HubSideRail from '../components/hub/HubSideRail.vue'
import HubEmptyStage from '../components/hub/HubEmptyStage.vue'
import { annotationReaderRoute } from '../lib/annotation-reader-route'
import { buildHubChips } from '../lib/hub-chips'
import { buildHubGroups, HUB_VIEWS, HUB_VIEW_KEYS, type HubViewKey } from '../lib/hub-groups'
import type { StreamGroup } from '../lib/stream-groups'
import { useAnnotationsHub } from '../composables/useAnnotationsHub'
import { useAnnotationsUrlSync } from '../composables/useAnnotationsUrlSync'
import { useDensity } from '../composables/useDensity'

const { t } = useI18n()
const router = useRouter()
const hub = useAnnotationsHub()
useAnnotationsUrlSync(hub)
const { density } = useDensity()

/**
 * The source margin only earns its column when there is room for it and a cursor to scan
 * with. Touch keys off `pointer: coarse` rather than a breakpoint, because a 1366px tablet
 * is still a finger, and the margin becomes a running head above the quote instead.
 *
 * The width threshold is 2xl, not xl: the stream runs about 644px narrower than the
 * viewport, so at 1280 the four-column entry was left with a 239px measure. The side rail
 * still appears at xl - only the entry waits.
 */
const stacked = useMediaQuery('(max-width: 1535px), (pointer: coarse)')
const compact = computed(() => density.value === 'compact')
const activeId = ref<number | null>(null)

const chips = computed(() =>
  buildHubChips(
    {
      colors: hub.colors.value,
      styleFilter: hub.styleFilter.value,
      originFilter: hub.originFilter.value,
      dateFrom: hub.dateFrom.value,
      dateTo: hub.dateTo.value,
    },
    t,
    (value) => formatDate(new Date(`${value}T00:00:00`), { day: 'numeric', month: 'short', year: 'numeric' }),
  ),
)

const viewOptions = computed(() => HUB_VIEW_KEYS.map((key) => ({ value: key, label: t(`annotations.hub.views.${key}`) })))

/** The hub's own axes, translated here where the vocabulary lives. */
const groups = computed<StreamGroup[]>(() =>
  buildHubGroups(hub.items.value, HUB_VIEWS[hub.view.value].group).map((group) => {
    const lead = group.lead
    if (group.mode === 'book') {
      return {
        key: group.key,
        label: lead.bookTitle ?? t('annotations.unknownBook'),
        count: group.items.length,
        book: { bookId: lead.bookId, title: lead.bookTitle ?? t('annotations.unknownBook'), author: lead.author },
        items: group.items,
      }
    }
    if (group.mode === 'color') {
      const match = ANNOTATION_HIGHLIGHT_COLORS.find((color) => color.hex === group.key)
      return {
        key: group.key,
        label: match ? t(`annotations.colors.${match.name}`) : group.key,
        swatch: group.key,
        count: group.items.length,
        items: group.items,
      }
    }
    if (group.mode === 'source') {
      return {
        key: group.key,
        label: t(`annotations.sources.${group.key}`),
        swatch: `var(--pill-${group.key})`,
        count: group.items.length,
        items: group.items,
      }
    }
    return {
      key: group.key,
      label: formatDate(new Date(lead.createdAt), { month: 'long', year: 'numeric' }),
      count: group.items.length,
      items: group.items,
    }
  }),
)

const blank = computed(
  () =>
    !hub.loading.value && hub.items.value.length === 0 && !hub.hasActiveFilters.value && hub.status.value === 'active' && hub.overview.value != null,
)
const activeItem = computed(() => hub.items.value.find((item) => item.id === activeId.value) ?? null)

function canJump(annotation: AnnotationHubItem): boolean {
  return annotation.jumpFileId != null && annotation.jumpFileFormat != null && annotation.deletedAt == null
}

function handleOpen(id: number) {
  activeId.value = activeId.value === id ? null : id
}

function handleCloseDetail() {
  activeId.value = null
}

function handleJump(annotation: AnnotationItem | AnnotationHubItem) {
  const route = annotationReaderRoute(annotation as AnnotationHubItem)
  if (route) void router.push(route)
}

function handleViewChange(value: string) {
  hub.view.value = value as HubViewKey
}

function handleToggleDensity() {
  density.value = compact.value ? 'comfortable' : 'compact'
}

function handleOpenTrash() {
  hub.status.value = hub.status.value === 'trashed' ? 'active' : 'trashed'
}

function handleClearTrash() {
  hub.status.value = 'active'
}

function handleReviewPositions() {
  hub.needsReviewOnly.value = true
}

async function handleTrash(id: number) {
  const ok = await hub.trashOne(id)
  if (ok) {
    if (activeId.value === id) activeId.value = null
    toast.success(t('annotations.hub.toast.movedToTrash'))
  }
}

async function handlePurge(id: number) {
  const result = await hub.purge(id)
  if (result.ok) {
    if (activeId.value === id) activeId.value = null
    toast.success(t('annotations.hub.toast.annotationDeletedForever'))
    return
  }
  toast.error(result.message ?? t('annotations.hub.toast.failedToDelete'))
}

async function handleRestore(id: number) {
  const ok = await hub.restore(id)
  if (ok) toast.success(t('annotations.hub.toast.annotationRestored'))
}

async function handleUpdateNote(id: number, note: string | null) {
  await hub.updateNote(id, note)
  toast.success(t('annotations.hub.toast.noteSaved'))
}

function handleUpdateColor(id: number, color: string) {
  void hub.updateColor(id, color)
}

function handleUpdateStyle(id: number, style: string) {
  void hub.updateStyle(id, style)
}

async function handleBulkColor(color: string) {
  const affected = await hub.bulk('restyle', { color })
  if (affected > 0) toast.success(t('annotations.hub.toast.bulkRecolored', { count: affected }))
}

async function handleBulkTrash() {
  const affected = await hub.bulk('trash')
  if (affected > 0) toast.success(t('annotations.hub.toast.bulkTrashed', { count: affected }))
}

async function handleBulkRestore() {
  const affected = await hub.bulk('restore')
  if (affected > 0) toast.success(t('annotations.hub.toast.bulkRestored', { count: affected }))
}

function handleExport(format: 'md' | 'csv' | 'json') {
  window.open(hub.exportUrl(format), '_blank')
}

watch(
  () => hub.items.value,
  (items) => {
    if (activeId.value != null && !items.some((item) => item.id === activeId.value)) activeId.value = null
  },
)

onMounted(() => {
  void hub.refresh()
})
</script>

<template>
  <div class="flex w-full flex-col gap-4 pt-4 pb-4 xl:h-[calc(100svh-5.25rem)] xl:min-h-0 xl:pb-0">
    <div v-if="hub.error.value" role="alert" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ t('annotations.hub.loadFailed') }}
    </div>

    <HubEmptyStage v-else-if="blank" class="mt-8" />

    <!--
      Two surfaces. The reading column owns the height and is the only thing that scrolls;
      the side rail hugs its content so a thin library never prints an empty box.
    -->
    <div v-else class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <AnnotationStream
        v-model:search="hub.search.value"
        v-model:colors="hub.colors.value"
        v-model:date-from="hub.dateFrom.value"
        v-model:date-to="hub.dateTo.value"
        v-model:style-filter="hub.styleFilter.value"
        v-model:book-filter="hub.bookFilter.value"
        v-model:book-filter-label="hub.selectedBookLabel.value"
        class="order-1"
        :groups="groups"
        :loaded-count="hub.items.value.length"
        :total="hub.total.value"
        :view="hub.view.value"
        :view-options="viewOptions"
        :show-book="true"
        :show-style-filter="true"
        :stacked="stacked"
        :compact="compact"
        :loading="hub.loading.value"
        :loading-more="hub.loadingMore.value"
        :has-more="hub.hasMore.value"
        :trashed="hub.status.value === 'trashed'"
        :notes-only="hub.notesOnly.value"
        :needs-review-only="hub.needsReviewOnly.value"
        :note-count="hub.overview.value?.withNotes ?? 0"
        :review-count="hub.overview.value?.needsReview ?? 0"
        :filtered="hub.hasActiveFilters.value"
        :chips="chips"
        :selection-count="hub.selectedIds.value.size"
        :search-books="hub.searchBooks"
        @update:view="handleViewChange"
        @toggle-notes="hub.toggleNotesOnly"
        @toggle-review="hub.toggleNeedsReviewOnly"
        @toggle-density="handleToggleDensity"
        @remove-chip="hub.removeFilterChip"
        @clear-trash="handleClearTrash"
        @reset-filters="hub.resetAllFilters"
        @load-more="hub.loadMore"
        @export="handleExport"
        @select-all="hub.selectAllOnPage"
        @clear-selection="hub.clearSelection"
        @bulk-color="handleBulkColor"
        @bulk-trash="handleBulkTrash"
        @bulk-restore="handleBulkRestore"
      >
        <template #entry="{ item, showDay, showBook, showChapter }">
          <AnnotationEntry
            :key="item.id"
            :annotation="item"
            :stacked="stacked"
            :selected="hub.selectedIds.value.has(item.id)"
            :selecting="hub.selectedIds.value.size > 0"
            :active="activeId === item.id"
            :compact="compact"
            :trashed="hub.status.value === 'trashed'"
            :show-day="showDay"
            :show-book="showBook"
            :show-chapter="showChapter"
            @toggle-select="hub.toggleSelected"
            @open="handleOpen"
            @jump="handleJump"
            @restore="handleRestore"
            @trash="handleTrash"
            @purge="handlePurge"
          >
            <template #detail>
              <AnnotationEntryDetail
                v-if="activeItem"
                :annotation="activeItem"
                :can-jump="canJump(activeItem)"
                :trashed="hub.status.value === 'trashed'"
                @close="handleCloseDetail"
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

      <HubSideRail
        v-if="hub.overview.value"
        class="order-2 max-h-full"
        :overview="hub.overview.value"
        :selected-colors="hub.colors.value"
        :selected-book-id="hub.bookFilter.value"
        :selected-origin="hub.originFilter.value"
        :trash-open="hub.status.value === 'trashed'"
        @toggle-color="hub.toggleColor"
        @toggle-origin="hub.toggleOrigin"
        @toggle-book="hub.toggleBook"
        @review-positions="handleReviewPositions"
        @open-trash="handleOpenTrash"
      />
    </div>
  </div>
</template>
