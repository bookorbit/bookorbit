<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { toFormatSegments } from '../lib/library-formats'

const props = withDefaults(defineProps<{ counts: Record<string, number>; legendLimit?: number; showLegend?: boolean; legendReserve?: boolean }>(), {
  legendLimit: 3,
  showLegend: false,
  legendReserve: false,
})

const { t } = useI18n()

const segments = computed(() => toFormatSegments(props.counts))
const legend = computed(() => segments.value.slice(0, props.legendLimit))
const overflow = computed(() => segments.value.length - legend.value.length)

/** The bar is decorative next to the legend, so the summary is what assistive tech reads. */
const summary = computed(() => {
  if (segments.value.length === 0) return t('settings.admin.libraries.noFilesIndexed')
  return segments.value
    .map((segment) => t('settings.admin.libraries.formatEntry', { format: segment.format.toUpperCase(), count: segment.count }))
    .join(', ')
})
</script>

<template>
  <div>
    <!-- Always the same one-pixel track, so an empty library keeps its row level with the rest. -->
    <div
      class="flex h-1 gap-px overflow-hidden rounded-full bg-muted"
      :class="showLegend ? 'w-full' : 'w-24'"
      role="img"
      :aria-label="summary"
      :title="summary"
    >
      <span
        v-for="segment in segments"
        :key="segment.format"
        class="h-full first:rounded-s-full last:rounded-e-full"
        :style="{ width: `${segment.percent}%`, backgroundColor: segment.color }"
      />
    </div>
    <template v-if="showLegend">
      <!-- Two lines are reserved in the ledger so a five-format library never stands taller than a one-format one. -->
      <p
        v-if="segments.length > 0"
        class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground"
        :class="legendReserve ? 'min-h-9 content-start' : ''"
        aria-hidden="true"
      >
        <span v-for="segment in legend" :key="segment.format" class="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span class="size-1.5 shrink-0 rounded-[2px]" :style="{ backgroundColor: segment.color }" />
          {{ segment.format.toUpperCase() }}
          <span class="font-medium tabular-nums text-foreground">{{ formatNumber(segment.count) }}</span>
        </span>
        <span v-if="overflow > 0" class="whitespace-nowrap">{{ t('settings.admin.libraries.formatOverflow', { count: overflow }) }}</span>
      </p>
      <p v-else class="mt-1.5 text-xs text-muted-foreground" :class="legendReserve ? 'min-h-9' : ''">
        {{ t('settings.admin.libraries.noFilesIndexed') }}
      </p>
    </template>
  </div>
</template>
