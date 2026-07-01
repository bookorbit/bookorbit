<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Swords } from '@lucide/vue'

import { useMonthlyChallengeWidget } from '../../composables/useMonthlyChallengeWidget'

const { data, loading, error } = useMonthlyChallengeWidget()
const { t } = useI18n()
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <Swords :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.monthlyChallenge.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-10 w-10 animate-pulse rounded-full bg-muted" />
      <div class="h-3 w-24 animate-pulse rounded bg-muted" />
      <div class="h-2 w-full animate-pulse rounded-full bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Data -->
    <div v-else-if="data" class="flex flex-1 flex-col items-center justify-center gap-2.5">
      <div class="text-center">
        <p class="text-sm font-bold">{{ data.title }}</p>
        <p class="mt-0.5 text-[11px] text-muted-foreground">{{ data.description }}</p>
      </div>

      <!-- Progress bar -->
      <div class="w-full">
        <div class="h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="data.completed ? 'bg-green-500' : 'bg-primary'"
            :style="{ width: `${Math.min(100, (data.progress / data.target) * 100)}%` }"
          />
        </div>
        <div class="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{{ data.progress }} / {{ data.target }}</span>
          <span v-if="data.completed" class="font-medium text-green-500">{{ t('dashboard.widgets.monthlyChallenge.complete') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
