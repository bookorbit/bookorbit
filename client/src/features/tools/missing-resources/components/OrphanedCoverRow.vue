<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OrphanedCoverDirEntry } from '@bookorbit/types'

import { formatBytes } from '@/lib/formatting'

const props = defineProps<{ entry: OrphanedCoverDirEntry; selected: boolean; disabled: boolean }>()
const emit = defineEmits<{ toggle: [id: number] }>()

const { t } = useI18n()

const label = computed(() => t('tools.missingResources.table.coverFolder', { bookId: props.entry.bookId }))

// A folder from before covers had slots holds its files at the top level and names no medium.
const mediaLabel = computed(() => {
  const media = props.entry.media
  if (media.includes('ebook') && media.includes('audio')) return t('tools.missingResources.table.orphanMedia.both')
  if (media.includes('audio')) return t('tools.missingResources.table.orphanMedia.audio')
  if (media.includes('ebook')) return t('tools.missingResources.table.orphanMedia.ebook')
  return null
})

function handleToggle(): void {
  emit('toggle', props.entry.bookId)
}
</script>

<template>
  <li class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
    <input
      type="checkbox"
      class="shrink-0 rounded accent-primary"
      :checked="selected"
      :disabled="disabled"
      :aria-label="label"
      @change="handleToggle"
    />
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-foreground">{{ label }}</p>
      <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{{ t('tools.missingResources.table.fileCount', { count: entry.fileCount }) }}</span>
        <span v-if="mediaLabel">{{ mediaLabel }}</span>
      </p>
    </div>
    <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ formatBytes(entry.sizeBytes) }}</span>
  </li>
</template>
