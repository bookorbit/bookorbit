<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MetadataScoreDistribution } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'

const { t } = useI18n()

const props = defineProps<{
  distribution: MetadataScoreDistribution | null
  loading?: boolean
}>()

/** The bands MetadataScoreBadge already paints on every book card. */
const BANDS = [
  { key: 'poor', from: 0, to: 50, fill: 'color-mix(in oklch, var(--destructive) 26%, transparent)', ink: 'var(--destructive)' },
  { key: 'fair', from: 50, to: 70, fill: 'color-mix(in oklch, var(--warning) 26%, transparent)', ink: 'var(--warning)' },
  { key: 'good', from: 70, to: 90, fill: 'color-mix(in oklch, var(--success) 20%, transparent)', ink: 'var(--success)' },
  { key: 'great', from: 90, to: 100, fill: 'color-mix(in oklch, var(--success) 38%, transparent)', ink: 'var(--success)' },
] as const

const total = computed(() => props.distribution?.totalCount ?? 0)
const hasData = computed(() => total.value > 0)
const median = computed(() => props.distribution?.percentile50 ?? null)
const maxCount = computed(() => props.distribution?.bins.reduce((max, bin) => Math.max(max, bin.count), 0) ?? 0)

const bins = computed(() =>
  (props.distribution?.bins ?? []).map((bin) => ({
    ...bin,
    height: maxCount.value > 0 ? Math.max(2, (bin.count / maxCount.value) * 100) : 0,
  })),
)

const belowFifty = computed(() => (props.distribution?.bins ?? []).filter((bin) => bin.minScore < 50).reduce((sum, bin) => sum + bin.count, 0))
const ninetyPlus = computed(() => (props.distribution?.bins ?? []).filter((bin) => bin.minScore >= 90).reduce((sum, bin) => sum + bin.count, 0))

const stats = computed(() => [
  { key: 'median', label: t('settings.admin.scoreWeights.rail.median'), value: median.value === null ? '-' : formatNumber(Math.round(median.value)) },
  { key: 'below', label: t('settings.admin.scoreWeights.rail.belowFifty'), value: formatNumber(belowFifty.value) },
  { key: 'great', label: t('settings.admin.scoreWeights.rail.ninetyPlus'), value: formatNumber(ninetyPlus.value) },
])
</script>

<template>
  <section class="border-t border-border px-4 py-4 md:px-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <div class="lg:w-56 lg:shrink-0">
        <h3 class="settings-group-label !mb-1">{{ t('settings.admin.scoreWeights.rail.title') }}</h3>
        <p class="text-xs leading-relaxed text-muted-foreground">{{ t('settings.admin.scoreWeights.rail.description') }}</p>
      </div>

      <div v-if="loading" class="flex-1 text-xs text-muted-foreground">{{ t('common.loading') }}</div>

      <p v-else-if="!hasData" class="flex-1 text-xs text-muted-foreground">
        {{ t('settings.admin.scoreWeights.rail.noBooks') }}
      </p>

      <template v-else>
        <div class="min-w-0 flex-1">
          <!-- Bars sit above the bands so a bin reads against the badge colour its books actually get. -->
          <div class="flex h-16 items-end gap-[3px]" aria-hidden="true">
            <div v-for="bin in bins" :key="bin.minScore" class="flex h-full flex-1 items-end">
              <div class="w-full rounded-t-sm bg-foreground/25" :style="{ height: `${bin.height}%` }" />
            </div>
          </div>
          <div
            class="mt-1 flex h-7 overflow-hidden rounded-md border border-border"
            role="img"
            :aria-label="t('settings.admin.scoreWeights.rail.bandsLabel')"
          >
            <div
              v-for="band in BANDS"
              :key="band.key"
              class="flex items-center justify-center text-[9px] font-bold tracking-wider"
              :style="{ width: `${band.to - band.from}%`, backgroundColor: band.fill, color: band.ink }"
            >
              {{ t(`settings.admin.scoreWeights.rail.bands.${band.key}`) }}
            </div>
          </div>
          <div class="relative mt-1 h-4 text-[10px] tabular-nums text-muted-foreground">
            <span class="absolute left-0">0</span>
            <span class="absolute left-1/2 -translate-x-1/2">50</span>
            <span class="absolute left-[70%] -translate-x-1/2">70</span>
            <span class="absolute left-[90%] -translate-x-1/2">90</span>
            <span class="absolute right-0">100</span>
          </div>
        </div>

        <dl class="flex shrink-0 gap-6">
          <div v-for="stat in stats" :key="stat.key">
            <dt class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ stat.label }}</dt>
            <dd class="mt-0.5 text-base font-semibold tabular-nums text-foreground">{{ stat.value }}</dd>
          </div>
        </dl>
      </template>
    </div>

    <p v-if="hasData" class="mt-3 text-[11px] text-muted-foreground">
      {{ t('settings.admin.scoreWeights.rail.scopeNote', { count: total }) }}
    </p>
  </section>
</template>
