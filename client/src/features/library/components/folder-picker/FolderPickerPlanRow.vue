<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookCopy, CircleCheck, CircleMinus, FolderOpen, ListTree, TriangleAlert, X } from '@lucide/vue'
import { formatList } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { attentionFor, leafName } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import FolderFormatLegend from './FolderFormatLegend.vue'
import FolderPathLine from './FolderPathLine.vue'

const props = defineProps<{ path: string; wide: boolean }>()

const { t } = useI18n()
const picker = useFolderPickerContext()

const status = computed(() => picker.selection.status(props.path))
const summary = computed(() => picker.data.summaries.get(props.path))
const inspection = computed(() => picker.data.inspections.get(props.path))
const books = computed(() => picker.booksIn(props.path))
const attention = computed(() => attentionFor(summary.value, status.value, picker.mode.value))
const name = computed(() => leafName(props.path))

const countLine = computed(() => {
  if (books.value === null) return ''
  const count = picker.countLabel(books.value)
  return inspection.value?.bytes ? t('library.folderBrowser.plan.rowSize', { books: count, size: formatBytes(inspection.value.bytes) }) : count
})

const fitText = computed(() => {
  if (!summary.value?.files) return t('library.folderBrowser.plan.fit.empty')
  return picker.mode.value === 'book_per_file' ? t('library.folderBrowser.plan.fit.file') : t('library.folderBrowser.plan.fit.folder')
})

interface Action {
  key: string
  label: string
  icon: typeof X
  run: () => void
}

const issue = computed<{ text: string; icon: typeof X; actions: Action[] } | null>(() => {
  const found = attention.value
  if (!found) return null
  const locked = picker.modeLocked.value
  const lockNote = locked ? ` ${t('library.folderBrowser.plan.attention.locked')}` : ''
  if (found.kind === 'contains') {
    const libraries = found.status?.libraries ?? []
    const single = libraries.length === 1 ? libraries[0]! : null
    const folder = single ? leafName(single.folders.find((own) => own.startsWith(`${props.path}/`)) ?? single.folders[0]!) : ''
    return {
      text: single
        ? t('library.folderBrowser.plan.attention.containsOne', { folder, library: single.name })
        : t('library.folderBrowser.plan.attention.containsMany', { libraries: formatList(libraries.map((library) => library.name)) }),
      icon: TriangleAlert,
      actions: [
        {
          key: 'leaveOut',
          label: single ? t('library.folderBrowser.plan.attention.leaveOutOne', { folder }) : t('library.folderBrowser.plan.attention.leaveOutMany'),
          icon: CircleMinus,
          run: () => void picker.selection.leaveOut(props.path),
        },
      ],
    }
  }
  if (found.kind === 'overlap') {
    return {
      text: picker.describeOverlap(props.path, found.status!),
      icon: TriangleAlert,
      actions: [{ key: 'remove', label: t('library.folderBrowser.plan.attention.remove'), icon: X, run: () => picker.selection.remove(props.path) }],
    }
  }
  if (found.kind === 'merge') {
    return {
      text: t('library.folderBrowser.plan.attention.merge', { count: summary.value!.mergedFolders }) + lockNote,
      icon: TriangleAlert,
      actions: locked
        ? []
        : [
            {
              key: 'file',
              label: t('library.folderBrowser.plan.attention.useFile'),
              icon: BookCopy,
              run: () => picker.selection.setMode('book_per_file'),
            },
          ],
    }
  }
  return {
    text: t('library.folderBrowser.plan.attention.split', { count: summary.value!.splitAudioFolders }) + lockNote,
    icon: TriangleAlert,
    actions: locked
      ? []
      : [
          {
            key: 'folder',
            label: t('library.folderBrowser.plan.attention.useFolder'),
            icon: BookCopy,
            run: () => picker.selection.setMode('book_per_folder'),
          },
        ],
  }
})

function onReveal() {
  picker.reveal(props.path)
}

function onRemove() {
  picker.selection.remove(props.path)
}
</script>

<template>
  <li
    class="overflow-hidden rounded-lg border bg-background"
    :class="[issue ? 'border-warning/40' : 'border-border', picker.flash.value === path ? 'ring-2 ring-primary/40' : '']"
  >
    <div class="flex items-center gap-2.5 px-3 py-2">
      <FolderOpen :size="15" class="shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <FolderPathLine :path="path" />
        <div class="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span :class="wide ? 'shrink-0' : 'truncate'">{{ countLine }}</span>
          <FolderFormatLegend v-if="wide && summary?.files" :formats="summary.formats" :limit="3" nowrap :more="false" />
        </div>
      </div>
      <span v-if="!issue" class="text-success" :title="fitText"><CircleCheck :size="14" /></span>
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="t('library.folderBrowser.plan.show', { name })"
        :title="t('library.folderBrowser.plan.showTitle')"
        @click="onReveal"
      >
        <ListTree :size="13" />
      </button>
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        :aria-label="t('library.folderBrowser.plan.remove', { name })"
        @click="onRemove"
      >
        <X :size="13" />
      </button>
    </div>
    <div v-if="issue" class="flex items-start gap-2 border-t border-warning/25 bg-warning/8 px-3 py-2 text-xs text-foreground">
      <component :is="issue.icon" :size="13" class="mt-px shrink-0 text-warning" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p>{{ issue.text }}</p>
        <div v-if="issue.actions.length" class="mt-1.5 flex flex-wrap gap-1.5">
          <button
            v-for="action in issue.actions"
            :key="action.key"
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-muted"
            @click="action.run"
          >
            <component :is="action.icon" :size="13" aria-hidden="true" />
            {{ action.label }}
          </button>
        </div>
      </div>
    </div>
  </li>
</template>
