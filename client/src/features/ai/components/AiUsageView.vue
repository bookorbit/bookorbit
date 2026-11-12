<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { ArrowLeft, Download, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { AiUsageReport, AiUsageTotals } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { formatCompactNumber, formatDateTime, formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import * as aiApi from '../api/ai.api'
import type { AiLoadState } from '../composables/useAiAdmin'
import { formatAiCost, monthLabel, outcomeLabel, slotLabel, usageFeatureLabel } from '../lib/ai-format'
import AiUsageTable, { type AiUsageColumn } from './AiUsageTable.vue'

const emit = defineEmits<{ back: [] }>()

const { t } = useI18n()

const report = ref<AiUsageReport | null>(null)
const state = ref<AiLoadState>('loading')
const exporting = ref(false)

async function load() {
  state.value = 'loading'
  try {
    report.value = await aiApi.getUsage()
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

onMounted(load)

async function handleExport() {
  if (!report.value) return
  exporting.value = true
  try {
    await aiApi.downloadUsageCsv(report.value.from, report.value.to)
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.usage.exportFailed'))
  } finally {
    exporting.value = false
  }
}

function cost(totals: Pick<AiUsageTotals, 'costMicros' | 'unknownCostRequests' | 'requests'>): string {
  if (totals.requests > 0 && totals.unknownCostRequests === totals.requests) return t('settings.admin.ai.usage.costUnknown')
  const value = formatAiCost(totals.costMicros)
  return totals.unknownCostRequests > 0 ? t('settings.admin.ai.usage.costPartial', { cost: value }) : value
}

function tokens(value: number): string {
  return formatCompactNumber(value)
}

const totalsColumns = computed<AiUsageColumn[]>(() => [
  { key: 'requests', label: t('settings.admin.ai.usage.columns.requests'), numeric: true },
  { key: 'input', label: t('settings.admin.ai.usage.columns.input'), numeric: true },
  { key: 'output', label: t('settings.admin.ai.usage.columns.output'), numeric: true },
  { key: 'reasoning', label: t('settings.admin.ai.usage.columns.reasoning'), numeric: true },
  { key: 'cost', label: t('settings.admin.ai.usage.columns.cost'), numeric: true },
  { key: 'errors', label: t('settings.admin.ai.usage.columns.errors'), numeric: true },
])

function totalsRow(totals: AiUsageTotals): Record<string, string> {
  return {
    requests: formatNumber(totals.requests),
    input: tokens(totals.inputTokens),
    output: tokens(totals.outputTokens),
    reasoning: tokens(totals.reasoningTokens),
    cost: cost(totals),
    errors: formatNumber(totals.errors),
  }
}

/** Newest month first, like every other history in settings. */
const monthRows = computed(() =>
  [...(report.value?.months ?? [])].reverse().map((month) => ({ month: monthLabel(month.month), ...totalsRow(month) })),
)
const featureRows = computed(() =>
  (report.value?.byFeature ?? []).map((entry) => ({ feature: usageFeatureLabel(entry.feature), ...totalsRow(entry) })),
)
const modelRows = computed(() =>
  (report.value?.byModel ?? []).map((entry) => ({
    model: entry.connectionName ? t('settings.admin.ai.usage.modelOn', { model: entry.model, connection: entry.connectionName }) : entry.model,
    ...totalsRow(entry),
  })),
)
const jobRows = computed(() =>
  (report.value?.costliestJobs ?? []).map((job) => ({
    job: job.label ?? t('settings.admin.ai.usage.unnamedJob'),
    feature: usageFeatureLabel(job.feature),
    requests: formatNumber(job.requests),
    cost: formatAiCost(job.costMicros),
  })),
)
const errorRows = computed(() =>
  (report.value?.recentErrors ?? []).map((entry) => ({
    at: formatDateTime(new Date(entry.at)),
    feature: usageFeatureLabel(entry.feature),
    slot: slotLabel(entry.slot),
    model: entry.model,
    outcome: outcomeLabel(entry.outcome),
  })),
)

const rangeLabel = computed(() =>
  report.value ? t('settings.admin.ai.usage.range', { from: monthLabel(report.value.from), to: monthLabel(report.value.to) }) : '',
)
</script>

<template>
  <section aria-labelledby="ai-usage-title" class="flex flex-col gap-6" data-testid="ai-usage">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="sm" class="-ms-2" data-testid="ai-usage-back" @click="emit('back')">
          <ArrowLeft class="size-4" />
          {{ t('settings.admin.ai.usage.back') }}
        </Button>
      </div>
      <Button variant="outline" size="sm" :disabled="state !== 'ready' || exporting" data-testid="ai-usage-export" @click="handleExport">
        <Loader2 v-if="exporting" class="size-3.5 animate-spin" />
        <Download v-else class="size-3.5" />
        {{ t('settings.admin.ai.usage.export') }}
      </Button>
    </div>

    <div>
      <h3 id="ai-usage-title" class="text-base font-semibold text-foreground">{{ t('settings.admin.ai.usage.title') }}</h3>
      <p class="settings-hint">{{ rangeLabel || t('settings.admin.ai.usage.brief') }}</p>
    </div>

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !report" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.usage.loadFailed')" @retry="load" />
    </div>

    <template v-else>
      <div class="settings-card" data-testid="ai-usage-months">
        <h4 class="settings-card-header text-sm font-semibold text-foreground">{{ t('settings.admin.ai.usage.months') }}</h4>
        <AiUsageTable
          :label="t('settings.admin.ai.usage.months')"
          :columns="[{ key: 'month', label: t('settings.admin.ai.usage.columns.month') }, ...totalsColumns]"
          :rows="monthRows"
          :empty="t('settings.admin.ai.usage.empty')"
        />
      </div>

      <div class="settings-card" data-testid="ai-usage-features">
        <h4 class="settings-card-header text-sm font-semibold text-foreground">{{ t('settings.admin.ai.usage.byFeature') }}</h4>
        <AiUsageTable
          :label="t('settings.admin.ai.usage.byFeature')"
          :columns="[{ key: 'feature', label: t('settings.admin.ai.usage.columns.feature') }, ...totalsColumns]"
          :rows="featureRows"
          :empty="t('settings.admin.ai.usage.empty')"
        />
      </div>

      <div class="settings-card" data-testid="ai-usage-models">
        <h4 class="settings-card-header text-sm font-semibold text-foreground">{{ t('settings.admin.ai.usage.byModel') }}</h4>
        <AiUsageTable
          :label="t('settings.admin.ai.usage.byModel')"
          :columns="[{ key: 'model', label: t('settings.admin.ai.usage.columns.model') }, ...totalsColumns]"
          :rows="modelRows"
          :empty="t('settings.admin.ai.usage.empty')"
        />
      </div>

      <div class="settings-card" data-testid="ai-usage-jobs">
        <h4 class="settings-card-header text-sm font-semibold text-foreground">{{ t('settings.admin.ai.usage.costliest') }}</h4>
        <AiUsageTable
          :label="t('settings.admin.ai.usage.costliest')"
          :columns="[
            { key: 'job', label: t('settings.admin.ai.usage.columns.job') },
            { key: 'feature', label: t('settings.admin.ai.usage.columns.feature') },
            { key: 'requests', label: t('settings.admin.ai.usage.columns.requests'), numeric: true },
            { key: 'cost', label: t('settings.admin.ai.usage.columns.cost'), numeric: true },
          ]"
          :rows="jobRows"
          :empty="t('settings.admin.ai.usage.noJobs')"
        />
      </div>

      <div class="settings-card" data-testid="ai-usage-errors">
        <h4 class="settings-card-header text-sm font-semibold text-foreground">{{ t('settings.admin.ai.usage.recentErrors') }}</h4>
        <AiUsageTable
          :label="t('settings.admin.ai.usage.recentErrors')"
          :columns="[
            { key: 'at', label: t('settings.admin.ai.usage.columns.at') },
            { key: 'feature', label: t('settings.admin.ai.usage.columns.feature') },
            { key: 'slot', label: t('settings.admin.ai.usage.columns.slot') },
            { key: 'model', label: t('settings.admin.ai.usage.columns.model') },
            { key: 'outcome', label: t('settings.admin.ai.usage.columns.outcome') },
          ]"
          :rows="errorRows"
          :empty="t('settings.admin.ai.usage.noErrors')"
        />
      </div>
    </template>
  </section>
</template>
