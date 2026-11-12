<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { toast } from 'vue-sonner'
import { AlertTriangle, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { AiBudgetSettings, AiBudgetState, AiSettings } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import * as aiApi from '../api/ai.api'
import type { AiLoadState } from '../composables/useAiAdmin'
import { formatAiCost, formatDollars } from '../lib/ai-format'
import { AI_MAX_BUILDS_PER_MONTH, AI_MAX_DOLLARS, numberFieldText, parseNumberField } from '../lib/ai-number-field'

const props = defineProps<{
  settings: AiSettings | null
  state: AiLoadState
  /** This month's spending, from the overview; the section still edits without it. */
  usage: AiBudgetState | null
}>()

const emit = defineEmits<{
  retry: []
  updated: [settings: AiSettings]
}>()

const { t } = useI18n()
const id = useId()

function fieldsOf(budget: AiBudgetSettings | undefined) {
  return { monthlyBudget: numberFieldText(budget?.monthlyBudget), buildsPerMonth: numberFieldText(budget?.buildsPerMonth) }
}

const fields = ref(fieldsOf(props.settings?.budget))
// A reload that brings the same values back keeps what is being typed.
watch(
  () => JSON.stringify(fieldsOf(props.settings?.budget)),
  () => {
    fields.value = fieldsOf(props.settings?.budget)
  },
)

const budgetField = computed(() => parseNumberField(fields.value.monthlyBudget, { min: 0, max: AI_MAX_DOLLARS, optional: true }))
const buildsField = computed(() =>
  parseNumberField(fields.value.buildsPerMonth, { min: 1, max: AI_MAX_BUILDS_PER_MONTH, integer: true, optional: true }),
)
const dirty = computed(() => JSON.stringify(fieldsOf(props.settings?.budget)) !== JSON.stringify(fields.value))
const saving = ref(false)

async function handleSave() {
  const budget = budgetField.value
  const builds = buildsField.value
  if (!budget.ok || !builds.ok) return
  saving.value = true
  try {
    emit('updated', await aiApi.updateBudget({ monthlyBudget: budget.value, buildsPerMonth: builds.value }))
    toast.success(t('settings.admin.ai.budget.saved'))
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.budget.saveFailed'))
  } finally {
    saving.value = false
  }
}

const spentLine = computed(() => {
  const usage = props.usage
  if (!usage) return null
  const spent = formatAiCost(usage.spentMicros)
  const line =
    usage.monthlyBudget !== null
      ? t('settings.admin.ai.budget.spentOf', { spent, budget: formatDollars(usage.monthlyBudget), percent: formatPercent(usage.used ?? 0) })
      : t('settings.admin.ai.budget.spent', { spent })
  return usage.reservedMicros > 0 ? `${line} ${t('settings.admin.ai.budget.reserved', { amount: formatAiCost(usage.reservedMicros) })}` : line
})

const buildsLine = computed(() => {
  const usage = props.usage
  if (!usage) return null
  return usage.buildsPerMonth !== null
    ? t('settings.admin.ai.budget.buildsOf', { count: usage.buildsThisMonth, limit: formatNumber(usage.buildsPerMonth) })
    : t('settings.admin.ai.budget.builds', { count: usage.buildsThisMonth })
})
</script>

<template>
  <section aria-labelledby="ai-budget-title" class="flex flex-col gap-3" data-testid="ai-budget">
    <div>
      <h3 id="ai-budget-title" class="settings-group-label mb-0">{{ t('settings.admin.ai.budget.title') }}</h3>
      <p class="settings-hint">{{ t('settings.admin.ai.budget.brief') }}</p>
    </div>

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !settings" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.budget.loadFailed')" @retry="emit('retry')" />
    </div>

    <div v-else class="settings-card">
      <div class="flex flex-col gap-4 px-4 py-4 md:px-5">
        <div class="grid gap-4 sm:grid-cols-2">
          <SettingsField
            :label="t('settings.admin.ai.budget.monthlyBudget')"
            :input-id="`${id}-budget`"
            :brief="t('settings.admin.ai.budget.monthlyBudgetBrief')"
            :error="budgetField.ok ? null : t('settings.admin.ai.features.errors.dollars', { max: formatDollars(AI_MAX_DOLLARS) })"
          >
            <template #default="{ describedBy, invalid }">
              <input
                :id="`${id}-budget`"
                v-model="fields.monthlyBudget"
                type="text"
                inputmode="decimal"
                class="settings-control tabular-nums"
                :aria-describedby="describedBy"
                :aria-invalid="invalid"
                data-testid="ai-budget-monthly"
              />
            </template>
          </SettingsField>
          <SettingsField
            :label="t('settings.admin.ai.budget.buildsPerMonth')"
            :input-id="`${id}-builds`"
            :brief="t('settings.admin.ai.budget.buildsPerMonthBrief')"
            :error="
              buildsField.ok
                ? null
                : t('settings.admin.ai.features.errors.range', { min: formatNumber(1), max: formatNumber(AI_MAX_BUILDS_PER_MONTH) })
            "
          >
            <template #default="{ describedBy, invalid }">
              <input
                :id="`${id}-builds`"
                v-model="fields.buildsPerMonth"
                type="text"
                inputmode="numeric"
                class="settings-control tabular-nums"
                :aria-describedby="describedBy"
                :aria-invalid="invalid"
                data-testid="ai-budget-builds"
              />
            </template>
          </SettingsField>
        </div>
        <div>
          <Button size="sm" :disabled="!dirty || !budgetField.ok || !buildsField.ok || saving" data-testid="ai-budget-save" @click="handleSave">
            <Loader2 v-if="saving" class="size-3.5 animate-spin" />
            {{ t('settings.admin.ai.budget.save') }}
          </Button>
        </div>
      </div>

      <div v-if="usage" class="flex flex-col gap-1.5 px-4 py-3 text-xs md:px-5" data-testid="ai-budget-state">
        <p class="text-muted-foreground">{{ spentLine }}</p>
        <p class="text-muted-foreground">{{ buildsLine }}</p>
        <p v-if="usage.exhausted" class="flex items-start gap-1.5 text-destructive">
          <AlertTriangle class="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {{ t('settings.admin.ai.overview.budgetExhausted') }}
        </p>
        <p v-else-if="usage.warning" class="flex items-start gap-1.5 text-foreground">
          <AlertTriangle class="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
          {{ t('settings.admin.ai.overview.budgetWarning', { percent: formatPercent(usage.used ?? 0) }) }}
        </p>
        <p v-if="usage.countsBuilds" class="text-foreground" data-testid="ai-budget-counts-builds">
          {{ t('settings.admin.ai.budget.countsBuilds') }}
        </p>
      </div>
    </div>
  </section>
</template>
