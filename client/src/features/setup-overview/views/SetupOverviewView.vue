<script setup lang="ts">
import { computed } from 'vue'
import { TriangleAlert } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

import { formatNumber } from '@/i18n/formatters'
import FlowCard from '../components/FlowCard.vue'
import SystemMap from '../components/SystemMap.vue'
import { useSetupOverview } from '../composables/useSetupOverview'
import { useSetupText } from '../lib/text'

const { t } = useI18n()
const text = useSetupText()
const { overview, loading, failed, reload } = useSetupOverview()

/** Everything on the page that needs a person, which the strip and the map both lead with. */
const needYou = computed(() => overview.value?.cards.reduce((sum, card) => sum + card.warnings.length, 0) ?? 0)

function handleRetry(): void {
  void reload()
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <div v-if="loading" class="flex flex-col gap-3.5" aria-busy="true">
      <div v-for="n in 3" :key="n" class="h-44 animate-pulse rounded-xl border border-border bg-card" />
      <span class="sr-only">{{ t('setupOverview.loading') }}</span>
    </div>

    <div v-else-if="failed" class="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-5" role="alert">
      <span class="inline-flex items-center gap-2 text-sm font-medium text-foreground">
        <TriangleAlert :size="15" class="text-warning" aria-hidden="true" />
        {{ t('setupOverview.error.title') }}
      </span>
      <p class="text-xs text-muted-foreground">{{ t('setupOverview.error.detail') }}</p>
      <button
        type="button"
        class="mt-1 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
        @click="handleRetry"
      >
        {{ t('setupOverview.error.retry') }}
      </button>
    </div>

    <template v-else-if="overview">
      <div v-if="overview.stats.length || needYou" class="flex flex-wrap items-center gap-1.5">
        <span v-if="needYou" class="inline-flex h-7 items-center gap-1.5 rounded-full bg-warning/14 px-2.5 text-xs font-medium text-warning">
          <TriangleAlert :size="11" aria-hidden="true" />
          {{ t('setupOverview.needYou', { count: needYou }) }}
        </span>
        <!-- Separators sit on each item's leading edge; the strip clips the one that starts a line. -->
        <span
          v-if="overview.stats.length"
          class="inline-flex max-w-full flex-wrap items-center overflow-hidden rounded-[14px] border border-border bg-card"
        >
          <span
            v-for="stat in overview.stats"
            :key="stat.code"
            class="relative inline-flex h-7 items-center gap-1 px-3 text-xs whitespace-nowrap text-muted-foreground before:absolute before:start-[-1px] before:top-1/2 before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-border"
          >
            <b class="font-semibold text-foreground tabular-nums">{{ formatNumber(stat.value) }}</b>
            {{ text(stat.label) }}
          </span>
        </span>
      </div>

      <SystemMap v-if="overview.map" :map="overview.map" :need-you="needYou" />

      <FlowCard v-for="card in overview.cards" :key="card.id" :card="card" />

      <p v-if="!overview.cards.length" class="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
        {{ t('setupOverview.empty') }}
      </p>
    </template>
  </div>
</template>
