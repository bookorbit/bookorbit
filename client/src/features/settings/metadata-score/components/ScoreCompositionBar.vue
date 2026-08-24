<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MetadataScoreGroup, MetadataScoreWeights } from '@bookorbit/types'
import { formatPercent } from '@/i18n/formatters'
import { scoreComposition } from '../lib/score-weights'

const { t } = useI18n()

const props = defineProps<{ weights: MetadataScoreWeights }>()

/**
 * Fixed per group rather than generated, so a group keeps its colour as the bar re-sorts. All five
 * are theme tokens tinted against the card, which keeps them legible on either ground.
 */
const GROUP_FILL: Record<MetadataScoreGroup, { fill: string; ink: string }> = {
  core: { fill: 'color-mix(in oklch, var(--primary) 62%, var(--card))', ink: 'var(--primary-foreground)' },
  publishing: { fill: 'color-mix(in oklch, var(--primary) 34%, var(--card))', ink: 'var(--foreground)' },
  classification: { fill: 'color-mix(in oklch, var(--primary) 18%, var(--card))', ink: 'var(--foreground)' },
  providers: { fill: 'color-mix(in oklch, var(--warning) 26%, var(--card))', ink: 'var(--foreground)' },
  enrichment: { fill: 'color-mix(in oklch, var(--success) 26%, var(--card))', ink: 'var(--foreground)' },
}

const segments = computed(() =>
  scoreComposition(props.weights).map((segment) => ({
    ...segment,
    label: t(`settings.admin.scoreWeights.groups.${segment.group}`),
    percent: formatPercent(segment.share / 100, 1),
    fill: GROUP_FILL[segment.group].fill,
    ink: GROUP_FILL[segment.group].ink,
  })),
)

const summary = computed(() => segments.value.map((segment) => `${segment.label} ${segment.percent}`).join(', '))
</script>

<template>
  <div>
    <div class="flex h-10 overflow-hidden rounded-lg border border-border bg-card" role="img" :aria-label="summary">
      <!-- Only a segment wide enough to hold its text keeps a label. A 3.8% slice is 13px on a phone,
           so the legend below carries the numbers instead of truncating them into nonsense. -->
      <div
        v-for="segment in segments"
        :key="segment.group"
        class="flex min-w-0 flex-col justify-center border-r border-black/25 px-3 last:border-r-0"
        :style="{ width: `${segment.share}%`, backgroundColor: segment.fill, color: segment.ink }"
      >
        <template v-if="segment.share > 15">
          <span class="hidden truncate text-[10px] font-semibold leading-tight md:block">{{ segment.label }}</span>
          <span class="hidden truncate text-[11px] leading-tight tabular-nums md:block">{{ segment.percent }}</span>
        </template>
      </div>
    </div>

    <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      <li v-for="segment in segments" :key="segment.group" class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span class="size-2 shrink-0 rounded-[3px]" :style="{ backgroundColor: segment.fill }" aria-hidden="true" />
        {{ segment.label }}
        <span class="font-semibold tabular-nums text-foreground">{{ segment.percent }}</span>
      </li>
    </ul>
  </div>
</template>
