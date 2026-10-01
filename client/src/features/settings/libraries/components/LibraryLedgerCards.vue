<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff, FileEdit } from '@lucide/vue'
import type { Library, LibraryOverviewEntry, ScanProgressEvent } from '@bookorbit/types'
import { describeSchedule, writtenKindCount } from '@/features/library/utils/library-summary'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { libraryProblem } from '../lib/library-problems'
import LibraryFormatBar from './LibraryFormatBar.vue'
import LibraryIdentity from './LibraryIdentity.vue'
import LibraryProblemStrip from './LibraryProblemStrip.vue'
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
  duplicate: [library: Library]
}>()

const { t } = useI18n()

/** The editor's own summaries, so a phone reads the same words the Automation and File updates sections use. */
function automationSummary(library: Library): string {
  const summary = describeSchedule(library.autoScanCronExpression)
  const schedule = library.autoScanCronExpression
    ? summary
      ? t(`library.creator.schedule.presets.${summary.preset}`)
      : t('library.creator.summary.customSchedule')
    : null
  if (library.watch && schedule) return t('library.creator.summary.watchingScheduled', { schedule })
  if (library.watch) return t('library.creator.summary.watchingOnly')
  if (schedule) return t('library.creator.summary.scheduledOnly', { schedule })
  return t('library.creator.summary.manualOnly')
}

function fileSummary(library: Library): string | null {
  const count = writtenKindCount(library)
  if (library.fileWriteEnabled && library.fileRenameEnabled) return t('library.creator.summary.writesAndRenames', { count })
  if (library.fileWriteEnabled) return t('library.creator.summary.writes', { count })
  if (library.fileRenameEnabled) return t('library.creator.summary.renames')
  return null
}

function problemFor(library: Library) {
  return props.overviewLoaded ? libraryProblem(entryFor(library.id)?.lastScan, props.isScanning(library.id)) : null
}

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
  <ul data-testid="libraries-ledger-cards" class="grid gap-2.5 @min-[40rem]:grid-cols-2 @min-[75rem]:hidden">
    <li
      v-for="library in libraries"
      :key="library.id"
      class="flex flex-col overflow-hidden rounded-lg border bg-card shadow-xs"
      :class="cardAccent(library.id)"
    >
      <div class="px-3 pt-3">
        <LibraryIdentity :library="library" />
      </div>
      <div class="flex-1 px-3 pb-3 pt-2.5">
        <div class="flex items-center gap-3">
          <p class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span class="font-semibold tabular-nums text-foreground">{{ formatNumber(entryFor(library.id)?.totalBooks ?? 0) }}</span>
            <span class="text-xs text-muted-foreground">
              {{ t('settings.admin.libraries.booksUnit', { count: entryFor(library.id)?.totalBooks ?? 0 }) }}
            </span>
            <span class="text-xs opacity-50" aria-hidden="true">&middot;</span>
            <span class="font-medium tabular-nums text-foreground">{{ formatBytes(entryFor(library.id)?.totalSizeBytes ?? 0) }}</span>
          </p>
        </div>
        <p data-testid="library-card-automation" class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-foreground">
          <component
            :is="library.watch ? Eye : EyeOff"
            :size="12"
            class="shrink-0"
            :class="library.watch || library.autoScanCronExpression ? 'text-primary' : 'text-muted-foreground'"
            aria-hidden="true"
          />
          <span>{{ automationSummary(library) }}</span>
          <template v-if="fileSummary(library)">
            <span class="text-muted-foreground" aria-hidden="true">&middot;</span>
            <FileEdit :size="12" class="shrink-0 text-primary" aria-hidden="true" />
            <span>{{ fileSummary(library) }}</span>
          </template>
        </p>
        <LibraryFormatBar class="mt-2" show-legend :counts="entryFor(library.id)?.formatCounts ?? {}" :legend-limit="2" />
      </div>
      <LibraryProblemStrip v-if="problemFor(library)" class="px-3" :library="library" :problem="problemFor(library)!" @scan="$emit('scan', $event)" />
      <div class="flex items-center gap-3 border-t border-border px-3 py-2.5">
        <LibraryScanCell
          class="min-w-0 flex-1"
          :library="library"
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
          @duplicate="$emit('duplicate', $event)"
        />
      </div>
    </li>
  </ul>
</template>
