<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, FileText, TriangleAlert } from '@lucide/vue'
import { splitResolvedPath } from '../lib/pattern-preview'

const props = defineProps<{ path: string; indent?: number }>()

const { t } = useI18n()

const parts = computed(() => splitResolvedPath(props.path))
const step = computed(() => props.indent ?? 14)
</script>

<template>
  <div v-if="!path" class="flex items-center gap-2 text-xs text-muted-foreground">
    <TriangleAlert :size="14" class="shrink-0 text-warning" aria-hidden="true" />
    {{ t('settings.reader.fileNaming.previewEmpty') }}
  </div>

  <div v-else class="font-mono text-[13px] leading-tight">
    <div v-for="(folder, index) in parts.folders" :key="`${index}-${folder}`" class="flex min-w-0 items-start gap-1.5 py-0.5 text-muted-foreground">
      <span aria-hidden="true" class="shrink-0" :style="{ width: `${index * step}px` }" />
      <Folder :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 break-all">{{ folder }}</span>
    </div>
    <div class="flex min-w-0 items-start gap-1.5 py-0.5 font-semibold text-foreground">
      <span aria-hidden="true" class="shrink-0" :style="{ width: `${parts.folders.length * step}px` }" />
      <FileText :size="14" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <span class="min-w-0 break-all"
        >{{ parts.stem }}<span class="font-medium text-primary">{{ parts.extension }}</span></span
      >
    </div>
  </div>
</template>
