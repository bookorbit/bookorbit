<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Library, LibraryAccessEntry, LibraryOverviewEntry, LibraryScanHistoryEntry, ScanProgressEvent } from '@bookorbit/types'
import type { LibraryCreatorSectionId } from '@/features/library/composables/useLibraryCreator'
import type { AutomationToggle } from './LibraryAutomationList.vue'
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
  isSavingAutomation: (libraryId: number) => boolean
  isJustFinished: (libraryId: number) => boolean
  historyFor: (libraryId: number) => LibraryScanHistoryEntry[] | null
  accessFor: (libraryId: number) => LibraryAccessEntry[] | null
  isDetailLoading: (libraryId: number) => boolean
  isDetailFailed: (libraryId: number) => boolean
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

function forwardToggle(library: Library) {
  emit('toggle', library)
}
function forwardScan(library: Library) {
  emit('scan', library)
}
function forwardEdit(library: Library, section?: LibraryCreatorSectionId) {
  emit('edit', library, section)
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
</script>

<template>
  <!-- The ledger needs 75rem; below that its container shows the cards instead of scrolling sideways. -->
  <div data-testid="libraries-ledger-list" class="hidden @min-[75rem]:block">
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
        :saving-automation="isSavingAutomation(library.id)"
        :just-finished="isJustFinished(library.id)"
        :history="historyFor(library.id)"
        :access="accessFor(library.id)"
        :detail-loading="isDetailLoading(library.id)"
        :detail-failed="isDetailFailed(library.id)"
        @toggle="forwardToggle"
        @scan="forwardScan"
        @edit="forwardEdit"
        @refresh-covers="forwardRefreshCovers"
        @sync-files="forwardSyncFiles"
        @remove="forwardRemove"
        @duplicate="forwardDuplicate"
        @toggle-setting="forwardToggleSetting"
        @set-schedule="forwardSetSchedule"
      />
    </div>
  </div>
</template>
