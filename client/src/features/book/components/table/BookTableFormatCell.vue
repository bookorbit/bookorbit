<script setup lang="ts">
import { computed } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getFormatColor } from '@/features/book/lib/format-colors'
import type { BookFileRef } from '@bookorbit/types'

const props = defineProps<{
  files: BookFileRef[]
}>()

const formattedFiles = computed(() => {
  const primary = props.files.find((file) => file.role === 'primary')
  const ordered = primary ? [primary, ...props.files.filter((file) => file.id !== primary.id)] : props.files
  return ordered.filter((file) => file.format?.trim())
})

const formats = computed(() => {
  const seen = new Set<string>()
  return formattedFiles.value.reduce<string[]>((result, file) => {
    const normalized = file.format!.trim().toLowerCase()
    if (seen.has(normalized)) return result
    seen.add(normalized)
    result.push(normalized)
    return result
  }, [])
})

const visibleFormats = computed(() => formats.value.slice(0, 2))
</script>

<template>
  <Tooltip v-if="formats.length > 0">
    <TooltipTrigger as-child>
      <div class="flex items-center gap-0.5">
        <span
          v-for="fmt in visibleFormats"
          :key="fmt"
          class="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
          :style="{ backgroundColor: getFormatColor(fmt.toLowerCase()) }"
        >
          {{ fmt }}
        </span>
        <span v-if="formats.length > 2" class="ml-0.5 text-xs text-muted-foreground">+{{ formats.length - 2 }}</span>
      </div>
    </TooltipTrigger>
    <TooltipContent>
      <div v-for="file in formattedFiles" :key="file.id" class="text-xs">{{ file.format ?? 'unknown' }} ({{ file.role }})</div>
    </TooltipContent>
  </Tooltip>
  <span v-else class="text-xs text-muted-foreground/40">-</span>
</template>
