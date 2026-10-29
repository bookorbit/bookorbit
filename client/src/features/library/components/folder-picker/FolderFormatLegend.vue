<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'

const props = withDefaults(defineProps<{ formats: Record<string, number>; limit?: number; nowrap?: boolean; more?: boolean }>(), {
  limit: 3,
  nowrap: false,
  more: true,
})

const { t } = useI18n()

const sorted = computed(() => Object.entries(props.formats).sort((a, b) => b[1] - a[1]))
const shown = computed(() => sorted.value.slice(0, props.limit))
const hidden = computed(() => (props.more ? sorted.value.length - shown.value.length : 0))
</script>

<template>
  <span
    class="flex items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground"
    :class="nowrap ? 'min-w-0 flex-nowrap overflow-hidden' : 'flex-wrap'"
  >
    <span v-for="[format, count] in shown" :key="format" class="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span class="size-1.5 shrink-0 rounded-[2px]" :style="{ backgroundColor: formatColorVar(format) }" aria-hidden="true" />
      {{ format.toUpperCase() }} <span class="font-medium tabular-nums text-foreground">{{ formatNumber(count) }}</span>
    </span>
    <span v-if="hidden > 0" class="whitespace-nowrap">{{ t('library.folderBrowser.count.more', { count: hidden }) }}</span>
  </span>
</template>
