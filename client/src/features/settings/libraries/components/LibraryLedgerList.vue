<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Library, LibraryOverviewEntry, LibraryScanHistoryEntry, ScanProgressEvent } from '@bookorbit/types'
import LibraryLedgerRow from './LibraryLedgerRow.vue'

defineProps<{
  libraries: Library[]
  overview: Map<number, LibraryOverviewEntry>
  overviewLoaded: boolean
  expandedId: number | null
  progressFor: (libraryId: number) => ScanProgressEvent | undefined
  isScanning: (libraryId: number) => boolean
  isRefreshingCovers: (libraryId: number) => boolean
  isSyncingFiles: (libraryId: number) => boolean
  historyFor: (libraryId: number) => LibraryScanHistoryEntry[] | null
  accessCountFor: (libraryId: number) => number | null
  isDetailLoading: (libraryId: number) => boolean
  isDetailFailed: (libraryId: number) => boolean
}>()

defineEmits<{
  toggle: [library: Library]
  scan: [library: Library]
  edit: [library: Library]
  refreshCovers: [library: Library]
  syncFiles: [library: Library]
  remove: [library: Library]
}>()

const { t } = useI18n()
</script>

<template>
  <!-- Below the row's natural width the whole grid scrolls, the same way the users roster does. -->
  <div data-testid="libraries-ledger-list" class="hidden overflow-x-auto md:block">
    <div class="min-w-[75rem]">
      <div
        aria-hidden="true"
        class="grid grid-cols-[minmax(0,1fr)_16.75rem_19.75rem_14.5rem] gap-7 pb-2 pe-[21px] ps-[15px] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <span>{{ t('settings.admin.libraries.columns.library') }}</span>
        <span>{{ t('settings.admin.libraries.columns.contents') }}</span>
        <span>{{ t('settings.admin.libraries.columns.automation') }}</span>
        <span>{{ t('settings.admin.libraries.columns.lastScan') }}</span>
      </div>
      <div class="flex flex-col gap-2.5">
        <LibraryLedgerRow
          v-for="library in libraries"
          :key="library.id"
          :library="library"
          :entry="overview.get(library.id)"
          :overview-loaded="overviewLoaded"
          :expanded="expandedId === library.id"
          :progress="progressFor(library.id)"
          :scanning="isScanning(library.id)"
          :refreshing-covers="isRefreshingCovers(library.id)"
          :syncing-files="isSyncingFiles(library.id)"
          :history="historyFor(library.id)"
          :access-count="accessCountFor(library.id)"
          :detail-loading="isDetailLoading(library.id)"
          :detail-failed="isDetailFailed(library.id)"
          @toggle="$emit('toggle', $event)"
          @scan="$emit('scan', $event)"
          @edit="$emit('edit', $event)"
          @refresh-covers="$emit('refreshCovers', $event)"
          @sync-files="$emit('syncFiles', $event)"
          @remove="$emit('remove', $event)"
        />
      </div>
    </div>
  </div>
</template>
