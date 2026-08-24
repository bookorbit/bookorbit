<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Library, LibraryOverviewEntry, ScanProgressEvent } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import LibraryCapabilityStrip from './LibraryCapabilityStrip.vue'
import LibraryFormatBar from './LibraryFormatBar.vue'
import LibraryIdentity from './LibraryIdentity.vue'
import LibraryRowActions from './LibraryRowActions.vue'
import LibraryScanCell from './LibraryScanCell.vue'

const props = defineProps<{
  libraries: Library[]
  overview: Map<number, LibraryOverviewEntry>
  overviewLoaded: boolean
  progressFor: (libraryId: number) => ScanProgressEvent | undefined
  isScanning: (libraryId: number) => boolean
  isRefreshingCovers: (libraryId: number) => boolean
  isSyncingFiles: (libraryId: number) => boolean
}>()

defineEmits<{
  scan: [library: Library]
  edit: [library: Library]
  refreshCovers: [library: Library]
  syncFiles: [library: Library]
  remove: [library: Library]
}>()

const { t } = useI18n()

function entryFor(libraryId: number): LibraryOverviewEntry | undefined {
  return props.overview.get(libraryId)
}

function cardAccent(libraryId: number): string {
  if (!props.overviewLoaded || props.isScanning(libraryId)) return 'border-border'
  const lastScan = entryFor(libraryId)?.lastScan
  if (!lastScan) return 'border-[var(--pill-warning)]/45'
  if (lastScan.status === 'failed') return 'border-destructive/45'
  return 'border-border'
}
</script>

<template>
  <ul data-testid="libraries-ledger-cards" class="space-y-2.5 md:hidden">
    <li v-for="library in libraries" :key="library.id" class="rounded-lg border bg-card shadow-xs" :class="cardAccent(library.id)">
      <div class="px-3 pt-3">
        <LibraryIdentity :library="library" />
      </div>
      <div class="px-3 pt-2.5">
        <div class="flex items-center gap-3">
          <p class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span class="font-semibold tabular-nums text-foreground">{{ formatNumber(entryFor(library.id)?.totalBooks ?? 0) }}</span>
            <span class="text-xs text-muted-foreground">
              {{ t('settings.admin.libraries.booksUnit', { count: entryFor(library.id)?.totalBooks ?? 0 }) }}
            </span>
            <span class="text-xs opacity-50" aria-hidden="true">&middot;</span>
            <span class="font-medium tabular-nums text-foreground">{{ formatBytes(entryFor(library.id)?.totalSizeBytes ?? 0) }}</span>
          </p>
          <LibraryCapabilityStrip class="shrink-0" :library="library" />
        </div>
        <LibraryFormatBar class="mt-2" show-legend :counts="entryFor(library.id)?.formatCounts ?? {}" :legend-limit="2" />
      </div>
      <div class="mt-3 flex items-center gap-3 border-t border-border px-3 py-2.5">
        <LibraryScanCell
          class="min-w-0 flex-1"
          :last-scan="entryFor(library.id)?.lastScan ?? null"
          :progress="progressFor(library.id)"
          :pending="!overviewLoaded"
        />
        <LibraryRowActions
          class="shrink-0"
          :library="library"
          :scanning="isScanning(library.id)"
          :refreshing-covers="isRefreshingCovers(library.id)"
          :syncing-files="isSyncingFiles(library.id)"
          @scan="$emit('scan', $event)"
          @edit="$emit('edit', $event)"
          @refresh-covers="$emit('refreshCovers', $event)"
          @sync-files="$emit('syncFiles', $event)"
          @remove="$emit('remove', $event)"
        />
      </div>
    </li>
  </ul>
</template>
