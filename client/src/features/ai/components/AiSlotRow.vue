<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, FlaskConical, Info, Loader2, Plus } from '@lucide/vue'
import {
  AI_EFFORTS,
  AI_JSON_MODES,
  AI_MODEL_MAX_LENGTH,
  detectAiConnection,
  type AiConnection,
  type AiEffort,
  type AiJsonMode,
  type AiModelInfo,
  type AiModelList,
  type AiPresetId,
  type AiSlot,
  type AiSlotEffort,
  type AiSlotHealth,
  type AiSlotSettings,
  type AiTryResult,
  type UpdateAiSlotRequest,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import { failureText, featureShortName, formatAiCost, formatTokenPrice, formatTokenPriceShort, slotLabel, tryKindLabel } from '../lib/ai-format'
import { aiColumns, aiTable, slotDotClass, type AiStatusTone } from '../lib/ai-settings-ui'
import AiStatusText from './AiStatusText.vue'

const props = defineProps<{
  slotId: AiSlot
  value: AiSlotSettings
  health?: AiSlotHealth
  connections: AiConnection[]
  /** Model lists per connection; the row reads the one for the connection picked, saved or not. */
  modelLists: Record<number, AiModelList | 'loading' | 'error'>
  /** The features that send to this slot; an optional one uses it only when it has a model. */
  usedBy: Array<{ id: string; optional: boolean }>
  open: boolean
  saving: boolean
  trying: boolean
  tryResult: AiTryResult | null
  tryError: { text: string; providerMessage: string | null } | null
}>()

const emit = defineEmits<{
  needModels: [connectionId: number, force: boolean]
  save: [request: UpdateAiSlotRequest]
  /** With a request when there are edits: they are saved first, so Try it asks about what is shown. */
  try: [request: UpdateAiSlotRequest | null]
  addAnthropic: [connection: AiConnection]
  setOpen: [open: boolean]
}>()

const { t } = useI18n()
const id = useId()

/** Proxies that also answer Anthropic Messages, where Claude gets its JSON schema enforced. */
const CLAUDE_PROXIES = new Set<AiPresetId>(['cliproxyapi', 'openrouter', 'ollama', 'vllm'])

interface SlotDraft {
  connectionId: string
  model: string
  priceInput: string
  priceOutput: string
  jsonMode: AiJsonMode
  maxOutputTokens: number | null
  effort: AiSlotEffort
}

function draftOf(value: AiSlotSettings): SlotDraft {
  return {
    connectionId: value.connectionId === null ? '' : String(value.connectionId),
    model: value.model ?? '',
    priceInput: value.prices ? String(value.prices.input) : '',
    priceOutput: value.prices ? String(value.prices.output) : '',
    jsonMode: value.jsonMode,
    maxOutputTokens: value.maxOutputTokens,
    effort: value.effort,
  }
}

// A level set on the slot shows without opening Advanced first.
const advancedOpen = props.value.effort !== 'auto'

const draft = ref<SlotDraft>(draftOf(props.value))
// A reload that brings the same values back keeps what is being typed.
watch(
  () => JSON.stringify(draftOf(props.value)),
  () => {
    draft.value = draftOf(props.value)
  },
)

const filled = computed(() => props.value.connectionId !== null && props.value.model !== null)
const savedConnection = computed(() => props.connections.find((entry) => entry.id === props.value.connectionId) ?? null)

function listFor(connectionId: number | null): AiModelList | null {
  if (connectionId === null) return null
  const list = props.modelLists[connectionId]
  return list && typeof list === 'object' ? list : null
}

/** What the saved model's list says about it, for the collapsed row. */
const savedInfo = computed<AiModelInfo | null>(
  () => listFor(props.value.connectionId)?.models.find((model) => model.id === props.value.model) ?? null,
)

const connection = computed(() => props.connections.find((entry) => String(entry.id) === draft.value.connectionId) ?? null)
const preset = computed(() => (connection.value ? detectAiConnection(connection.value.baseUrl)?.preset : undefined))
const models = computed(() => (draft.value.connectionId ? props.modelLists[Number(draft.value.connectionId)] : undefined))
const modelList = computed(() => (models.value && typeof models.value === 'object' ? models.value : null))
const modelInfo = computed<AiModelInfo | null>(() => modelList.value?.models.find((model) => model.id === draft.value.model.trim()) ?? null)
const modelLabel = computed(() => (preset.value === 'azure' ? t('settings.admin.ai.models.deployment') : t('settings.admin.ai.models.model')))

watch(
  () => draft.value.connectionId,
  (connectionId) => {
    if (connectionId) emit('needModels', Number(connectionId), false)
  },
  { immediate: true },
)

/**
 * A model picked from the list brings its prices and output limit. The saved model keeps what was
 * saved, so prices typed by hand are not replaced just because the list loaded.
 */
watch(modelInfo, (info, previous) => {
  if (!info || info.id === previous?.id || info.id === props.value.model) return
  if (info.prices) {
    draft.value.priceInput = String(info.prices.input)
    draft.value.priceOutput = String(info.prices.output)
  }
  draft.value.maxOutputTokens = info.maxOutputTokens ?? null
  const effort = draft.value.effort
  if (effort !== 'auto' && info.efforts && !info.efforts.includes(effort)) draft.value.effort = 'auto'
})

/** The levels the model lists; every level when its provider does not say. */
const effortOptions = computed<AiSlotEffort[]>(() => {
  const levels: AiSlotEffort[] = ['auto', ...(modelInfo.value?.efforts ?? AI_EFFORTS)]
  // A saved level the list no longer has stays visible, so the select shows what is set.
  if (!levels.includes(draft.value.effort)) levels.push(draft.value.effort)
  return levels
})

const effortBrief = computed(() => {
  const info = modelInfo.value
  if (info?.efforts?.length === 0) return t('settings.admin.ai.models.effortNone')
  if (!info?.efforts) return t('settings.admin.ai.models.effortUnknown')
  if (!info.defaultEffort) return t('settings.admin.ai.models.effortListed')
  return t('settings.admin.ai.models.effortListedDefault', { level: effortLabel(info.defaultEffort) })
})

function effortLabel(level: AiSlotEffort | AiEffort): string {
  return t(`settings.admin.ai.models.efforts.${level}`)
}

function contextLabel(model: AiModelInfo): string | null {
  return model.contextLength ? t('settings.admin.ai.models.contextShort', { tokens: formatCompactNumber(model.contextLength) }) : null
}

function optionLabel(model: AiModelInfo): string {
  const parts: string[] = []
  if (model.name && model.name !== model.id) parts.push(model.name)
  if (model.prices) {
    parts.push(
      t('settings.admin.ai.models.priceShort', { input: formatTokenPrice(model.prices.input), output: formatTokenPrice(model.prices.output) }),
    )
  }
  const context = contextLabel(model)
  if (context) parts.push(context)
  return parts.join(' · ')
}

/** What the provider's list says about the model picked, in one sentence, or why there is nothing to say. */
const facts = computed<{ tone: 'listed' | 'info'; text: string } | null>(() => {
  if (models.value === 'loading') return { tone: 'info', text: t('settings.admin.ai.models.listLoading') }
  if (models.value === 'error') return { tone: 'info', text: t('settings.admin.ai.models.listFailedHint') }
  if (modelList.value && !modelList.value.listed) return { tone: 'info', text: t('settings.admin.ai.failures.no-model-list') }
  const info = modelInfo.value
  if (!info || !connection.value) return null
  const provider = connection.value.name
  const context = contextLabel(info)
  if (info.prices) {
    const prices = { input: formatTokenPriceShort(info.prices.input), output: formatTokenPriceShort(info.prices.output) }
    return context
      ? { tone: 'listed', text: t('settings.admin.ai.models.factsContextPrices', { provider, context, ...prices }) }
      : { tone: 'listed', text: t('settings.admin.ai.models.factsPrices', { provider, ...prices }) }
  }
  return context ? { tone: 'listed', text: t('settings.admin.ai.models.factsContext', { provider, context }) } : null
})

const pricesInvalid = computed(() => {
  const { priceInput, priceOutput } = draft.value
  if (!priceInput.trim() && !priceOutput.trim()) return false
  return [priceInput, priceOutput].some((price) => !/^\d+(\.\d+)?$/.test(price.trim()))
})

const incomplete = computed(() => Boolean(draft.value.connectionId) !== Boolean(draft.value.model.trim()))
const dirty = computed(() => JSON.stringify(draftOf(props.value)) !== JSON.stringify(draft.value))
const canSave = computed(() => dirty.value && !props.saving && !incomplete.value && !pricesInvalid.value)
/** Edits are saved before trying, so a draft without a model has nothing to try. */
const canTry = computed(() => {
  if (props.trying || props.saving) return false
  if (!dirty.value) return filled.value
  return !incomplete.value && !pricesInvalid.value && Boolean(draft.value.model.trim())
})

function handleConnectionChange() {
  draft.value.model = ''
  draft.value.priceInput = ''
  draft.value.priceOutput = ''
  draft.value.maxOutputTokens = null
  draft.value.effort = 'auto'
}

function request(): UpdateAiSlotRequest {
  const model = draft.value.connectionId ? draft.value.model.trim() || null : null
  const connectionId = model === null ? null : Number(draft.value.connectionId)
  const priced = model !== null && draft.value.priceInput.trim() !== '' && draft.value.priceOutput.trim() !== ''
  return {
    connectionId,
    model,
    prices: priced ? { input: Number(draft.value.priceInput), output: Number(draft.value.priceOutput) } : null,
    jsonMode: draft.value.jsonMode,
    maxOutputTokens: model === null ? null : draft.value.maxOutputTokens,
    effort: model === null ? 'auto' : draft.value.effort,
  }
}

function handleSave() {
  if (!canSave.value) return
  emit('save', request())
}

function handleTry() {
  if (!canTry.value) return
  emit('try', dirty.value ? request() : null)
}

function handleToggle() {
  emit('setOpen', !props.open)
}

function handleOpen() {
  emit('setOpen', true)
}

function handleCancel() {
  draft.value = draftOf(props.value)
  emit('setOpen', false)
}

function handleRetryModels() {
  emit('needModels', Number(draft.value.connectionId), true)
}

function handleAddAnthropic() {
  if (connection.value) emit('addAnthropic', connection.value)
}

/** Claude through a proxy's OpenAI endpoint gets its schema turned into a plain instruction. */
const anthropicOffer = computed(
  () =>
    connection.value !== null &&
    connection.value.apiType !== 'anthropic-messages' &&
    preset.value !== undefined &&
    CLAUDE_PROXIES.has(preset.value) &&
    draft.value.model.trim().toLowerCase().startsWith('claude'),
)

const status = computed<{ tone: AiStatusTone; label: string }>(() => {
  if (props.health)
    return { tone: 'error', label: t('settings.admin.ai.models.statusFailing', { time: relativeTimestamp(props.health.failingSince) }) }
  if (!filled.value) return { tone: 'idle', label: t('settings.admin.ai.models.statusNotSet') }
  const saved = savedConnection.value
  if (saved?.status === 'failing') return { tone: 'error', label: t('settings.admin.ai.models.statusProviderFailing') }
  if (saved?.status === 'untested') return { tone: 'idle', label: t('settings.admin.ai.models.statusUntested') }
  return { tone: 'ok', label: t('settings.admin.ai.models.statusWorking') }
})

/** Why the slot's requests fail, with a way to choose another provider. */
const problem = computed(() => {
  if (props.health) return failureText(props.health.code, { message: props.health.reason })
  const saved = savedConnection.value
  if (filled.value && saved?.status === 'failing') return t('settings.admin.ai.models.providerFailing', { name: saved.name })
  return null
})

const modelSub = computed(() => {
  const parts = [savedConnection.value?.name ?? '']
  const context = savedInfo.value ? contextLabel(savedInfo.value) : null
  if (context) parts.push(context)
  return parts.filter(Boolean).join(' · ')
})

const tryLine = computed(() => {
  const result = props.tryResult
  if (!result) return ''
  return t(result.books ? 'settings.admin.ai.models.tryDoneBooks' : 'settings.admin.ai.models.tryDone', {
    count: result.books ? result.books.length : result.names.length,
    model: result.model,
    time:
      result.durationMs < 1000
        ? t('settings.admin.ai.models.durationMs', { ms: formatNumber(result.durationMs) })
        : t('settings.admin.ai.models.durationSeconds', { seconds: formatNumber(result.durationMs / 1000, { maximumFractionDigits: 1 }) }),
    cost: result.costMicros === null ? t('settings.admin.ai.models.costUnknown') : formatAiCost(result.costMicros),
  })
})
</script>

<template>
  <li :id="`ai-slot-${slotId}`" class="scroll-mt-24" :data-slot="slotId">
    <div :class="[aiTable.row, aiColumns.models, open ? aiTable.rowOpen : '']">
      <div :class="aiTable.main">
        <p class="flex items-center gap-[5px] text-[13px] leading-[18px] font-semibold text-foreground">
          <span :class="[aiTable.chipDot, slotDotClass(slotId)]" aria-hidden="true" />
          <span :id="`${id}-name`">{{ slotLabel(slotId) }}</span>
        </p>
        <ul v-if="usedBy.length" :class="[aiTable.chips, 'mt-[5px]']" :aria-label="t('settings.admin.ai.models.usedBy')">
          <li v-for="use in usedBy" :key="use.id" :class="use.optional ? aiTable.chipOptional : aiTable.chip">
            {{ use.optional ? t('settings.admin.ai.models.optionalUse', { name: featureShortName(use.id) }) : featureShortName(use.id) }}
          </li>
        </ul>
      </div>
      <div :class="aiTable.wide" data-testid="ai-slot-summary">
        <template v-if="filled">
          <p :class="[aiTable.mono, 'truncate text-foreground']">{{ value.model }}</p>
          <p :class="[aiTable.sub, 'truncate']">{{ modelSub }}</p>
        </template>
        <template v-else>
          <p class="text-muted-foreground">{{ t('settings.admin.ai.models.notSet') }}</p>
          <p :class="aiTable.sub">
            {{ connections.length ? t('settings.admin.ai.models.chooseModel') : t('settings.admin.ai.models.addProviderFirst') }}
          </p>
        </template>
      </div>
      <div :class="[aiTable.meta, aiTable.num]">
        <template v-if="value.prices">
          <p>
            {{
              t('settings.admin.ai.models.priceCell', {
                input: formatTokenPriceShort(value.prices.input),
                output: formatTokenPriceShort(value.prices.output),
              })
            }}
          </p>
          <p :class="aiTable.sub">{{ t('settings.admin.ai.models.inOut') }}</p>
        </template>
        <p v-else class="text-muted-foreground">{{ t('settings.admin.ai.models.noPrice') }}</p>
      </div>
      <div :class="aiTable.meta">
        <AiStatusText :tone="status.tone" :label="status.label" />
      </div>
      <div :class="aiTable.actions">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="!filled || trying || saving"
          :aria-label="t('settings.admin.ai.models.tryNamed', { slot: slotLabel(slotId) })"
          :title="t('settings.admin.ai.models.tryNamed', { slot: slotLabel(slotId) })"
          data-testid="ai-slot-try-row"
          @click="handleTry"
        >
          <Loader2 v-if="trying" class="size-4 animate-spin" />
          <FlaskConical v-else class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="!open && connections.length === 0 && !filled"
          :aria-label="t('settings.admin.ai.models.editNamed', { slot: slotLabel(slotId) })"
          :title="t('settings.admin.ai.models.editNamed', { slot: slotLabel(slotId) })"
          :aria-expanded="open"
          :aria-controls="`${id}-editor`"
          data-testid="ai-slot-toggle"
          @click="handleToggle"
        >
          <ChevronUp v-if="open" class="size-4" />
          <ChevronDown v-else class="size-4" />
        </Button>
      </div>
      <p v-if="problem" :class="[aiTable.note, 'text-destructive']" data-testid="ai-slot-health">
        <CircleAlert :class="aiTable.noteIcon" aria-hidden="true" />
        <span class="min-w-0">
          {{ problem }}
          <button v-if="!open" type="button" :class="aiTable.link" @click="handleOpen">{{ t('settings.admin.ai.models.useAnother') }}</button>
        </span>
      </p>
    </div>

    <div v-if="open" :id="`${id}-editor`" :class="aiTable.editor" role="group" :aria-labelledby="`${id}-name`" data-testid="ai-slot-editor">
      <div class="grid gap-x-4 gap-y-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
        <SettingsField :label="t('settings.admin.ai.models.provider')" :input-id="`${id}-connection`">
          <select
            :id="`${id}-connection`"
            v-model="draft.connectionId"
            class="settings-control"
            data-testid="ai-slot-connection"
            @change="handleConnectionChange"
          >
            <option value="">{{ t('settings.admin.ai.models.none') }}</option>
            <option v-for="entry in connections" :key="entry.id" :value="String(entry.id)" :disabled="!entry.usable">{{ entry.name }}</option>
          </select>
        </SettingsField>

        <SettingsField :label="modelLabel" :input-id="`${id}-model`" :error="incomplete ? t('settings.admin.ai.models.bothRequired') : null">
          <template #default="{ describedBy, invalid }">
            <div class="flex gap-2">
              <input
                :id="`${id}-model`"
                v-model="draft.model"
                type="text"
                class="settings-control min-w-0 flex-1 font-mono text-[13px]"
                :list="modelList?.listed ? `${id}-models` : undefined"
                :maxlength="AI_MODEL_MAX_LENGTH"
                :disabled="!draft.connectionId"
                :placeholder="modelList?.listed ? t('settings.admin.ai.models.modelPlaceholder') : undefined"
                :aria-describedby="describedBy"
                :aria-invalid="invalid"
                autocomplete="off"
                spellcheck="false"
                data-testid="ai-slot-model"
              />
              <Button v-if="models === 'error'" type="button" variant="outline" size="sm" class="h-9 shrink-0" @click="handleRetryModels">
                {{ t('common.retry') }}
              </Button>
            </div>
            <datalist v-if="modelList?.listed" :id="`${id}-models`">
              <option v-for="model in modelList.models" :key="model.id" :value="model.id">{{ optionLabel(model) }}</option>
            </datalist>
          </template>
        </SettingsField>

        <SettingsField
          :label="t('settings.admin.ai.models.priceInputPerMillion')"
          :input-id="`${id}-price-in`"
          :error="pricesInvalid ? t('settings.admin.ai.models.priceInvalid') : null"
        >
          <template #default="{ describedBy, invalid }">
            <input
              :id="`${id}-price-in`"
              v-model="draft.priceInput"
              type="text"
              inputmode="decimal"
              class="settings-control tabular-nums"
              :disabled="!draft.connectionId"
              :aria-describedby="describedBy"
              :aria-invalid="invalid"
              data-testid="ai-slot-price-input"
            />
          </template>
        </SettingsField>
        <SettingsField :label="t('settings.admin.ai.models.priceOutputPerMillion')" :input-id="`${id}-price-out`">
          <input
            :id="`${id}-price-out`"
            v-model="draft.priceOutput"
            type="text"
            inputmode="decimal"
            class="settings-control tabular-nums"
            :disabled="!draft.connectionId"
            :aria-invalid="pricesInvalid"
            data-testid="ai-slot-price-output"
          />
        </SettingsField>
      </div>

      <p v-if="facts" class="mt-3 flex items-start gap-2 text-xs leading-4 text-muted-foreground" data-testid="ai-slot-facts">
        <CircleCheck v-if="facts.tone === 'listed'" class="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <Info v-else class="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1">{{ facts.text }}</span>
      </p>

      <div
        v-if="anthropicOffer && connection"
        class="mt-3 flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5 sm:flex-row sm:items-center"
        data-testid="ai-anthropic-offer"
      >
        <p class="min-w-0 flex-1 text-xs text-muted-foreground">{{ t('settings.admin.ai.models.anthropicOffer') }}</p>
        <Button type="button" variant="outline" size="sm" class="self-start sm:self-center" @click="handleAddAnthropic">
          <Plus class="size-3.5" />
          {{ t('settings.admin.ai.models.anthropicAdd') }}
        </Button>
      </div>

      <details :open="advancedOpen" class="group mt-3">
        <summary
          class="inline-flex cursor-pointer list-none items-center gap-1 rounded-xs text-[13px] font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
        >
          <ChevronRight class="size-3.5 transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90" aria-hidden="true" />
          {{ t('settings.admin.ai.models.advanced') }}
        </summary>
        <div class="mt-3 grid max-w-[520px] gap-x-4 gap-y-3.5 md:grid-cols-2">
          <SettingsField
            :label="t('settings.admin.ai.models.jsonOutput')"
            :input-id="`${id}-json`"
            :brief="t('settings.admin.ai.models.jsonModeBrief')"
          >
            <template #default="{ describedBy }">
              <select :id="`${id}-json`" v-model="draft.jsonMode" class="settings-control" :aria-describedby="describedBy">
                <option v-for="mode in AI_JSON_MODES" :key="mode" :value="mode">{{ t(`settings.admin.ai.models.jsonModes.${mode}`) }}</option>
              </select>
            </template>
          </SettingsField>
          <SettingsField :label="t('settings.admin.ai.models.effort')" :input-id="`${id}-effort`" :brief="effortBrief">
            <template #default="{ describedBy }">
              <select
                :id="`${id}-effort`"
                v-model="draft.effort"
                class="settings-control"
                :disabled="!draft.connectionId"
                :aria-describedby="describedBy"
                data-testid="ai-slot-effort"
              >
                <option v-for="level in effortOptions" :key="level" :value="level">{{ effortLabel(level) }}</option>
              </select>
            </template>
          </SettingsField>
        </div>
      </details>

      <div :class="aiTable.foot">
        <p v-if="tryError" class="flex min-w-0 items-start gap-2 text-xs leading-4 text-destructive" role="alert" data-testid="ai-try-error">
          <CircleAlert class="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span class="min-w-0">
            {{ tryError.text }}
            <span v-if="tryError.providerMessage" class="font-mono break-words text-muted-foreground">{{ tryError.providerMessage }}</span>
          </span>
        </p>
        <p
          v-else-if="tryResult"
          class="flex min-w-0 items-center gap-2 text-xs leading-4 text-muted-foreground"
          role="status"
          data-testid="ai-try-line"
        >
          <CircleCheck class="size-3.5 shrink-0 text-success" aria-hidden="true" />
          <span class="min-w-0">{{ tryLine }}</span>
        </p>
        <span class="flex-1" />
        <Button variant="ghost" size="sm" data-testid="ai-slot-cancel" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button variant="outline" size="sm" :disabled="!canTry" data-testid="ai-slot-try" @click="handleTry">
          <Loader2 v-if="trying" class="size-3.5 animate-spin" />
          <FlaskConical v-else class="size-3.5" />
          {{ trying ? t('settings.admin.ai.models.trying') : dirty ? t('settings.admin.ai.models.saveAndTry') : t('settings.admin.ai.models.try') }}
        </Button>
        <Button size="sm" :disabled="!canSave" data-testid="ai-slot-save" @click="handleSave">
          <Loader2 v-if="saving" class="size-3.5 animate-spin" />
          {{ t('settings.admin.ai.models.save') }}
        </Button>
      </div>

      <div v-if="tryResult" class="mt-3 rounded-md border border-border bg-card px-3 py-2.5" data-testid="ai-try-result">
        <ul v-if="tryResult.books" class="flex flex-col gap-2" data-testid="ai-try-books">
          <li v-for="(entry, index) in tryResult.books" :key="index" class="text-sm leading-snug">
            <span class="font-medium text-foreground">{{ entry.title }}</span>
            <span v-if="entry.author" class="block text-xs text-muted-foreground">{{ entry.author }}</span>
          </li>
        </ul>
        <ul v-else class="flex flex-col gap-2">
          <li v-for="entry in tryResult.names" :key="entry.name" class="text-sm leading-snug">
            <span class="font-medium text-foreground">{{ entry.name }}</span>
            <span class="ms-1.5 inline-block rounded-full bg-muted px-1.5 py-px text-[0.6875rem] text-muted-foreground">{{
              tryKindLabel(entry.kind)
            }}</span>
            <span v-if="entry.description" class="block text-xs text-muted-foreground">{{ entry.description }}</span>
          </li>
        </ul>
        <p class="mt-2.5 text-xs text-muted-foreground">
          {{ t('settings.admin.ai.models.tryJson', { how: t(`settings.admin.ai.test.jsonSupport.${tryResult.jsonSupport}`) }) }}
        </p>
      </div>
    </div>
  </li>
</template>
