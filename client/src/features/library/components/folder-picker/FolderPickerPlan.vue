<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, Plus } from '@lucide/vue'
import { booksAs, isAtOrInside } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import { normalizeFolderPath } from '../../composables/folder-paths'
import FolderFormatLegend from './FolderFormatLegend.vue'
import FolderPathLine from './FolderPathLine.vue'
import FolderPickerPlanRow from './FolderPickerPlanRow.vue'
import FolderPickerPreview from './FolderPickerPreview.vue'
import FolderPickerTotals from './FolderPickerTotals.vue'

const props = defineProps<{ width: number }>()

const { t } = useI18n()
const picker = useFolderPickerContext()

const selected = computed(() => picker.selection.selected.value)
const wide = computed(() => props.width >= 480)
const suggestions = computed(() =>
  (picker.data.unclaimed.value?.folders ?? [])
    .map((folder) => ({ ...folder, path: normalizeFolderPath(folder.path) }))
    .filter(
      (folder) =>
        !selected.value.some((path) => isAtOrInside(folder.path, path)) && !picker.own.value.some((path) => isAtOrInside(folder.path, path)),
    )
    .slice(0, selected.value.length ? 3 : 5),
)

function ownBooks(path: string): string {
  const summary = picker.data.summaries.get(path)
  if (!summary) return ''
  return t('library.folderBrowser.plan.already', { books: picker.countLabel(booksAs(summary, picker.mode.value)) })
}

function onReveal(path: string) {
  picker.reveal(path)
}

function onAdd(path: string) {
  picker.toggleFolder(path)
}

// Picked folders and this library's own folders need their counts and sizes whatever is on screen.
watch(
  [selected, () => picker.own.value],
  ([paths, own]) => {
    picker.data.requestSummaries([...paths, ...own])
    for (const path of paths) void picker.data.ensureInspection(path)
  },
  { immediate: true },
)
</script>

<template>
  <aside
    class="flex min-h-0 flex-1 flex-col"
    :class="picker.phone.value ? '' : 'border-s border-border bg-card/40'"
    :aria-label="t('library.folderBrowser.plan.label')"
  >
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
      <FolderPickerPreview v-if="picker.phone.value" />
      <div class="flex items-center gap-2 pb-2">
        <h4 class="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('library.folderBrowser.plan.willRead', { name: picker.libraryName.value }) }}
        </h4>
        <span v-if="selected.length" class="ms-auto flex items-center gap-1 text-xs text-muted-foreground">
          {{ t('library.folderBrowser.plan.newFolders', { count: selected.length }) }}
        </span>
      </div>
      <ul v-if="picker.own.value.length" class="mb-2 space-y-1.5">
        <li v-for="path in picker.own.value" :key="path" class="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <CircleCheck :size="14" class="shrink-0 text-primary" aria-hidden="true" />
          <div class="min-w-0 flex-1"><FolderPathLine :path="path" /></div>
          <span class="shrink-0 text-xs text-muted-foreground">{{ ownBooks(path) }}</span>
        </li>
      </ul>
      <ul v-if="selected.length" class="space-y-2">
        <FolderPickerPlanRow v-for="path in selected" :key="path" :path="path" :wide="wide" />
      </ul>
      <div v-else class="rounded-lg border border-dashed border-border px-4 py-5 text-center">
        <p class="text-sm font-medium text-foreground">
          {{ t('library.folderBrowser.plan.emptyTitle') }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('library.folderBrowser.plan.emptyHint') }}
        </p>
      </div>
      <div v-if="suggestions.length" class="mt-5">
        <div class="flex items-center gap-2 pb-2">
          <h4 class="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('library.folderBrowser.plan.suggestions') }}
          </h4>
          <span class="ms-auto flex items-center gap-1 text-xs text-muted-foreground">{{ t('library.folderBrowser.plan.suggestionsMeta') }}</span>
        </div>
        <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          <li v-for="folder in suggestions" :key="folder.path" class="flex items-center gap-2 px-3 py-2">
            <div class="min-w-0 flex-1">
              <button type="button" class="block w-full text-start" :title="t('library.folderBrowser.plan.showTitle')" @click="onReveal(folder.path)">
                <FolderPathLine :path="folder.path" />
              </button>
              <div class="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span class="shrink-0">{{ t('library.folderBrowser.count.books', { count: folder.files }) }}</span>
                <FolderFormatLegend :formats="folder.formats" :limit="2" nowrap :more="false" />
              </div>
            </div>
            <button
              type="button"
              class="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              @click="onAdd(folder.path)"
            >
              <Plus :size="13" aria-hidden="true" />
              {{ t('library.folderBrowser.plan.add') }}
            </button>
          </li>
        </ul>
      </div>
    </div>
    <FolderPickerPreview v-if="!picker.phone.value" />
    <FolderPickerTotals />
  </aside>
</template>
