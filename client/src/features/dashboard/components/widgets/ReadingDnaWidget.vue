<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Dna } from '@lucide/vue'

import { useReadingDnaWidget } from '../../composables/useReadingDnaWidget'

const { data, loading, error } = useReadingDnaWidget()
const { t } = useI18n()

const traitColors: Record<string, string> = {
  length: 'bg-blue-500',
  variety: 'bg-emerald-500',
  rhythm: 'bg-amber-500',
  time: 'bg-purple-500',
  speed: 'bg-rose-500',
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-2 flex items-center gap-2 self-start">
      <Dna :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.readingDna.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-4 w-32 animate-pulse rounded bg-muted" />
      <div v-for="n in 5" :key="n" class="h-2 w-full animate-pulse rounded-full bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Not enough data -->
    <div v-else-if="!data || data.booksAnalyzed < 5" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Dna :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.readingDna.notEnoughData') }}</p>
    </div>

    <!-- DNA Card -->
    <div v-else class="flex flex-1 flex-col justify-center gap-2.5">
      <p class="text-center text-sm font-bold text-foreground">"{{ data.archetype }}"</p>

      <div class="space-y-1.5">
        <div
          v-for="trait in [
            { key: 'length', label: t('dashboard.widgets.readingDna.traits.length'), score: data.lengthScore, valueLabel: data.lengthLabel },
            { key: 'variety', label: t('dashboard.widgets.readingDna.traits.variety'), score: data.varietyScore, valueLabel: data.varietyLabel },
            { key: 'rhythm', label: t('dashboard.widgets.readingDna.traits.rhythm'), score: data.rhythmScore, valueLabel: data.rhythmLabel },
            { key: 'time', label: t('dashboard.widgets.readingDna.traits.time'), score: data.timeScore, valueLabel: data.timeLabel },
            { key: 'speed', label: t('dashboard.widgets.readingDna.traits.speed'), score: data.speedScore, valueLabel: data.speedLabel },
          ]"
          :key="trait.key"
          class="flex items-center gap-2"
        >
          <span class="w-12 text-right text-[10px] text-muted-foreground">{{ trait.label }}</span>
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full transition-all duration-500" :class="traitColors[trait.key]" :style="{ width: `${trait.score}%` }" />
          </div>
          <span class="w-18 text-[10px] text-muted-foreground">{{ trait.valueLabel }}</span>
        </div>
      </div>

      <p class="text-center text-[10px] text-muted-foreground">
        {{ t('dashboard.widgets.readingDna.basedOn', { count: data.booksAnalyzed }, data.booksAnalyzed) }}
      </p>
    </div>
  </div>
</template>
