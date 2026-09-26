<script setup lang="ts">
import { computed } from 'vue'
import type { BookFileRef } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { bookFormatEntries, formatKeyName } from '@/features/book/lib/book-formats'

const props = defineProps<{
  files: BookFileRef[]
}>()

const MAX_VISIBLE = 2

const entries = computed(() => bookFormatEntries(props.files))
const visibleEntries = computed(() => entries.value.slice(0, MAX_VISIBLE))
const hiddenCount = computed(() => entries.value.length - visibleEntries.value.length)
</script>

<template>
  <Tooltip v-if="entries.length > 0">
    <TooltipTrigger as-child>
      <div class="flex items-center gap-0.5">
        <BookFormatChip
          v-for="entry in visibleEntries"
          :key="entry.key"
          :format-key="entry.key"
          variant="solid"
          class="gap-0.5 rounded px-1.5 py-0.5 text-[10px] tracking-wide"
        />
        <span v-if="hiddenCount > 0" class="ml-0.5 text-xs text-muted-foreground">+{{ hiddenCount }}</span>
      </div>
    </TooltipTrigger>
    <TooltipContent>
      <div v-for="entry in entries" :key="entry.key" class="text-xs">{{ formatKeyName(entry.key) }}</div>
    </TooltipContent>
  </Tooltip>
  <span v-else class="text-xs text-muted-foreground">-</span>
</template>
