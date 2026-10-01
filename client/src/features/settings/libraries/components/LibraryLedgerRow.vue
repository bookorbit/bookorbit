<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import type { Library, LibraryAccessEntry, LibraryOverviewEntry, LibraryScanHistoryEntry, ScanProgressEvent } from '@bookorbit/types'
import type { LibraryCreatorSectionId } from '@/features/library/composables/useLibraryCreator'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { libraryProblem } from '../lib/library-problems'
import LibraryAutomationList, { type AutomationToggle } from './LibraryAutomationList.vue'
import LibraryDetailPanel from './LibraryDetailPanel.vue'
import LibraryFormatBar from './LibraryFormatBar.vue'
import LibraryIdentity from './LibraryIdentity.vue'
import LibraryProblemStrip from './LibraryProblemStrip.vue'
import LibraryRowActions from './LibraryRowActions.vue'
import LibraryScanCell from './LibraryScanCell.vue'

const props = defineProps<{
  library: Library
  entry: LibraryOverviewEntry | undefined
  overviewLoaded: boolean
  expanded: boolean
  progress: ScanProgressEvent | undefined
  scanning: boolean
  refreshingCovers: boolean
  syncingFiles: boolean
  savingAutomation: boolean
  justFinished: boolean
  history: LibraryScanHistoryEntry[] | null
  access: LibraryAccessEntry[] | null
  detailLoading: boolean
  detailFailed: boolean
}>()

const emit = defineEmits<{
  toggle: [library: Library]
  scan: [library: Library]
  edit: [library: Library, section?: LibraryCreatorSectionId]
  refreshCovers: [library: Library]
  syncFiles: [library: Library]
  remove: [library: Library]
  duplicate: [library: Library]
  toggleSetting: [library: Library, setting: AutomationToggle]
  setSchedule: [library: Library, cron: string | null]
}>()

const { t } = useI18n()

const totalBooks = computed(() => props.entry?.totalBooks ?? 0)
const panelId = computed(() => `library-detail-${props.library.id}`)
const historyOpen = ref(false)

const problem = computed(() => (props.overviewLoaded ? libraryProblem(props.entry?.lastScan, props.scanning) : null))

/** Failed and never-scanned libraries are outlined so the list reads at a glance. */
const accent = computed(() => {
  if (props.expanded) return 'border-primary/40'
  if (!props.overviewLoaded || props.scanning) return 'border-border'
  const lastScan = props.entry?.lastScan
  if (!lastScan) return 'border-[var(--pill-warning)]/45'
  if (lastScan.status === 'failed') return 'border-destructive/45'
  return 'border-border hover:border-foreground/15'
})

function requestToggle() {
  emit('toggle', props.library)
}

const ROW_CLICK_IGNORED = 'a, button, input, select, textarea, [role="menu"], [role="dialog"], [data-row-ignore]'

/**
 * A click on the row's empty space opens the details, the way the chevron does. Anything interactive
 * inside keeps its own click, and the open panel is left alone so selecting its text never collapses it.
 * Keyboard users keep the chevron, which is the accessible control.
 *
 * The check reads the event's dispatch path, not `target.closest()`: Vue can re-render between listeners
 * of one click, and a clicked icon that was swapped out is detached, so it no longer has a button above it.
 */
function handleRowClick(event: MouseEvent) {
  const path = event.composedPath()
  const row = event.currentTarget
  for (const node of path) {
    if (node === row) break
    if (node instanceof Element && node.matches(ROW_CLICK_IGNORED)) return
  }
  if (window.getSelection()?.toString()) return
  emit('toggle', props.library)
}

function forwardEdit(library: Library, section?: LibraryCreatorSectionId) {
  emit('edit', library, section)
}

function forwardScan(library: Library) {
  emit('scan', library)
}

function forwardRefreshCovers(library: Library) {
  emit('refreshCovers', library)
}

function forwardSyncFiles(library: Library) {
  emit('syncFiles', library)
}

function forwardRemove(library: Library) {
  emit('remove', library)
}

function forwardDuplicate(library: Library) {
  emit('duplicate', library)
}

function forwardToggleSetting(library: Library, setting: AutomationToggle) {
  emit('toggleSetting', library, setting)
}

function forwardSetSchedule(library: Library, cron: string | null) {
  emit('setSchedule', library, cron)
}

function editSchedule(library: Library) {
  emit('edit', library, 'schedule')
}

/** Waits a frame so the closing menu hands focus back before the popover takes it. */
function openHistory() {
  requestAnimationFrame(() => {
    historyOpen.value = true
  })
}
</script>

<template>
  <div
    class="overflow-hidden rounded-xl border bg-card shadow-xs transition-colors"
    :class="[accent, justFinished ? 'library-row-finished' : '']"
    data-testid="library-row"
    @click="handleRowClick"
  >
    <!-- Four zones on one grid, vertically centred so the shorter ones never leave a void. -->
    <div class="grid min-h-24 cursor-pointer grid-cols-[minmax(0,1fr)_16.75rem_19.75rem_14.5rem] items-center gap-7 py-[15px] pe-5 ps-3.5">
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          data-testid="library-row-toggle"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="expanded ? 'bg-primary/14 text-primary' : ''"
          :aria-expanded="expanded"
          :aria-controls="panelId"
          :aria-label="t('settings.admin.libraries.toggleDetail', { name: library.name })"
          @click="requestToggle"
        >
          <ChevronRight
            :size="14"
            class="transition-transform duration-150 motion-reduce:transition-none"
            :class="expanded ? 'rotate-90' : ''"
            aria-hidden="true"
          />
        </button>
        <LibraryIdentity class="min-w-0 flex-1" :library="library" prominent />
      </div>

      <div>
        <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span class="text-2xl font-semibold leading-none tracking-tight tabular-nums text-foreground">{{ formatNumber(totalBooks) }}</span>
          <span class="text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.booksUnit', { count: totalBooks }) }}</span>
          <span class="text-[12.5px] tabular-nums text-muted-foreground">{{ formatBytes(entry?.totalSizeBytes ?? 0) }}</span>
        </p>
        <LibraryFormatBar class="mt-2.5" show-legend legend-reserve :counts="entry?.formatCounts ?? {}" :legend-limit="5" />
      </div>

      <LibraryAutomationList
        :library="library"
        interactive
        :saving="savingAutomation"
        @toggle="forwardToggleSetting"
        @set-schedule="forwardSetSchedule"
        @edit-schedule="editSchedule"
      />

      <div class="flex w-full flex-col gap-2.5">
        <LibraryScanCell
          v-model:history-open="historyOpen"
          :library="library"
          :last-scan="entry?.lastScan ?? null"
          :progress="progress"
          :pending="!overviewLoaded"
          with-history
          @scan="forwardScan"
        />
        <LibraryRowActions
          :library="library"
          :scanning="scanning"
          :refreshing-covers="refreshingCovers"
          :syncing-files="syncingFiles"
          :can-show-history="Boolean(entry?.lastScan)"
          @scan="forwardScan"
          @edit="forwardEdit"
          @refresh-covers="forwardRefreshCovers"
          @sync-files="forwardSyncFiles"
          @remove="forwardRemove"
          @duplicate="forwardDuplicate"
          @history="openHistory"
        />
      </div>
    </div>

    <LibraryProblemStrip v-if="problem" :library="library" :problem="problem" @scan="forwardScan" />

    <LibraryDetailPanel
      v-if="expanded"
      :id="panelId"
      data-row-ignore
      :library="library"
      :history="history"
      :access="access"
      :loading="detailLoading"
      :failed="detailFailed"
      @edit="forwardEdit"
    />
  </div>
</template>

<style scoped>
/* One pass of the success tint once a scan finishes, so the row that changed is findable. */
@media (prefers-reduced-motion: no-preference) {
  .library-row-finished {
    animation: library-row-finished 2.2s ease-out;
  }
}

@media (prefers-reduced-motion: reduce) {
  .library-row-finished {
    border-color: color-mix(in oklch, var(--pill-success) 45%, transparent);
  }
}

@keyframes library-row-finished {
  0%,
  30% {
    background-color: color-mix(in oklch, var(--pill-success) 12%, var(--card));
    border-color: color-mix(in oklch, var(--pill-success) 45%, transparent);
  }
}
</style>
