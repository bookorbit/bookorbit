<script setup lang="ts">
import { computed } from 'vue'
import { BarChart3, Check, CircleAlert, Info, KeyRound, Loader2, TriangleAlert, Zap } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { AI_FEATURE_DEFINITIONS, AI_SLOTS, type AiConnection, type AiOverview, type AiSettings, type AiSlot } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { formatList, formatNumber, formatPercent } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'
import type { AiLoadState } from '../composables/useAiAdmin'
import { featureShortName, formatAiCost, formatDollars, slotLabel, slotList } from '../lib/ai-format'
import AiMeter from './AiMeter.vue'

const props = defineProps<{
  overview: AiOverview | null
  state: AiLoadState
  connections: AiConnection[]
  /** False until the connections load; the first-run steps wait for them. */
  connectionsReady: boolean
  settings: AiSettings | null
  testingId: number | null
}>()

const emit = defineEmits<{
  retry: []
  viewUsage: []
  testConnection: [id: number]
  openSlot: [slot: AiSlot]
  raiseLimit: []
}>()

const { t } = useI18n()

const budget = computed(() => props.overview?.budget ?? null)
const limit = computed(() => budget.value?.monthlyBudget ?? null)

type StepState = 'done' | 'now' | 'later'

/** The three steps, each done once the server has what it asks for. The first one not done is the current one. */
const steps = computed(() => {
  const settings = props.settings
  if (!props.connectionsReady || !settings) return null
  const done = [
    props.connections.length > 0,
    settings.features.some((feature) => feature.missingSlots.length === 0),
    settings.features.some((feature) => feature.settings.enabled),
  ]
  const current = done.indexOf(false)
  const state = (index: number): StepState => (done[index] ? 'done' : index === current ? 'now' : 'later')
  return [
    {
      key: 'provider',
      state: state(0),
      title: t('settings.admin.ai.status.setup.provider'),
      brief: t('settings.admin.ai.status.setup.providerBrief'),
    },
    { key: 'models', state: state(1), title: t('settings.admin.ai.status.setup.models'), brief: slotList(AI_SLOTS) },
    {
      key: 'features',
      state: state(2),
      title: t('settings.admin.ai.status.setup.features'),
      brief: formatList(Object.keys(AI_FEATURE_DEFINITIONS).map(featureShortName)),
    },
  ]
})

/** A server with nothing spent and setup unfinished gets the steps instead of a row of zeros. */
const showSetup = computed(() => {
  const overview = props.overview
  if (!overview || !steps.value) return false
  return overview.month.requests === 0 && steps.value.some((step) => step.state !== 'done')
})

const somethingFailing = computed(() => Boolean(props.overview && (props.overview.failingConnections.length || props.overview.failingSlots.length)))

/** Features turned on that need a slot this connection serves, so the alert says what stops. */
function featuresStoppedBy(connectionId: number): string[] {
  const settings = props.settings
  if (!settings) return []
  const slots = AI_SLOTS.filter((slot) => settings.slots[slot].connectionId === connectionId)
  return settings.features
    .filter((feature) => feature.settings.enabled && Object.hasOwn(AI_FEATURE_DEFINITIONS, feature.id))
    .filter((feature) => AI_FEATURE_DEFINITIONS[feature.id].slots.some((slot) => slots.includes(slot)))
    .map((feature) => featureShortName(feature.id))
}

const failingConnections = computed(() =>
  (props.overview?.failingConnections ?? []).map((connection) => ({
    ...connection,
    time: relativeTimestamp(connection.failingSince),
    features: formatList(featuresStoppedBy(connection.id)),
  })),
)

/** A slot failing because its connection is down is already explained by the connection's alert. */
const failingSlots = computed(() => {
  const overview = props.overview
  if (!overview) return []
  const down = new Set(overview.failingConnections.map((connection) => connection.id))
  return overview.failingSlots
    .filter((slot) => {
      const connectionId = props.settings?.slots[slot.slot]?.connectionId
      return connectionId === undefined || connectionId === null || !down.has(connectionId)
    })
    .map((slot) => ({ ...slot, time: relativeTimestamp(slot.failingSince) }))
})

const budgetAlert = computed(() => {
  const state = budget.value
  if (!state || state.monthlyBudget === null) return null
  const amount = formatDollars(state.monthlyBudget)
  if (state.exhausted) return { tone: 'error' as const, text: t('settings.admin.ai.status.budgetExhausted', { budget: amount }) }
  if (state.warning) {
    return {
      tone: 'warning' as const,
      text: t('settings.admin.ai.status.budgetWarning', { percent: formatPercent(state.used ?? 0), budget: amount }),
    }
  }
  return null
})

/** The slot whose missing prices leave requests uncounted, so the note can lead to it. */
const unpricedSlot = computed(() => {
  const slots = props.settings?.slots
  if (!slots) return null
  return AI_SLOTS.find((slot) => slots[slot].model !== null && slots[slot].prices === null) ?? null
})

function handleViewUsage() {
  emit('viewUsage')
}

function handleRetry() {
  emit('retry')
}

function handleRaiseLimit() {
  emit('raiseLimit')
}

function handleTestConnection(id: number) {
  emit('testConnection', id)
}

function handleOpenSlot(slot: AiSlot) {
  emit('openSlot', slot)
}

function handleAddPrices() {
  if (unpricedSlot.value) emit('openSlot', unpricedSlot.value)
}
</script>

<template>
  <section :aria-label="t('settings.admin.ai.status.label')" data-testid="ai-status">
    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !overview" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.overview.loadFailed')" @retry="handleRetry" />
    </div>

    <div v-else class="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <div v-if="showSetup && steps" class="p-5 max-md:p-4" data-testid="ai-setup">
        <h3 class="text-base leading-[22px] font-semibold text-foreground">{{ t('settings.admin.ai.status.setup.title') }}</h3>
        <p class="mt-1 max-w-[64ch] text-[13px] leading-[18px] text-muted-foreground">{{ t('settings.admin.ai.status.setup.brief') }}</p>
        <ol class="mt-4 grid gap-2.5 md:grid-cols-3">
          <li
            v-for="(step, index) in steps"
            :key="step.key"
            class="flex min-w-0 gap-2.5 rounded-md border p-3"
            :class="step.state === 'now' ? 'border-primary/55 bg-primary/7' : 'border-border bg-surface-2'"
            :aria-current="step.state === 'now' ? 'step' : undefined"
            :data-step="step.key"
            :data-state="step.state"
          >
            <span
              class="grid size-[22px] shrink-0 place-items-center rounded-full text-xs font-semibold"
              :class="{
                'bg-primary text-primary-foreground': step.state === 'now',
                'bg-success/18 text-success': step.state === 'done',
                'bg-muted text-muted-foreground': step.state === 'later',
              }"
              aria-hidden="true"
            >
              <Check v-if="step.state === 'done'" class="size-[13px]" />
              <template v-else>{{ formatNumber(index + 1) }}</template>
            </span>
            <span class="min-w-0">
              <span class="block text-[13px] leading-[18px] font-semibold text-foreground">{{ step.title }}</span>
              <span class="block text-xs leading-4 text-muted-foreground">{{ step.brief }}</span>
              <span v-if="step.state === 'done'" class="sr-only">{{ t('settings.admin.ai.status.setup.done') }}</span>
            </span>
          </li>
        </ol>
      </div>

      <dl
        v-else
        class="grid grid-cols-2 gap-x-4 gap-y-3.5 p-3.5 md:grid-cols-[repeat(4,minmax(0,1fr))_auto] md:items-center md:gap-5 md:px-5 md:py-4"
      >
        <div class="min-w-0">
          <dt class="text-xs leading-4 text-muted-foreground">{{ t('settings.admin.ai.status.requests') }}</dt>
          <dd class="mt-0.5 text-lg leading-6 font-semibold whitespace-nowrap text-foreground tabular-nums" data-testid="ai-status-requests">
            {{ formatNumber(overview.month.requests) }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-xs leading-4 text-muted-foreground">
            {{ limit !== null ? t('settings.admin.ai.status.spentOf', { budget: formatDollars(limit) }) : t('settings.admin.ai.status.spent') }}
          </dt>
          <dd class="mt-0.5 text-lg leading-6 font-semibold whitespace-nowrap text-foreground tabular-nums" data-testid="ai-status-spent">
            {{ formatAiCost(overview.month.costMicros) }}
            <span
              v-if="limit !== null && budget?.used !== null && budget?.used !== undefined"
              class="text-[13px] font-medium text-muted-foreground"
              >{{ formatPercent(budget.used) }}</span
            >
          </dd>
          <AiMeter
            v-if="limit !== null && budget?.used !== null && budget?.used !== undefined"
            class="mt-1.5 max-w-[170px]"
            :used="budget.used"
            :label="t('settings.admin.ai.status.budgetUsed')"
          />
        </div>
        <div class="min-w-0">
          <dt class="text-xs leading-4 text-muted-foreground">{{ t('settings.admin.ai.status.built') }}</dt>
          <dd class="mt-0.5 text-lg leading-6 font-semibold whitespace-nowrap text-foreground tabular-nums">
            {{ formatNumber(overview.budget.buildsThisMonth) }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-xs leading-4 text-muted-foreground">{{ t('settings.admin.ai.status.failed') }}</dt>
          <dd class="mt-0.5 flex items-baseline gap-2 text-lg leading-6 font-semibold whitespace-nowrap tabular-nums">
            <span :class="somethingFailing && overview.month.errors > 0 ? 'text-destructive' : 'text-foreground'" data-testid="ai-status-failed">{{
              formatNumber(overview.month.errors)
            }}</span>
            <button
              v-if="overview.month.errors > 0"
              type="button"
              class="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              @click="handleViewUsage"
            >
              {{ t('settings.admin.ai.status.review') }}
            </button>
          </dd>
        </div>
        <div class="max-md:col-span-full">
          <Button variant="outline" size="sm" @click="handleViewUsage">
            <BarChart3 class="size-3.5" />
            {{ t('settings.admin.ai.overview.viewUsage') }}
          </Button>
        </div>
      </dl>

      <div aria-live="polite" data-testid="ai-status-alerts">
        <div
          v-if="!overview.encryptionConfigured"
          class="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-[13px] leading-[18px] max-md:flex-wrap md:px-5"
          data-testid="ai-encryption-missing"
        >
          <KeyRound class="size-4 shrink-0 text-warning" aria-hidden="true" />
          <p class="min-w-0 flex-1 text-foreground">{{ t('settings.admin.ai.overview.encryptionMissing') }}</p>
        </div>

        <div
          v-for="connection in failingConnections"
          :key="`c-${connection.id}`"
          class="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-[13px] leading-[18px] max-md:flex-wrap md:px-5"
          data-testid="ai-status-connection-failing"
        >
          <CircleAlert class="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <i18n-t
            :keypath="connection.features ? 'settings.admin.ai.status.connectionFailingFeatures' : 'settings.admin.ai.status.connectionFailing'"
            tag="p"
            class="min-w-0 flex-1 text-foreground"
            scope="global"
          >
            <template #name>
              <strong class="font-semibold">{{ connection.name }}</strong>
            </template>
            <template #time>{{ connection.time }}</template>
            <template #features>
              <strong class="font-semibold">{{ connection.features }}</strong>
            </template>
          </i18n-t>
          <Button variant="outline" size="sm" :disabled="testingId === connection.id" @click="handleTestConnection(connection.id)">
            <Loader2 v-if="testingId === connection.id" class="size-3.5 animate-spin" />
            <Zap v-else class="size-3.5" />
            {{ t('settings.admin.ai.status.testAgain') }}
          </Button>
        </div>

        <div
          v-for="slot in failingSlots"
          :key="`s-${slot.slot}`"
          class="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-[13px] leading-[18px] max-md:flex-wrap md:px-5"
          data-testid="ai-status-slot-failing"
        >
          <CircleAlert class="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p class="min-w-0 flex-1 text-foreground">
            {{ t('settings.admin.ai.status.slotFailing', { slot: slotLabel(slot.slot), model: slot.model, time: slot.time }) }}
          </p>
          <Button variant="outline" size="sm" @click="handleOpenSlot(slot.slot)">{{ t('settings.admin.ai.status.show') }}</Button>
        </div>

        <div
          v-if="budgetAlert"
          class="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-[13px] leading-[18px] max-md:flex-wrap md:px-5"
          data-testid="ai-status-budget"
        >
          <CircleAlert v-if="budgetAlert.tone === 'error'" class="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <TriangleAlert v-else class="size-4 shrink-0 text-warning" aria-hidden="true" />
          <p class="min-w-0 flex-1 text-foreground">{{ budgetAlert.text }}</p>
          <Button variant="outline" size="sm" @click="handleRaiseLimit">{{ t('settings.admin.ai.status.raiseLimit') }}</Button>
        </div>

        <div
          v-if="overview.month.unknownCostRequests > 0"
          class="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-[13px] leading-[18px] max-md:flex-wrap md:px-5"
          data-testid="ai-status-unpriced"
        >
          <Info class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p class="min-w-0 flex-1 text-muted-foreground">
            {{ t('settings.admin.ai.status.unknownCost', { count: overview.month.unknownCostRequests }) }}
            <button
              v-if="unpricedSlot"
              type="button"
              class="ms-1 text-xs font-medium whitespace-nowrap text-primary underline-offset-2 hover:underline focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              @click="handleAddPrices"
            >
              {{ t('settings.admin.ai.status.addPrices') }}
            </button>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
