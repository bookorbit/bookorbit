<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, FlaskConical, Loader2, Plus } from '@lucide/vue'
import {
  AI_JSON_MODES,
  AI_MODEL_MAX_LENGTH,
  detectAiConnection,
  type AiConnection,
  type AiJsonMode,
  type AiModelInfo,
  type AiModelList,
  type AiPresetId,
  type AiSlot,
  type AiSlotHealth,
  type AiSlotSettings,
  type AiTryResult,
  type UpdateAiSlotRequest,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import { failureText, formatAiCost, formatTokenPrice, slotLabel, tryKindLabel } from '../lib/ai-format'

const props = defineProps<{
  slotId: AiSlot
  value: AiSlotSettings
  health?: AiSlotHealth
  connections: AiConnection[]
  /** Model lists per connection; the row reads the one for the connection picked, saved or not. */
  modelLists: Record<number, AiModelList | 'loading' | 'error'>
  saving: boolean
  trying: boolean
  tryResult: AiTryResult | null
  tryError: { text: string; providerMessage: string | null } | null
}>()

const emit = defineEmits<{
  needModels: [connectionId: number, force: boolean]
  save: [request: UpdateAiSlotRequest]
  try: []
  addAnthropic: [connection: AiConnection]
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
}

function draftOf(value: AiSlotSettings): SlotDraft {
  return {
    connectionId: value.connectionId === null ? '' : String(value.connectionId),
    model: value.model ?? '',
    priceInput: value.prices ? String(value.prices.input) : '',
    priceOutput: value.prices ? String(value.prices.output) : '',
    jsonMode: value.jsonMode,
    maxOutputTokens: value.maxOutputTokens,
  }
}

const draft = ref<SlotDraft>(draftOf(props.value))
// A reload that brings the same values back keeps what is being typed.
watch(
  () => JSON.stringify(draftOf(props.value)),
  () => {
    draft.value = draftOf(props.value)
  },
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
})

function modelFacts(model: AiModelInfo): string {
  const parts: string[] = []
  if (model.prices) {
    parts.push(
      t('settings.admin.ai.models.priceShort', { input: formatTokenPrice(model.prices.input), output: formatTokenPrice(model.prices.output) }),
    )
  }
  if (model.contextLength) parts.push(t('settings.admin.ai.models.contextShort', { tokens: formatCompactNumber(model.contextLength) }))
  return parts.join(' · ')
}

function optionLabel(model: AiModelInfo): string {
  return [model.name && model.name !== model.id ? model.name : '', modelFacts(model)].filter(Boolean).join(' · ')
}

const modelBrief = computed(() => {
  if (models.value === 'loading') return t('settings.admin.ai.models.listLoading')
  if (models.value === 'error') return t('settings.admin.ai.models.listFailedHint')
  if (modelList.value && !modelList.value.listed) return t('settings.admin.ai.failures.no-model-list')
  return modelInfo.value ? modelFacts(modelInfo.value) || undefined : undefined
})

const pricesInvalid = computed(() => {
  const { priceInput, priceOutput } = draft.value
  if (!priceInput.trim() && !priceOutput.trim()) return false
  return [priceInput, priceOutput].some((price) => !/^\d+(\.\d+)?$/.test(price.trim()))
})

const incomplete = computed(() => Boolean(draft.value.connectionId) !== Boolean(draft.value.model.trim()))
const dirty = computed(() => JSON.stringify(draftOf(props.value)) !== JSON.stringify(draft.value))
const filled = computed(() => props.value.connectionId !== null && props.value.model !== null)

function handleConnectionChange() {
  draft.value.model = ''
  draft.value.priceInput = ''
  draft.value.priceOutput = ''
  draft.value.maxOutputTokens = null
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
  }
}

function handleSave() {
  if (incomplete.value || pricesInvalid.value) return
  emit('save', request())
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
  <article :id="`ai-slot-${slotId}`" class="flex scroll-mt-24 flex-col gap-4 px-4 py-4 md:px-5" :data-slot="slotId">
    <div class="min-w-0">
      <h4 class="text-sm font-semibold text-foreground">{{ slotLabel(slotId) }}</h4>
      <p class="settings-hint mt-0.5">{{ t(`settings.admin.ai.models.slotBriefs.${slotId}`) }}</p>
    </div>

    <p v-if="health" class="flex items-start gap-1.5 text-xs text-destructive" data-testid="ai-slot-health">
      <AlertTriangle class="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{{
        t('settings.admin.ai.models.failing', {
          time: relativeTimestamp(health.failingSince),
          reason: failureText(health.code, { message: health.reason }),
        })
      }}</span>
    </p>

    <div class="grid gap-4 sm:grid-cols-2">
      <SettingsField :label="t('settings.admin.ai.models.connection')" :input-id="`${id}-connection`">
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

      <SettingsField
        :label="modelLabel"
        :input-id="`${id}-model`"
        :brief="modelBrief"
        :error="incomplete ? t('settings.admin.ai.models.bothRequired') : null"
      >
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
            <Button
              v-if="models === 'error'"
              type="button"
              variant="outline"
              size="sm"
              class="shrink-0"
              @click="emit('needModels', Number(draft.connectionId), true)"
            >
              {{ t('common.retry') }}
            </Button>
          </div>
          <datalist v-if="modelList?.listed" :id="`${id}-models`">
            <option v-for="model in modelList.models" :key="model.id" :value="model.id">{{ optionLabel(model) }}</option>
          </datalist>
        </template>
      </SettingsField>
    </div>

    <div
      v-if="anthropicOffer && connection"
      class="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 sm:flex-row sm:items-center"
      data-testid="ai-anthropic-offer"
    >
      <p class="min-w-0 flex-1 text-xs text-muted-foreground">{{ t('settings.admin.ai.models.anthropicOffer') }}</p>
      <Button type="button" variant="outline" size="sm" class="self-start sm:self-center" @click="emit('addAnthropic', connection)">
        <Plus class="size-3.5" />
        {{ t('settings.admin.ai.models.anthropicAdd') }}
      </Button>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <SettingsField
        :label="t('settings.admin.ai.models.priceInput')"
        :input-id="`${id}-price-in`"
        :brief="t('settings.admin.ai.models.priceBrief')"
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
      <SettingsField :label="t('settings.admin.ai.models.priceOutput')" :input-id="`${id}-price-out`">
        <input
          :id="`${id}-price-out`"
          v-model="draft.priceOutput"
          type="text"
          inputmode="decimal"
          class="settings-control tabular-nums"
          :disabled="!draft.connectionId"
          data-testid="ai-slot-price-output"
        />
      </SettingsField>
    </div>

    <details>
      <summary class="settings-label w-fit cursor-pointer rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        {{ t('settings.admin.ai.models.advanced') }}
      </summary>
      <div class="mt-3 max-w-xs">
        <SettingsField :label="t('settings.admin.ai.models.jsonMode')" :input-id="`${id}-json`" :brief="t('settings.admin.ai.models.jsonModeBrief')">
          <template #default="{ describedBy }">
            <select :id="`${id}-json`" v-model="draft.jsonMode" class="settings-control" :aria-describedby="describedBy">
              <option v-for="mode in AI_JSON_MODES" :key="mode" :value="mode">{{ t(`settings.admin.ai.models.jsonModes.${mode}`) }}</option>
            </select>
          </template>
        </SettingsField>
      </div>
    </details>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" :disabled="!dirty || saving || incomplete || pricesInvalid" data-testid="ai-slot-save" @click="handleSave">
        <Loader2 v-if="saving" class="size-3.5 animate-spin" />
        {{ t('settings.admin.ai.models.save') }}
      </Button>
      <Button variant="outline" size="sm" :disabled="!filled || dirty || trying" data-testid="ai-slot-try" @click="emit('try')">
        <Loader2 v-if="trying" class="size-3.5 animate-spin" />
        <FlaskConical v-else class="size-3.5" />
        {{ trying ? t('settings.admin.ai.models.trying') : t('settings.admin.ai.models.try') }}
      </Button>
      <p v-if="dirty && filled" class="text-xs text-muted-foreground">{{ t('settings.admin.ai.models.saveBeforeTry') }}</p>
    </div>

    <div v-if="tryError" role="alert" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs" data-testid="ai-try-error">
      <p class="text-destructive">{{ tryError.text }}</p>
      <p v-if="tryError.providerMessage" class="mt-1 break-words font-mono text-muted-foreground">
        {{ t('settings.admin.ai.connections.providerSaid', { message: tryError.providerMessage }) }}
      </p>
    </div>

    <div v-if="tryResult" class="rounded-md border border-border bg-muted/30 px-3 py-3" data-testid="ai-try-result">
      <p class="text-xs text-muted-foreground">{{ tryLine }}</p>
      <ul v-if="tryResult.books" class="mt-2.5 flex flex-col gap-2" data-testid="ai-try-books">
        <li v-for="(entry, index) in tryResult.books" :key="index" class="text-sm leading-snug">
          <span class="font-medium text-foreground">{{ entry.title }}</span>
          <span v-if="entry.author" class="block text-xs text-muted-foreground">{{ entry.author }}</span>
        </li>
      </ul>
      <ul v-else class="mt-2.5 flex flex-col gap-2">
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
  </article>
</template>
