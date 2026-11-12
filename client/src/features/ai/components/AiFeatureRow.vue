<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { toast } from 'vue-sonner'
import { AlertTriangle, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  AI_FEATURE_DEFINITIONS,
  type AiFeatureDefinition,
  type AiFeatureState,
  type AiSettings,
  type AiSlot,
  type UpdateAiFeatureRequest,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import { relativeTimestamp } from '@/lib/relative-time'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import * as aiApi from '../api/ai.api'
import { formatDollars, slotList, usageFeatureLabel } from '../lib/ai-format'
import { AI_MAX_BUILDS_PER_MONTH, AI_MAX_DOLLARS, numberFieldText, parseNumberField, type NumberFieldRule } from '../lib/ai-number-field'

const props = defineProps<{
  feature: AiFeatureState
}>()

const emit = defineEmits<{
  updated: [settings: AiSettings]
  showSlot: [slot: AiSlot]
}>()

const { t, te } = useI18n()
const id = useId()

const definition = computed<AiFeatureDefinition>(() => AI_FEATURE_DEFINITIONS[props.feature.id])
/** A feature that answers requests, such as photo scans, has no builds to limit or count. */
const runsJobs = computed(() => definition.value.runs === 'jobs')

type FieldId = 'maxWords' | 'concurrentBuilds' | 'monthlyBudget' | 'buildsPerMonth'
type LimitId = 'maxWords' | 'concurrentBuilds'
const LIMIT_IDS: LimitId[] = ['maxWords', 'concurrentBuilds']

/** Only the fields this feature has: its own limits, the budget, and builds a month for jobs. */
const rules = computed<Partial<Record<FieldId, NumberFieldRule>>>(() => {
  const next: Partial<Record<FieldId, NumberFieldRule>> = {}
  for (const limit of LIMIT_IDS) {
    const range = definition.value.limits[limit]
    if (range) next[limit] = { min: range.min, max: range.max, integer: true }
  }
  next.monthlyBudget = { min: 0, max: AI_MAX_DOLLARS, optional: true }
  if (runsJobs.value) next.buildsPerMonth = { min: 1, max: AI_MAX_BUILDS_PER_MONTH, integer: true, optional: true }
  return next
})

function fieldsOf(feature: AiFeatureState): Partial<Record<FieldId, string>> {
  const next: Partial<Record<FieldId, string>> = {}
  for (const limit of LIMIT_IDS) {
    const range = definition.value.limits[limit]
    if (range) next[limit] = numberFieldText(feature.settings.limits[limit] ?? range.default)
  }
  next.monthlyBudget = numberFieldText(feature.settings.monthlyBudget)
  if (runsJobs.value) next.buildsPerMonth = numberFieldText(feature.settings.buildsPerMonth)
  return next
}

const fields = ref(fieldsOf(props.feature))
// A reload that brings the same values back keeps what is being typed.
watch(
  () => JSON.stringify(fieldsOf(props.feature)),
  () => {
    fields.value = fieldsOf(props.feature)
  },
)

const parsed = computed(() => {
  const entries = (Object.keys(rules.value) as FieldId[]).map(
    (field) => [field, parseNumberField(fields.value[field] ?? '', rules.value[field]!)] as const,
  )
  return Object.fromEntries(entries) as Partial<Record<FieldId, ReturnType<typeof parseNumberField>>>
})

function fieldError(field: FieldId): string | null {
  const rule = rules.value[field]
  if (!rule || parsed.value[field]?.ok !== false) return null
  if (field === 'monthlyBudget') return t('settings.admin.ai.features.errors.dollars', { max: formatDollars(rule.max) })
  return t('settings.admin.ai.features.errors.range', { min: formatNumber(rule.min), max: formatNumber(rule.max) })
}

const invalid = computed(() => Object.values(parsed.value).some((entry) => !entry.ok))
const dirty = computed(() => JSON.stringify(fieldsOf(props.feature)) !== JSON.stringify(fields.value))

const saving = ref(false)
const switching = ref(false)
const confirmingPrivacy = ref(false)

async function send(request: UpdateAiFeatureRequest): Promise<boolean> {
  try {
    emit('updated', await aiApi.updateFeature(props.feature.id, request))
    return true
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.features.saveFailed'))
    return false
  }
}

async function setEnabled(enabled: boolean, confirmPrivacy = false) {
  switching.value = true
  const ok = await send(confirmPrivacy ? { enabled, confirmPrivacy } : { enabled })
  switching.value = false
  confirmingPrivacy.value = false
  if (ok) {
    const name = usageFeatureLabel(props.feature.id)
    toast.success(enabled ? t('settings.admin.ai.features.turnedOn', { name }) : t('settings.admin.ai.features.turnedOff', { name }))
  }
}

/** The first time on, the admin confirms what leaves the server; after that the switch is plain. */
function handleToggle(enabled: boolean) {
  if (enabled && !props.feature.privacy) {
    confirmingPrivacy.value = true
    return
  }
  void setEnabled(enabled)
}

function value(field: FieldId): number | null {
  const entry = parsed.value[field]
  return entry?.ok ? entry.value : null
}

function saveRequest(): UpdateAiFeatureRequest {
  const request: UpdateAiFeatureRequest = { monthlyBudget: value('monthlyBudget') }
  const limits = Object.fromEntries(LIMIT_IDS.filter((limit) => rules.value[limit]).map((limit) => [limit, value(limit) ?? undefined]))
  if (Object.keys(limits).length > 0) request.limits = limits
  if (rules.value.buildsPerMonth) request.buildsPerMonth = value('buildsPerMonth')
  return request
}

async function handleSave() {
  if (invalid.value) return
  saving.value = true
  const ok = await send(saveRequest())
  saving.value = false
  if (ok) toast.success(t('settings.admin.ai.features.saved', { name: usageFeatureLabel(props.feature.id) }))
}

/** Copy that differs for a feature that answers requests: `features.requests.<key>` beside `features.<key>`. */
function kindText(key: 'on' | 'off' | 'missingSlots', values: Record<string, unknown> = {}): string {
  return t(runsJobs.value ? `settings.admin.ai.features.${key}` : `settings.admin.ai.features.requests.${key}`, values)
}

/** What the privacy confirmation says leaves the server; story guides have the original keys. */
function privacyText(key: 'privacyBody' | 'privacyConfirmed', values: Record<string, unknown> = {}): string {
  const own = `settings.admin.ai.features.privacy.${props.feature.id}.${key}`
  return te(own) ? t(own, values) : t(`settings.admin.ai.features.${key}`, values)
}

/** An empty slot is said whether the switch is on or off, so it is fixed before anyone waits on a build. */
const statusLine = computed(() => {
  if (props.feature.missingSlots.length > 0) {
    return {
      tone: 'warning' as const,
      text: kindText('missingSlots', { count: props.feature.missingSlots.length, slots: slotList(props.feature.missingSlots) }),
    }
  }
  return { tone: 'idle' as const, text: kindText(props.feature.settings.enabled ? 'on' : 'off') }
})

const privacyConfirmedLine = computed(() =>
  props.feature.privacy
    ? privacyText('privacyConfirmed', { name: props.feature.privacy.username, time: relativeTimestamp(props.feature.privacy.at) })
    : '',
)

function handleShowSlot() {
  const slot = props.feature.missingSlots[0]
  if (slot) emit('showSlot', slot)
}

function handlePrivacyConfirm() {
  void setEnabled(true, true)
}

function handlePrivacyCancel() {
  confirmingPrivacy.value = false
}
</script>

<template>
  <article class="flex flex-col gap-4 px-4 py-4 md:px-5" :data-feature="feature.id">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h4 :id="`${id}-name`" class="text-sm font-semibold text-foreground">{{ usageFeatureLabel(feature.id) }}</h4>
        <p class="settings-hint mt-0.5">{{ t(`settings.admin.ai.features.briefs.${feature.id}`) }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2 pt-0.5">
        <Loader2 v-if="switching" class="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        <ToggleSwitch
          :model-value="feature.settings.enabled"
          :disabled="switching"
          :aria-labelledby="`${id}-name`"
          data-testid="ai-feature-switch"
          @update:model-value="handleToggle"
        />
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <p
        class="flex items-start gap-1.5 text-xs"
        :class="statusLine.tone === 'warning' ? 'text-foreground' : 'text-muted-foreground'"
        data-testid="ai-feature-status"
      >
        <AlertTriangle v-if="statusLine.tone === 'warning'" class="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span>{{ statusLine.text }}</span>
        <button
          v-if="statusLine.tone === 'warning'"
          type="button"
          class="shrink-0 text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleShowSlot"
        >
          {{ t('settings.admin.ai.features.goToModels') }}
        </button>
      </p>
      <p v-if="feature.privacy" class="text-xs text-muted-foreground" data-testid="ai-feature-privacy">
        {{ privacyConfirmedLine }}
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <SettingsField
        v-if="rules.maxWords"
        :label="t('settings.admin.ai.features.maxWords')"
        :input-id="`${id}-words`"
        :brief="t('settings.admin.ai.features.maxWordsBrief')"
        :error="fieldError('maxWords')"
      >
        <template #default="{ describedBy, invalid: fieldInvalid }">
          <input
            :id="`${id}-words`"
            v-model="fields.maxWords"
            type="text"
            inputmode="numeric"
            class="settings-control tabular-nums"
            :aria-describedby="describedBy"
            :aria-invalid="fieldInvalid"
            data-testid="ai-feature-max-words"
          />
        </template>
      </SettingsField>
      <SettingsField
        v-if="rules.concurrentBuilds"
        :label="t('settings.admin.ai.features.concurrentBuilds')"
        :input-id="`${id}-concurrent`"
        :brief="t('settings.admin.ai.features.concurrentBuildsBrief')"
        :error="fieldError('concurrentBuilds')"
      >
        <template #default="{ describedBy, invalid: fieldInvalid }">
          <input
            :id="`${id}-concurrent`"
            v-model="fields.concurrentBuilds"
            type="text"
            inputmode="numeric"
            class="settings-control tabular-nums"
            :aria-describedby="describedBy"
            :aria-invalid="fieldInvalid"
          />
        </template>
      </SettingsField>
      <SettingsField
        :label="t('settings.admin.ai.features.monthlyBudget')"
        :input-id="`${id}-budget`"
        :brief="t('settings.admin.ai.features.monthlyBudgetBrief')"
        :error="fieldError('monthlyBudget')"
      >
        <template #default="{ describedBy, invalid: fieldInvalid }">
          <input
            :id="`${id}-budget`"
            v-model="fields.monthlyBudget"
            type="text"
            inputmode="decimal"
            class="settings-control tabular-nums"
            :aria-describedby="describedBy"
            :aria-invalid="fieldInvalid"
            data-testid="ai-feature-budget"
          />
        </template>
      </SettingsField>
      <SettingsField
        v-if="rules.buildsPerMonth"
        :label="t('settings.admin.ai.features.buildsPerMonth')"
        :input-id="`${id}-builds`"
        :brief="t('settings.admin.ai.features.buildsPerMonthBrief')"
        :error="fieldError('buildsPerMonth')"
      >
        <template #default="{ describedBy, invalid: fieldInvalid }">
          <input
            :id="`${id}-builds`"
            v-model="fields.buildsPerMonth"
            type="text"
            inputmode="numeric"
            class="settings-control tabular-nums"
            :aria-describedby="describedBy"
            :aria-invalid="fieldInvalid"
          />
        </template>
      </SettingsField>
    </div>

    <div>
      <Button size="sm" :disabled="!dirty || invalid || saving" data-testid="ai-feature-save" @click="handleSave">
        <Loader2 v-if="saving" class="size-3.5 animate-spin" />
        {{ t('settings.admin.ai.features.save') }}
      </Button>
    </div>

    <p v-if="feature.id === 'story-guides'" class="border-t border-border pt-4 text-xs text-muted-foreground" data-testid="ai-story-guides-moved">
      {{ t('settings.admin.ai.features.storyGuides.movedBrief') }}
      <RouterLink
        :to="{ name: 'ai-story-guides' }"
        class="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {{ t('settings.admin.ai.features.storyGuides.movedLink') }}
      </RouterLink>
    </p>

    <ConfirmDialog
      :open="confirmingPrivacy"
      :title="t('settings.admin.ai.features.privacyTitle', { name: usageFeatureLabel(feature.id) })"
      :description="privacyText('privacyBody')"
      :confirm-label="t('settings.admin.ai.features.turnOn')"
      :destructive="false"
      :busy="switching"
      @confirm="handlePrivacyConfirm"
      @cancel="handlePrivacyCancel"
    />
  </article>
</template>
