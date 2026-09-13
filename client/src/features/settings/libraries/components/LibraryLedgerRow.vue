<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight } from '@lucide/vue'
import type { Library, LibraryOverviewEntry, LibraryScanHistoryEntry, ScanProgressEvent } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import LibraryAutomationList from './LibraryAutomationList.vue'
import LibraryDetailPanel from './LibraryDetailPanel.vue'
import LibraryFormatBar from './LibraryFormatBar.vue'
import LibraryIdentity from './LibraryIdentity.vue'
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
  history: LibraryScanHistoryEntry[] | null
  accessCount: number | null
  detailLoading: boolean
  detailFailed: boolean
}>()

const emit = defineEmits<{
  toggle: [library: Library]
  scan: [library: Library]
  edit: [library: Library]
  refreshCovers: [library: Library]
  syncFiles: [library: Library]
  remove: [library: Library]
}>()

const { t } = useI18n()

const totalBooks = computed(() => props.entry?.totalBooks ?? 0)
const panelId = computed(() => `library-detail-${props.library.id}`)

/** Failed and never-scanned libraries are outlined so the list reads at a glance. */
const accent = computed(() => {
  if (props.expanded) return 'border-primary/40'
  if (!props.overviewLoaded || props.scanning) return 'border-border'
  const lastScan = props.entry?.lastScan
  if (!lastScan) return 'border-[var(--pill-warning)]/45'
  if (lastScan.status === 'failed') return 'border-destructive/45'
  return 'border-border'
})

function requestToggle() {
  emit('toggle', props.library)
}
</script>

<template>
  <div class="overflow-hidden rounded-xl border bg-card shadow-xs transition-colors" :class="accent">
    <!-- Four zones on one grid, vertically centred so the shorter ones never leave a void. -->
    <div class="grid min-h-24 grid-cols-[minmax(0,1fr)_16.75rem_19.75rem_14.5rem] items-center gap-7 py-[15px] pe-5 ps-3.5">
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
          <component :is="expanded ? ChevronDown : ChevronRight" :size="14" aria-hidden="true" />
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

      <LibraryAutomationList :library="library" />

      <div class="flex w-full flex-col gap-2.5">
        <LibraryScanCell :last-scan="entry?.lastScan ?? null" :progress="progress" :pending="!overviewLoaded" />
        <LibraryRowActions
          :library="library"
          :scanning="scanning"
          :refreshing-covers="refreshingCovers"
          :syncing-files="syncingFiles"
          @scan="emit('scan', $event)"
          @edit="emit('edit', $event)"
          @refresh-covers="emit('refreshCovers', $event)"
          @sync-files="emit('syncFiles', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </div>

    <LibraryDetailPanel
      v-if="expanded"
      :id="panelId"
      :library="library"
      :history="history"
      :access-count="accessCount"
      :loading="detailLoading"
      :failed="detailFailed"
      @edit="emit('edit', $event)"
    />
  </div>
</template>
