<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, Database, Lock, Plus, TriangleAlert } from '@lucide/vue'
import { formatBytes } from '@/lib/formatting'
import { leafName, overlapStatus } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import FolderFormatLegend from './FolderFormatLegend.vue'
import FolderPathLine from './FolderPathLine.vue'
import PickerKbd from './PickerKbd.vue'

/** Arrowing through rows asks for a folder only once the focus settles on it. */
const INSPECT_DELAY_MS = 150

const { t } = useI18n()
const picker = useFolderPickerContext()
let inspectTimer: ReturnType<typeof setTimeout> | null = null

const path = computed(() => picker.tree.focus.value)
const status = computed(() => (path.value ? picker.selection.status(path.value) : null))
/** Ticked folders are in the plan already, and a folder inside one is explained by its tick. */
const shown = computed(
  () =>
    !!path.value &&
    path.value !== picker.tree.root.value &&
    status.value?.kind !== 'selected' &&
    status.value?.kind !== 'included' &&
    status.value?.kind !== 'ownCovered',
)
const inspection = computed(() => (path.value ? picker.data.inspections.get(path.value) : undefined))
const failed = computed(() => !!path.value && picker.data.failedInspections.has(path.value))
const books = computed(() => (path.value ? picker.booksIn(path.value) : null))
const overlap = computed(() => (path.value ? overlapStatus(path.value, picker.others.value) : null))

const blockReason = computed(() => {
  const current = status.value
  if (!current?.block || !path.value) return null
  if (current.kind === 'denied') return { icon: Lock, text: t('library.folderBrowser.reason.denied') }
  if (current.kind === 'appData') return { icon: Database, text: t('library.folderBrowser.reason.appData') }
  return { icon: CircleCheck, text: t('library.folderBrowser.reason.own', { name: leafName(path.value) }) }
})

const fit = computed(() => {
  const found = inspection.value
  if (!found?.files) return null
  if (picker.mode.value === 'book_per_folder' && found.mergedFolders > 0) return { warn: true, text: t('library.folderBrowser.plan.preview.merge') }
  if (picker.mode.value === 'book_per_file' && found.splitAudioFolders > 0) return { warn: true, text: t('library.folderBrowser.plan.preview.split') }
  return {
    warn: false,
    text: picker.mode.value === 'book_per_file' ? t('library.folderBrowser.plan.fit.file') : t('library.folderBrowser.plan.fit.folder'),
  }
})

function onAdd() {
  if (path.value) picker.toggleFolder(path.value)
}

function inspectFocused() {
  inspectTimer = null
  if (path.value && shown.value && !status.value?.block) void picker.data.ensureInspection(path.value)
}

watch(
  [path, shown],
  () => {
    if (inspectTimer) clearTimeout(inspectTimer)
    inspectTimer = setTimeout(inspectFocused, INSPECT_DELAY_MS)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (inspectTimer) clearTimeout(inspectTimer)
})
</script>

<template>
  <div v-if="shown && path" :class="picker.phone.value ? 'mb-4' : 'shrink-0 border-t border-border px-4 pb-3 pt-2.5'">
    <div class="flex items-center gap-2 pb-2">
      <h4 class="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('library.folderBrowser.plan.preview.label') }}</h4>
      <i18n-t
        v-if="!blockReason && !picker.phone.value"
        keypath="library.folderBrowser.plan.preview.ticks"
        tag="span"
        scope="global"
        class="ms-auto flex items-center gap-1 text-xs text-muted-foreground"
      >
        <template #key
          ><PickerKbd>{{ t('library.folderBrowser.keys.space') }}</PickerKbd></template
        >
      </i18n-t>
    </div>
    <div class="rounded-lg border border-dashed border-border bg-background/60 p-3">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1"><FolderPathLine :path="path" /></div>
        <button
          v-if="!blockReason"
          type="button"
          class="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          @click="onAdd"
        >
          <Plus :size="13" aria-hidden="true" />
          {{ t('library.folderBrowser.plan.add') }}
        </button>
      </div>
      <p v-if="blockReason" class="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
        <component :is="blockReason.icon" :size="13" class="mt-px shrink-0" aria-hidden="true" />
        <span>{{ blockReason.text }}</span>
      </p>
      <template v-else-if="!inspection && failed" />
      <div v-else-if="!inspection" class="mt-2 space-y-1.5" aria-hidden="true">
        <span class="block h-2.5 w-40 animate-pulse rounded-full bg-muted" />
        <span class="block h-2.5 w-56 animate-pulse rounded-full bg-muted" />
      </div>
      <template v-else>
        <i18n-t v-if="books" keypath="library.folderBrowser.plan.preview.wouldAdd" tag="p" scope="global" class="mt-1 text-xs text-muted-foreground">
          <template #books>
            <span class="font-medium text-foreground">{{ picker.countLabel(books) }}</span>
          </template>
          <template #size>{{ formatBytes(inspection.bytes) }}</template>
        </i18n-t>
        <p v-else class="mt-1 text-xs text-muted-foreground">{{ t('library.folderBrowser.plan.preview.empty') }}</p>
        <div v-if="inspection.files" class="mt-1.5"><FolderFormatLegend :formats="inspection.formats" :limit="4" /></div>
        <p v-if="fit" class="mt-1.5 flex items-start gap-1.5 text-xs text-foreground">
          <TriangleAlert v-if="fit.warn" :size="13" class="mt-px shrink-0 text-warning" aria-hidden="true" />
          <CircleCheck v-else :size="13" class="mt-px shrink-0 text-success" aria-hidden="true" />
          <span>{{ fit.text }}</span>
        </p>
        <p v-if="overlap" class="mt-1 flex items-start gap-1.5 text-xs text-foreground">
          <TriangleAlert :size="13" class="mt-px shrink-0 text-warning" aria-hidden="true" />
          <span>{{ picker.describeOverlap(path, overlap) }}</span>
        </p>
        <ul v-if="inspection.samples.length" class="mt-2 space-y-0.5">
          <li v-for="sample in inspection.samples" :key="sample" class="truncate font-mono text-[11px] text-path-dim" dir="ltr" :title="sample">
            {{ sample }}
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
