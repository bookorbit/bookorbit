<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FileImage, Folder } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'

const { t } = useI18n()

interface TreeLine {
  name: string
  folder: boolean
  index?: number
}

// Sample file names, not interface copy: they show the shape of a folder, so they stay untranslated.
const lines: TreeLine[] = [
  { name: 'Saga/', folder: true },
  { name: 'Saga #01.cbz', folder: false, index: 1 },
  { name: 'Saga #02.cbz', folder: false, index: 2 },
  { name: 'Akira/', folder: true },
  { name: 'Akira v01.cbz', folder: false, index: 1 },
]
</script>

<template>
  <div class="rounded-lg border border-border bg-background px-2.5 py-2" aria-hidden="true">
    <div v-for="line in lines" :key="line.name" class="flex h-5 items-center gap-1.5" :class="line.folder ? '' : 'ps-4'">
      <span v-if="!line.folder" class="-ms-2.5 -mt-2.5 h-2.5 w-2 shrink-0 rounded-es-sm border-b border-s border-border" />
      <component :is="line.folder ? Folder : FileImage" :size="12" class="shrink-0 text-foreground" />
      <span class="min-w-0 truncate font-mono text-[11.5px] text-foreground" dir="ltr">{{ line.name }}</span>
      <span v-if="line.folder" class="ms-auto shrink-0 rounded-full bg-primary/14 px-1.5 py-px text-[10.5px] font-medium text-primary">
        {{ t('library.creator.scanner.series.previewSeries') }}
      </span>
      <span v-else class="ms-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">#{{ formatNumber(line.index!) }}</span>
    </div>
  </div>
</template>
