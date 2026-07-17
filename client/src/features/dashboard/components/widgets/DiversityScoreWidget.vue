<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Compass } from '@lucide/vue'

import { useDiversityScoreWidget } from '../../composables/useDiversityScoreWidget'

const { data, loading, error } = useDiversityScoreWidget()
const { t } = useI18n()

const subScores = computed(
  () =>
    [
      { key: 'genre', label: t('dashboard.widgets.diversityScore.subScores.genre') },
      { key: 'author', label: t('dashboard.widgets.diversityScore.subScores.author') },
      { key: 'era', label: t('dashboard.widgets.diversityScore.subScores.era') },
      { key: 'language', label: t('dashboard.widgets.diversityScore.subScores.language') },
    ] as const,
)
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <Compass :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.diversityScore.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-10 w-10 animate-pulse rounded-full bg-muted" />
      <div class="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Not enough data -->
    <div v-else-if="!data || data.booksAnalyzed < 3" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Compass :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.diversityScore.notEnoughData') }}</p>
    </div>

    <!-- Score -->
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2.5">
      <div class="flex flex-col items-center">
        <span class="text-3xl font-bold tabular-nums">{{ data.score }}</span>
        <span class="text-[11px] text-muted-foreground">/100</span>
      </div>
      <p class="text-xs font-medium text-primary">{{ data.label }}</p>

      <div class="w-full space-y-1">
        <div v-for="sub in subScores" :key="sub.key" class="flex items-center gap-2">
          <span class="w-9 text-right text-[10px] text-muted-foreground">{{ sub.label }}</span>
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full bg-primary/70 transition-all duration-500" :style="{ width: `${data[`${sub.key}Score`]}%` }" />
          </div>
        </div>
      </div>

      <p class="text-[10px] text-muted-foreground">
        {{ t('dashboard.widgets.diversityScore.booksAnalyzed', { count: data.booksAnalyzed }, data.booksAnalyzed) }}
      </p>
    </div>
  </div>
</template>
