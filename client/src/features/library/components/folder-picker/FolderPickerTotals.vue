<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lock } from '@lucide/vue'
import type { OrganizationMode } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { booksAs, overlapStatus } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import FolderFormatBar from './FolderFormatBar.vue'

const { t } = useI18n()
const picker = useFolderPickerContext()

const selected = computed(() => picker.selection.selected.value)
const shown = computed(() => selected.value.length > 0)
const total = (mode: OrganizationMode) => selected.value.reduce((sum, path) => sum + booksAs(picker.data.summaries.get(path), mode), 0)
/** Until every picked folder is counted, a partial total would read as the answer. */
const counted = computed(() => selected.value.every((path) => picker.data.summaries.has(path)))
const bytes = computed(() => selected.value.reduce((sum, path) => sum + (picker.data.inspections.get(path)?.bytes ?? 0), 0))
const bytesKnown = computed(() => selected.value.every((path) => picker.data.inspections.has(path)))
const shared = computed(() =>
  selected.value
    .filter((path) => overlapStatus(path, picker.others.value)?.kind === 'overlap')
    .reduce((sum, path) => sum + (picker.data.summaries.get(path)?.files ?? 0), 0),
)
const formats = computed(() => {
  const merged: Record<string, number> = {}
  for (const path of selected.value)
    for (const [format, count] of Object.entries(picker.data.summaries.get(path)?.formats ?? {})) merged[format] = (merged[format] ?? 0) + count
  return merged
})
const modes: OrganizationMode[] = ['book_per_folder', 'book_per_file']
const modeName = (mode: OrganizationMode) =>
  mode === 'book_per_file' ? t('library.folderBrowser.mode.file') : t('library.folderBrowser.mode.folder')

function onMode(mode: OrganizationMode) {
  picker.selection.setMode(mode)
}
</script>

<template>
  <div v-if="shown" class="shrink-0 border-t border-border px-4 py-3">
    <div class="flex flex-wrap items-baseline gap-x-2">
      <span v-if="counted" class="text-xl font-semibold tabular-nums text-foreground">{{ formatNumber(total(picker.mode.value)) }}</span>
      <span v-else class="inline-block h-5 w-10 animate-pulse self-center rounded bg-muted" aria-hidden="true" />
      <span class="text-sm text-muted-foreground">{{
        bytesKnown
          ? t('library.folderBrowser.plan.totals.books', { count: total(picker.mode.value), size: formatBytes(bytes) })
          : t('library.folderBrowser.plan.totals.booksOnly', { count: total(picker.mode.value) })
      }}</span>
      <span v-if="shared" class="text-xs text-warning">{{ t('library.folderBrowser.plan.totals.shared', { count: formatNumber(shared) }) }}</span>
    </div>
    <div class="mt-2"><FolderFormatBar :formats="formats" :limit="5" /></div>
    <div v-if="!picker.modeLocked.value" class="mt-3">
      <p class="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('library.folderBrowser.plan.totals.organize') }}
      </p>
      <div class="flex gap-0.5 rounded-md bg-muted p-0.5" role="group" :aria-label="t('library.folderBrowser.plan.totals.organizeLabel')">
        <button
          v-for="mode in modes"
          :key="mode"
          type="button"
          class="flex min-w-0 flex-1 flex-col items-start rounded-[5px] px-2 py-1 text-start"
          :class="picker.mode.value === mode ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="picker.mode.value === mode"
          :title="mode === 'book_per_folder' ? t('library.folderBrowser.plan.totals.folderTitle') : t('library.folderBrowser.plan.totals.fileTitle')"
          @click="onMode(mode)"
        >
          <span class="text-xs font-medium">{{ modeName(mode) }}</span>
          <span v-if="counted" class="text-[11px] tabular-nums">{{
            t('library.folderBrowser.plan.totals.segmentBooks', { count: total(mode) })
          }}</span>
          <span v-else class="my-[3px] inline-block h-2.5 w-12 animate-pulse rounded-full bg-muted" aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-else class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock :size="12" aria-hidden="true" />
      {{ t('library.folderBrowser.plan.totals.locked', { mode: modeName(picker.mode.value), name: picker.libraryName.value }) }}
    </p>
  </div>
</template>
