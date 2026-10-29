<script setup lang="ts">
import { computed } from 'vue'
import { normalizeFolderPath } from '../../composables/folder-paths'
import { leafName, parentPath } from '../../composables/folder-picker/folder-picker-rules'

const props = withDefaults(defineProps<{ path: string; textClass?: string }>(), { textClass: 'text-[12.5px]' })

const normalized = computed(() => normalizeFolderPath(props.path))
const parent = computed(() => {
  if (normalized.value === '/') return ''
  const above = parentPath(normalized.value)
  return above === '/' ? '/' : `${above}/`
})
</script>

<template>
  <!-- The parent gives way first; the folder name only truncates once it alone is too wide. -->
  <span class="flex min-w-0 max-w-full font-mono" :class="textClass" dir="ltr" :title="normalized">
    <span class="min-w-0 truncate text-path-dim">{{ parent }}</span>
    <span class="max-w-full shrink-0 truncate font-semibold text-foreground">{{ leafName(normalized) }}</span>
  </span>
</template>
