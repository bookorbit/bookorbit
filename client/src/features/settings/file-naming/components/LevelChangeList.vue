<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronRight, File, Folder, FolderOpen } from '@lucide/vue'
import { splitExtension, type LevelChange } from '../lib/pattern-resolution'

/**
 * One row per variation of the preview book, listing only the levels that come out differently.
 * Printing the whole path for every row would repeat the unchanged folders on every line, which
 * is most of the text and none of the information.
 */
export interface ChangeRow {
  id: string
  label: string
  changes: LevelChange[]
}

const props = defineProps<{
  rows: ChangeRow[]
  extension: string
  /** Rows become buttons that choose what the tree above shows. */
  selectable?: boolean
  selectedId?: string
}>()

const emit = defineEmits<{ select: [id: string] }>()

const { t } = useI18n()

function iconFor(change: LevelChange) {
  if (change.kind === 'file') return File
  return change.bookFolder ? FolderOpen : Folder
}

function parts(change: LevelChange): [string, string] {
  return change.kind === 'file' ? splitExtension(change.to, props.extension) : [change.to, '']
}

function handleSelect(id: string) {
  if (props.selectable) emit('select', id)
}
</script>

<template>
  <ul class="list-none divide-y divide-border overflow-hidden rounded-md border border-border p-0">
    <li v-for="row in rows" :key="row.id">
      <component
        :is="selectable ? 'button' : 'div'"
        :type="selectable ? 'button' : undefined"
        :aria-pressed="selectable ? selectedId === row.id : undefined"
        class="group grid w-full grid-cols-1 items-start gap-x-3 gap-y-1 px-3 py-2 text-start text-[13px] leading-5 sm:grid-cols-[5.5rem_minmax(0,1fr)_0.875rem]"
        :class="
          !selectable
            ? ''
            : selectedId === row.id
              ? 'bg-primary/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
              : 'transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
        "
        @click="handleSelect(row.id)"
      >
        <span class="text-xs font-semibold" :class="selectable && selectedId === row.id ? 'text-primary' : 'text-muted-foreground'">{{
          row.label
        }}</span>
        <span class="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
          <span v-if="row.changes.length === 0" class="text-muted-foreground">{{ t('settings.reader.fileNaming.noChange') }}</span>
          <span v-for="(change, index) in row.changes" :key="index" class="inline-flex min-w-0 max-w-full items-start gap-1.5">
            <component
              :is="iconFor(change)"
              :size="12"
              class="mt-1 shrink-0"
              :class="[
                change.emptyName ? 'text-destructive' : change.kind === 'file' || change.bookFolder ? 'text-primary' : 'text-muted-foreground',
                change.skipped ? 'folder-dashed' : '',
              ]"
              aria-hidden="true"
            />
            <span v-if="change.emptyName" class="min-w-0 break-words text-destructive"
              ><s>{{ change.from }}</s>
              <span class="ms-1 text-[10px] font-bold uppercase tracking-wider">{{ t('settings.reader.fileNaming.tagEmptyName') }}</span></span
            >
            <span v-else-if="change.skipped" class="min-w-0 break-words text-muted-foreground"
              ><s>{{ change.from }}</s>
              <span class="ms-1 text-[10px] font-bold uppercase tracking-wider">{{ t('settings.reader.fileNaming.tagSkipped') }}</span></span
            >
            <span v-else class="min-w-0 break-words" :class="change.usedFallback ? 'text-pattern-fallback' : 'text-foreground'"
              >{{ parts(change)[0] }}<span v-if="parts(change)[1]" class="text-primary">{{ parts(change)[1] }}</span></span
            >
          </span>
        </span>
        <ChevronRight
          v-if="selectable"
          :size="14"
          class="mt-0.5 hidden text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 sm:block"
          :class="selectedId === row.id ? 'opacity-100' : ''"
          aria-hidden="true"
        />
      </component>
    </li>
  </ul>
</template>

<style scoped>
.folder-dashed :deep(path) {
  stroke-dasharray: 2.6 2.4;
}
</style>
