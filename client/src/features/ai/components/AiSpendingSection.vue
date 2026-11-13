<script setup lang="ts">
import { computed, reactive } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { AI_FEATURE_DEFINITIONS, type AiFeatureState, type AiOverview, type AiSettings, type AiUsageReport } from '@bookorbit/types'

import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import * as aiApi from '../api/ai.api'
import type { AiLoadState } from '../composables/useAiAdmin'
import { featureShortName, formatAiCost, formatDollars } from '../lib/ai-format'
import { AI_MAX_BUILDS_PER_MONTH, AI_MAX_DOLLARS, type NumberFieldRule } from '../lib/ai-number-field'
import { aiColumns, aiTable } from '../lib/ai-settings-ui'
import AiSectionHeader from './AiSectionHeader.vue'
import AiSpendRow, { type AiSpendField, type AiSpendFieldId } from './AiSpendRow.vue'

const props = defineProps<{
  settings: AiSettings | null
  state: AiLoadState
  overview: AiOverview | null
  monthUsage: AiUsageReport | null
  /** Which limit editors are open, as `spend:<row>` keys the page shares with its other tables. */
  openKeys: ReadonlySet<string>
}>()

const emit = defineEmits<{
  retry: []
  updated: [settings: AiSettings]
  setOpen: [key: string, open: boolean]
}>()

const { t } = useI18n()

/** Ledger rows that are not a feature: provider tests and Try it, which count toward the server total. */
const CHECK_FEATURES = ['connection-test', 'try-it']

const DOLLARS: NumberFieldRule = { min: 0, max: AI_MAX_DOLLARS, optional: true }
const BUILDS: NumberFieldRule = { min: 1, max: AI_MAX_BUILDS_PER_MONTH, integer: true, optional: true }

interface SpendRow {
  key: string
  name: string
  sub?: string
  strong?: boolean
  limit: string | null
  limitMuted?: boolean
  limitSub?: string | null
  spent: string | null
  spentSub?: string | null
  used: number | null
  note?: string | null
  fields: AiSpendField[]
  save: (values: Partial<Record<AiSpendFieldId, number | null>>) => Promise<AiSettings>
}

const saving = reactive<Record<string, boolean>>({})

function dollarsField(value: number | null, brief: string, placeholder: string): AiSpendField {
  return {
    id: 'monthlyBudget',
    label: t('settings.admin.ai.spending.monthlyLimit'),
    brief,
    placeholder,
    error: t('settings.admin.ai.features.errors.dollars', { max: formatDollars(AI_MAX_DOLLARS) }),
    rule: DOLLARS,
    value,
  }
}

function buildsField(value: number | null, brief: string): AiSpendField {
  return {
    id: 'buildsPerMonth',
    label: t('settings.admin.ai.spending.buildsPerMonth'),
    brief,
    placeholder: t('settings.admin.ai.spending.noLimit'),
    error: t('settings.admin.ai.features.errors.range', { min: formatNumber(BUILDS.min), max: formatNumber(BUILDS.max) }),
    rule: BUILDS,
    value,
  }
}

function costOf(feature: string): number | null {
  const usage = props.monthUsage
  if (!usage) return null
  return usage.byFeature.find((entry) => entry.feature === feature)?.costMicros ?? 0
}

function buildsLimitText(limit: number | null): string | null {
  return limit === null ? null : t('settings.admin.ai.spending.buildsLimit', { count: limit, limit: formatNumber(limit) })
}

function featureRow(feature: AiFeatureState, serverLimit: number | null): SpendRow {
  const settings = feature.settings
  const name = featureShortName(feature.id)
  const runsJobs = AI_FEATURE_DEFINITIONS[feature.id].runs === 'jobs'
  const cost = costOf(feature.id)
  const own = settings.monthlyBudget
  const sharesText = serverLimit === null ? null : t('settings.admin.ai.spending.sharesServer')
  const placeholder =
    serverLimit === null
      ? t('settings.admin.ai.spending.noLimit')
      : t('settings.admin.ai.spending.sharesPlaceholder', { amount: formatDollars(serverLimit) })
  const fields = [dollarsField(own, t('settings.admin.ai.spending.featureLimitBrief'), placeholder)]
  if (runsJobs) fields.push(buildsField(settings.buildsPerMonth, t('settings.admin.ai.spending.featureBuildsBrief')))
  return {
    key: feature.id,
    name,
    limit: own === null ? sharesText : formatDollars(own),
    limitMuted: own === null,
    limitSub: runsJobs ? buildsLimitText(settings.buildsPerMonth) : null,
    spent: cost === null ? null : formatAiCost(cost),
    used: own !== null && own > 0 && cost !== null ? cost / 1_000_000 / own : null,
    fields,
    save: (values) => aiApi.updateFeature(feature.id, values),
  }
}

const rows = computed<SpendRow[]>(() => {
  const settings = props.settings
  if (!settings) return []
  const budget = props.overview?.budget ?? null
  const serverLimit = settings.budget.monthlyBudget
  const builds = settings.budget.buildsPerMonth
  const features = settings.features.filter((feature) => Object.hasOwn(AI_FEATURE_DEFINITIONS, feature.id))

  const server: SpendRow = {
    key: 'server',
    name: t('settings.admin.ai.spending.server'),
    sub: t('settings.admin.ai.spending.serverSub'),
    strong: true,
    limit: serverLimit === null ? null : formatDollars(serverLimit),
    spent: budget ? formatAiCost(budget.spentMicros) : null,
    spentSub: budget && budget.reservedMicros > 0 ? t('settings.admin.ai.spending.reserved', { amount: formatAiCost(budget.reservedMicros) }) : null,
    used: budget && serverLimit !== null ? (budget.used ?? 0) : null,
    fields: [dollarsField(serverLimit, t('settings.admin.ai.spending.serverLimitBrief'), t('settings.admin.ai.spending.noLimit'))],
    save: (values) => aiApi.updateBudget(values),
  }

  const buildsRow: SpendRow = {
    key: 'builds',
    name: t('settings.admin.ai.spending.builds'),
    sub: t('settings.admin.ai.spending.buildsSub'),
    limit: buildsLimitText(builds),
    spent: budget ? t('settings.admin.ai.spending.buildsCount', { count: budget.buildsThisMonth }) : null,
    used: budget && builds !== null ? budget.buildsThisMonth / builds : null,
    note: budget?.countsBuilds ? t('settings.admin.ai.spending.countsBuilds') : null,
    fields: [buildsField(builds, t('settings.admin.ai.spending.serverBuildsBrief'))],
    save: (values) => aiApi.updateBudget(values),
  }

  return [server, ...features.map((feature) => featureRow(feature, serverLimit)), buildsRow]
})

/** What provider tests and Try it cost, which no feature row shows but the server total includes. */
const checksCost = computed(() => {
  const usage = props.monthUsage
  if (!usage) return null
  return usage.byFeature.filter((entry) => CHECK_FEATURES.includes(entry.feature)).reduce((sum, entry) => sum + entry.costMicros, 0)
})

function keyOf(row: string): string {
  return `spend:${row}`
}

async function handleSave(row: SpendRow, values: Partial<Record<AiSpendFieldId, number | null>>) {
  saving[row.key] = true
  try {
    emit('updated', await row.save(values))
    toast.success(t('settings.admin.ai.spending.saved', { name: row.name }))
    emit('setOpen', keyOf(row.key), false)
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.spending.saveFailed'))
  } finally {
    saving[row.key] = false
  }
}

function handleSetOpen(row: SpendRow, open: boolean) {
  emit('setOpen', keyOf(row.key), open)
}

function handleRetry() {
  emit('retry')
}
</script>

<template>
  <section aria-labelledby="ai-spending-title" class="flex min-w-0 flex-col gap-2.5" data-testid="ai-spending">
    <AiSectionHeader title-id="ai-spending-title" :title="t('settings.admin.ai.spending.title')" :hint="t('settings.admin.ai.spending.hint')" />

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !settings" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.spending.loadFailed')" @retry="handleRetry" />
    </div>

    <template v-else>
      <div :class="aiTable.card">
        <div :class="[aiTable.head, aiColumns.spending]" aria-hidden="true">
          <span>{{ t('settings.admin.ai.spending.columns.appliesTo') }}</span>
          <span>{{ t('settings.admin.ai.spending.columns.limit') }}</span>
          <span class="text-end">{{ t('settings.admin.ai.spending.columns.spent') }}</span>
          <span>{{ t('settings.admin.ai.spending.columns.used') }}</span>
          <span />
        </div>
        <ul :class="aiTable.list" aria-labelledby="ai-spending-title">
          <AiSpendRow
            v-for="row in rows"
            :key="row.key"
            :row-key="row.key"
            :name="row.name"
            :sub="row.sub"
            :strong="row.strong"
            :limit="row.limit"
            :limit-muted="row.limitMuted"
            :limit-sub="row.limitSub"
            :spent="row.spent"
            :spent-sub="row.spentSub"
            :used="row.used"
            :note="row.note"
            :fields="row.fields"
            :open="openKeys.has(keyOf(row.key))"
            :saving="saving[row.key] === true"
            @save="handleSave(row, $event)"
            @set-open="handleSetOpen(row, $event)"
          />
        </ul>
      </div>
      <p v-if="checksCost !== null" class="text-xs leading-4 text-muted-foreground" data-testid="ai-spending-checks">
        {{ t('settings.admin.ai.spending.checks', { cost: formatAiCost(checksCost) }) }}
      </p>
    </template>
  </section>
</template>
