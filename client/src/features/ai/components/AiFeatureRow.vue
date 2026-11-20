<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { toast } from 'vue-sonner'
import { ArrowUpRight, ChevronDown, ChevronUp, Loader2, TriangleAlert } from '@lucide/vue'
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
import { featureShortName, formatAiCost, formatDollars, slotLabel, slotList, usageFeatureLabel } from '../lib/ai-format'
import { AI_MAX_BUILDS_PER_MONTH, AI_MAX_DOLLARS, numberFieldText, parseNumberField, type NumberFieldRule } from '../lib/ai-number-field'
import { aiColumns, aiTable, FEATURE_ICONS, slotDotClass } from '../lib/ai-settings-ui'

const props = defineProps<{
  feature: AiFeatureState
  open: boolean
  /** A slot the feature needs whose model or provider is failing, so its requests fail too. */
  failingSlot: AiSlot | null
  /** This month's spend and count, once the usage report has loaded. */
  month: { costMicros: number; count: number } | null
}>()

const emit = defineEmits<{
  updated: [settings: AiSettings]
  setOpen: [open: boolean]
  openSlot: [slot: AiSlot]
}>()

const { t, te } = useI18n()
const id = useId()

const definition = computed<AiFeatureDefinition>(() => AI_FEATURE_DEFINITIONS[props.feature.id])
/** A feature that answers requests, such as photo scans, has no builds to count. */
const runsJobs = computed(() => definition.value.runs === 'jobs')
const perReader = computed(() => definition.value.perReader === true)
const name = computed(() => featureShortName(props.feature.id))
const enabled = computed(() => props.feature.settings.enabled)
const missing = computed(() => props.feature.missingSlots)

type FieldId = 'maxWords' | 'concurrentBuilds' | 'readerMonthlyBudget' | 'readerRequestsPerMonth'
type LimitId = 'maxWords' | 'concurrentBuilds'
const LIMIT_IDS: LimitId[] = ['maxWords', 'concurrentBuilds']

/** The feature's own limits and per-reader caps. Monthly money and builds limits are under Spending. */
const rules = computed<Partial<Record<FieldId, NumberFieldRule>>>(() => {
  const next: Partial<Record<FieldId, NumberFieldRule>> = {}
  for (const limit of LIMIT_IDS) {
    const range = definition.value.limits[limit]
    if (range) next[limit] = { min: range.min, max: range.max, integer: true }
  }
  if (perReader.value) {
    next.readerMonthlyBudget = { min: 0, max: AI_MAX_DOLLARS, optional: true }
    next.readerRequestsPerMonth = { min: 1, max: AI_MAX_BUILDS_PER_MONTH, integer: true, optional: true }
  }
  return next
})

const hasFields = computed(() => Object.keys(rules.value).length > 0)

function fieldsOf(feature: AiFeatureState): Partial<Record<FieldId, string>> {
  const next: Partial<Record<FieldId, string>> = {}
  for (const limit of LIMIT_IDS) {
    const range = definition.value.limits[limit]
    if (range) next[limit] = numberFieldText(feature.settings.limits[limit] ?? range.default)
  }
  if (perReader.value) {
    next.readerMonthlyBudget = numberFieldText(feature.settings.readerMonthlyBudget ?? null)
    next.readerRequestsPerMonth = numberFieldText(feature.settings.readerRequestsPerMonth ?? null)
  }
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
  if (field === 'readerMonthlyBudget') return t('settings.admin.ai.features.errors.dollars', { max: formatDollars(rule.max) })
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

async function setEnabled(next: boolean, confirmPrivacy = false) {
  switching.value = true
  const ok = await send(confirmPrivacy ? { enabled: next, confirmPrivacy } : { enabled: next })
  switching.value = false
  confirmingPrivacy.value = false
  if (ok) {
    const label = usageFeatureLabel(props.feature.id)
    toast.success(next ? t('settings.admin.ai.features.turnedOn', { name: label }) : t('settings.admin.ai.features.turnedOff', { name: label }))
  }
}

/** The first time on, the admin confirms what leaves the server; after that the switch is plain. */
function handleToggle(next: boolean) {
  if (next && !props.feature.privacy) {
    confirmingPrivacy.value = true
    return
  }
  void setEnabled(next)
}

function value(field: FieldId): number | null {
  const entry = parsed.value[field]
  return entry?.ok ? entry.value : null
}

function saveRequest(): UpdateAiFeatureRequest {
  const request: UpdateAiFeatureRequest = {}
  const limits = Object.fromEntries(LIMIT_IDS.filter((limit) => rules.value[limit]).map((limit) => [limit, value(limit) ?? undefined]))
  if (Object.keys(limits).length > 0) request.limits = limits
  if (rules.value.readerMonthlyBudget) request.readerMonthlyBudget = value('readerMonthlyBudget')
  if (rules.value.readerRequestsPerMonth) request.readerRequestsPerMonth = value('readerRequestsPerMonth')
  return request
}

async function handleSave() {
  if (invalid.value || !dirty.value) return
  saving.value = true
  const ok = await send(saveRequest())
  saving.value = false
  if (ok) {
    toast.success(t('settings.admin.ai.features.saved', { name: usageFeatureLabel(props.feature.id) }))
    emit('setOpen', false)
  }
}

function handleCancel() {
  fields.value = fieldsOf(props.feature)
  emit('setOpen', false)
}

function handleExpand() {
  emit('setOpen', !props.open)
}

function handleGoToSlot() {
  const slot = missing.value[0] ?? props.failingSlot
  if (slot) emit('openSlot', slot)
}

function handlePrivacyConfirm() {
  void setEnabled(true, true)
}

function handlePrivacyCancel() {
  confirmingPrivacy.value = false
}

/** What the privacy confirmation says leaves the server; story guides have the original keys. */
function privacyText(key: 'privacyBody' | 'privacyConfirmed', values: Record<string, unknown> = {}): string {
  const own = `settings.admin.ai.features.privacy.${props.feature.id}.${key}`
  return te(own) ? t(own, values) : t(`settings.admin.ai.features.${key}`, values)
}

const stateLabel = computed(() => {
  if (!enabled.value) return t('settings.admin.ai.features.stateOff')
  return props.failingSlot ? t('settings.admin.ai.features.stateFailing') : t('settings.admin.ai.features.stateOn')
})

const sendsLabel = computed(() => {
  const key = `settings.admin.ai.features.sends.${props.feature.id}`
  return te(key) ? t(key) : ''
})

const subLine = computed(() => [stateLabel.value, sendsLabel.value].filter(Boolean).join(' · '))

/** The feature's own limits in one line; money limits live under Spending. */
const limitsLine = computed(() => {
  const settings = props.feature.settings
  const limits = definition.value.limits
  if (limits.maxWords && limits.concurrentBuilds) {
    return t('settings.admin.ai.features.limitsLine.builds', {
      words: formatNumber(settings.limits.maxWords ?? limits.maxWords.default),
      count: settings.limits.concurrentBuilds ?? limits.concurrentBuilds.default,
    })
  }
  if (perReader.value) {
    const dollars = settings.readerMonthlyBudget ?? null
    const count = settings.readerRequestsPerMonth ?? null
    if (dollars !== null && count !== null) return t('settings.admin.ai.features.limitsLine.reader', { dollars: formatDollars(dollars), count })
    if (dollars !== null) return t('settings.admin.ai.features.limitsLine.readerDollars', { dollars: formatDollars(dollars) })
    if (count !== null) return t('settings.admin.ai.features.limitsLine.readerAnswers', { count })
    return t('settings.admin.ai.features.limitsLine.readerNone')
  }
  return null
})

const note = computed(() => {
  if (missing.value.length > 0) {
    const key = runsJobs.value ? 'settings.admin.ai.features.missingSlots' : 'settings.admin.ai.features.requests.missingSlots'
    return { text: t(key, { count: missing.value.length, slots: slotList(missing.value) }), link: t('settings.admin.ai.features.goToModels') }
  }
  if (enabled.value && props.failingSlot) {
    const slot = slotLabel(props.failingSlot)
    return { text: t('settings.admin.ai.features.slotFailing', { slot }), link: t('settings.admin.ai.features.goToSlot', { slot }) }
  }
  return null
})

const privacyLine = computed(() =>
  props.feature.privacy
    ? privacyText('privacyConfirmed', { name: props.feature.privacy.username, time: relativeTimestamp(props.feature.privacy.at) })
    : t('settings.admin.ai.features.privacyFirst'),
)

const monthCount = computed(() => {
  if (!props.month) return ''
  return runsJobs.value
    ? t('settings.admin.ai.features.monthBuilds', { count: props.month.count })
    : t('settings.admin.ai.features.monthRequests', { count: props.month.count })
})

const icon = computed(() => FEATURE_ICONS[props.feature.id])
</script>

<template>
  <li class="scroll-mt-24" :data-feature="feature.id">
    <div :class="[aiTable.row, aiColumns.features, open ? aiTable.rowOpen : '']">
      <div :class="[aiTable.main, 'flex items-center gap-2.5']">
        <span
          class="grid size-8 shrink-0 place-items-center rounded-lg border"
          :class="enabled ? 'border-primary/30 bg-primary/12 text-primary' : 'border-border bg-muted text-muted-foreground'"
          aria-hidden="true"
        >
          <component :is="icon" class="size-4" />
        </span>
        <div class="min-w-0">
          <p :id="`${id}-name`" :class="aiTable.name">{{ name }}</p>
          <p :class="aiTable.sub" data-testid="ai-feature-state">
            {{ subLine }}
          </p>
        </div>
      </div>
      <div :class="aiTable.meta">
        <ul :class="aiTable.chips" :aria-label="t('settings.admin.ai.features.columns.runsOn')">
          <li v-for="slot in definition.slots" :key="slot" :class="aiTable.chip">
            <span :class="[aiTable.chipDot, slotDotClass(slot)]" aria-hidden="true" />
            {{ slotLabel(slot) }}
          </li>
          <li v-for="slot in definition.optionalSlots ?? []" :key="slot" :class="aiTable.chipOptional">
            <span :class="[aiTable.chipDot, slotDotClass(slot)]" aria-hidden="true" />
            {{ t('settings.admin.ai.features.optionalSlot', { slot: slotLabel(slot) }) }}
          </li>
        </ul>
      </div>
      <div :class="[aiTable.meta, aiTable.hideOnPhone]" data-testid="ai-feature-limits">
        <span v-if="limitsLine" class="text-foreground">{{ limitsLine }}</span>
        <span v-else class="text-muted-foreground">{{ t('settings.admin.ai.features.limitsLine.none') }}</span>
      </div>
      <div :class="[aiTable.meta, aiTable.num]" data-testid="ai-feature-month">
        <template v-if="month">
          <p>{{ formatAiCost(month.costMicros) }}</p>
          <p :class="aiTable.sub">{{ monthCount }}</p>
        </template>
      </div>
      <div class="flex justify-center max-md:order-2 max-md:ms-auto">
        <ToggleSwitch
          :model-value="enabled"
          :disabled="switching || (!enabled && missing.length > 0)"
          :aria-labelledby="`${id}-name`"
          data-testid="ai-feature-switch"
          @update:model-value="handleToggle"
        />
      </div>
      <div :class="aiTable.actions">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('settings.admin.ai.features.editNamed', { name })"
          :title="t('settings.admin.ai.features.editNamed', { name })"
          :aria-expanded="open"
          :aria-controls="`${id}-editor`"
          data-testid="ai-feature-toggle"
          @click="handleExpand"
        >
          <ChevronUp v-if="open" class="size-4" />
          <ChevronDown v-else class="size-4" />
        </Button>
      </div>
      <p v-if="note" :class="[aiTable.note, 'text-foreground']" data-testid="ai-feature-status">
        <TriangleAlert :class="[aiTable.noteIcon, 'text-warning']" aria-hidden="true" />
        <span class="min-w-0">
          {{ note.text }}
          <button type="button" :class="aiTable.link" @click="handleGoToSlot">{{ note.link }}</button>
        </span>
      </p>
    </div>

    <div v-if="open" :id="`${id}-editor`" :class="aiTable.editor" role="group" :aria-labelledby="`${id}-name`" data-testid="ai-feature-editor">
      <div v-if="hasFields" class="grid max-w-[560px] gap-x-4 gap-y-3.5 md:grid-cols-2">
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
          v-if="rules.readerMonthlyBudget"
          :label="t('settings.admin.ai.features.readerMonthlyBudget')"
          :input-id="`${id}-reader-budget`"
          :brief="t('settings.admin.ai.features.readerMonthlyBudgetBrief')"
          :error="fieldError('readerMonthlyBudget')"
        >
          <template #default="{ describedBy, invalid: fieldInvalid }">
            <input
              :id="`${id}-reader-budget`"
              v-model="fields.readerMonthlyBudget"
              type="text"
              inputmode="decimal"
              class="settings-control tabular-nums"
              :aria-describedby="describedBy"
              :aria-invalid="fieldInvalid"
              data-testid="ai-feature-reader-budget"
            />
          </template>
        </SettingsField>
        <SettingsField
          v-if="rules.readerRequestsPerMonth"
          :label="t('settings.admin.ai.features.readerRequestsPerMonth')"
          :input-id="`${id}-reader-requests`"
          :brief="t('settings.admin.ai.features.readerRequestsPerMonthBrief')"
          :error="fieldError('readerRequestsPerMonth')"
        >
          <template #default="{ describedBy, invalid: fieldInvalid }">
            <input
              :id="`${id}-reader-requests`"
              v-model="fields.readerRequestsPerMonth"
              type="text"
              inputmode="numeric"
              class="settings-control tabular-nums"
              :aria-describedby="describedBy"
              :aria-invalid="fieldInvalid"
              data-testid="ai-feature-reader-requests"
            />
          </template>
        </SettingsField>
      </div>
      <p v-else :class="aiTable.footNote">{{ t('settings.admin.ai.features.noOwnLimits', { name }) }}</p>

      <div :class="aiTable.foot">
        <p :class="[aiTable.footNote, 'min-w-0']" data-testid="ai-feature-privacy">{{ privacyLine }}</p>
        <span class="flex-1" />
        <RouterLink
          v-if="feature.id === 'story-guides'"
          :to="{ name: 'jobs-story-guides' }"
          class="inline-flex items-center gap-1 rounded-xs text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          data-testid="ai-story-guides-link"
        >
          {{ t('settings.admin.ai.features.storyGuides.movedLink') }}
          <ArrowUpRight class="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </RouterLink>
        <template v-if="hasFields">
          <Button variant="ghost" size="sm" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button size="sm" :disabled="!dirty || invalid || saving" data-testid="ai-feature-save" @click="handleSave">
            <Loader2 v-if="saving" class="size-3.5 animate-spin" />
            {{ t('settings.admin.ai.features.save') }}
          </Button>
        </template>
      </div>
    </div>

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
  </li>
</template>
