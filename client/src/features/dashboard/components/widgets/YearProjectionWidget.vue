<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { TrendingUp, TrendingDown, Minus } from '@lucide/vue'

import { useYearProjectionWidget } from '../../composables/useYearProjectionWidget'

const { data, loading, error } = useYearProjectionWidget()
const { t } = useI18n()

const trendIcons = { up: TrendingUp, down: TrendingDown, stable: Minus }
const trendColors = { up: 'text-green-500', down: 'text-red-400', stable: 'text-muted-foreground' }
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <TrendingUp :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.yearProjection.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-8 w-16 animate-pulse rounded bg-muted" />
      <div class="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Data -->
    <div v-else-if="data" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="text-center">
        <span class="text-3xl font-bold tabular-nums">{{ data.projectedBooks }}</span>
        <span class="ml-1 text-xs text-muted-foreground">{{ t('dashboard.widgets.yearProjection.books') }}</span>
      </div>

      <div class="flex items-center gap-1 text-xs" :class="trendColors[data.trend]">
        <component :is="trendIcons[data.trend]" :size="14" />
        <span>{{
          data.trend === 'up'
            ? t('dashboard.widgets.yearProjection.trendUp')
            : data.trend === 'down'
              ? t('dashboard.widgets.yearProjection.trendDown')
              : t('dashboard.widgets.yearProjection.trendSteady')
        }}</span>
      </div>

      <div class="grid w-full grid-cols-2 gap-3 text-center">
        <div class="rounded-md bg-muted/30 px-2 py-1">
          <span class="block text-xs font-semibold tabular-nums">{{ formatNumber(data.projectedPages) }}</span>
          <span class="text-[11px] text-muted-foreground">{{ t('dashboard.widgets.yearProjection.pages') }}</span>
        </div>
        <div class="rounded-md bg-muted/30 px-2 py-1">
          <span class="block text-xs font-semibold tabular-nums">{{ data.projectedHours }}</span>
          <span class="text-[11px] text-muted-foreground">{{ t('dashboard.widgets.yearProjection.hours') }}</span>
        </div>
      </div>

      <p class="text-[11px] text-muted-foreground">
        {{ t('dashboard.widgets.yearProjection.readCount', { count: data.booksCompletedYtd }) }} &middot;
        {{ t('dashboard.widgets.yearProjection.daysLeft', { count: data.daysRemaining }) }}
      </p>
    </div>
  </div>
</template>
