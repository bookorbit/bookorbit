<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, BarChart3, KeyRound, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { AiOverview, AiSlot } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'
import type { AiLoadState } from '../composables/useAiAdmin'
import { failureText, formatAiCost, formatDollars, slotLabel } from '../lib/ai-format'

const props = defineProps<{
  overview: AiOverview | null
  state: AiLoadState
}>()

const emit = defineEmits<{
  retry: []
  viewUsage: []
  showConnection: [id: number]
  showSlot: [slot: AiSlot]
}>()

const { t } = useI18n()

const budget = computed(() => props.overview?.budget ?? null)

const costLine = computed(() => {
  const overview = props.overview
  if (!overview) return ''
  const cost = formatAiCost(overview.month.costMicros)
  return budget.value?.monthlyBudget !== null && budget.value?.monthlyBudget !== undefined
    ? t('settings.admin.ai.overview.costOfBudget', { cost, budget: formatDollars(budget.value.monthlyBudget) })
    : t('settings.admin.ai.overview.cost', { cost })
})

const budgetLine = computed(() => {
  const state = budget.value
  if (!state) return null
  if (state.exhausted) return { tone: 'error' as const, text: t('settings.admin.ai.overview.budgetExhausted') }
  if (state.warning && state.used !== null)
    return { tone: 'warning' as const, text: t('settings.admin.ai.overview.budgetWarning', { percent: formatPercent(state.used) }) }
  if (state.countsBuilds && state.buildsPerMonth !== null) {
    return {
      tone: 'idle' as const,
      text: t('settings.admin.ai.overview.builds', { count: state.buildsThisMonth, limit: formatNumber(state.buildsPerMonth) }),
    }
  }
  return null
})
</script>

<template>
  <section aria-labelledby="ai-overview-title" class="flex flex-col gap-3">
    <h3 id="ai-overview-title" class="settings-group-label mb-0">{{ t('settings.admin.ai.overview.title') }}</h3>

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !overview" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.overview.loadFailed')" @retry="emit('retry')" />
    </div>

    <template v-else>
      <div
        v-if="!overview.encryptionConfigured"
        class="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
        data-testid="ai-encryption-missing"
      >
        <KeyRound class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p>{{ t('settings.admin.ai.overview.encryptionMissing') }}</p>
      </div>

      <div class="settings-card">
        <div class="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
          <dl class="grid grid-cols-2 gap-x-8 gap-y-2 sm:flex sm:gap-10">
            <div>
              <dt class="settings-hint mt-0">{{ t('settings.admin.ai.overview.requestsLabel') }}</dt>
              <dd class="settings-value text-lg" data-testid="ai-overview-requests">{{ formatNumber(overview.month.requests) }}</dd>
            </div>
            <div>
              <dt class="settings-hint mt-0">{{ t('settings.admin.ai.overview.costLabel') }}</dt>
              <dd class="settings-value text-lg" data-testid="ai-overview-cost">{{ costLine }}</dd>
            </div>
            <div v-if="overview.month.errors > 0">
              <dt class="settings-hint mt-0">{{ t('settings.admin.ai.overview.errorsLabel') }}</dt>
              <dd class="settings-value text-lg">{{ formatNumber(overview.month.errors) }}</dd>
            </div>
          </dl>
          <Button variant="outline" size="sm" class="self-start sm:self-center" @click="emit('viewUsage')">
            <BarChart3 class="size-3.5" />
            {{ t('settings.admin.ai.overview.viewUsage') }}
          </Button>
        </div>

        <p v-if="overview.month.unknownCostRequests > 0" class="px-4 py-2.5 text-xs text-muted-foreground md:px-5">
          {{ t('settings.admin.ai.overview.unknownCost', { count: overview.month.unknownCostRequests }) }}
        </p>

        <p
          v-if="budgetLine"
          class="flex items-center gap-2 px-4 py-2.5 text-xs md:px-5"
          :class="{
            'text-destructive': budgetLine.tone === 'error',
            'text-foreground': budgetLine.tone === 'warning',
            'text-muted-foreground': budgetLine.tone === 'idle',
          }"
          data-testid="ai-overview-budget"
        >
          <AlertTriangle
            v-if="budgetLine.tone !== 'idle'"
            class="size-3.5 shrink-0"
            :class="budgetLine.tone === 'warning' ? 'text-warning' : ''"
            aria-hidden="true"
          />
          {{ budgetLine.text }}
        </p>

        <ul
          v-if="overview.failingConnections.length || overview.failingSlots.length"
          class="flex flex-col gap-1.5 px-4 py-3 md:px-5"
          data-testid="ai-overview-failing"
        >
          <li v-for="connection in overview.failingConnections" :key="`c-${connection.id}`" class="text-xs">
            <button
              type="button"
              class="text-start text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="emit('showConnection', connection.id)"
            >
              {{ t('settings.admin.ai.overview.failingConnection', { name: connection.name, time: relativeTimestamp(connection.failingSince) }) }}
            </button>
            <span class="text-muted-foreground">: {{ failureText(connection.code, { message: connection.reason }) }}</span>
          </li>
          <li v-for="slot in overview.failingSlots" :key="`s-${slot.slot}`" class="text-xs">
            <button
              type="button"
              class="text-start text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="emit('showSlot', slot.slot)"
            >
              {{ t('settings.admin.ai.overview.failingSlot', { slot: slotLabel(slot.slot), model: slot.model }) }}
            </button>
            <span class="text-muted-foreground">: {{ failureText(slot.code, { message: slot.reason }) }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
