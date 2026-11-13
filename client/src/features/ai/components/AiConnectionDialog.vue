<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Eye, EyeOff, Plus, X } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import {
  AI_API_TYPES,
  AI_CONNECTION_LIMITS,
  AI_HEADER_MAX_COUNT,
  AI_KEY_MAX_LENGTH,
  AI_NAME_MAX_LENGTH,
  AI_PRESET_IDS,
  AI_PRESETS,
  AI_URL_MAX_LENGTH,
  aiEndpointUrl,
  type AiConnection,
  type AiConnectionTestResult,
  type AiPresetId,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ChipInput from '@/components/ui/ChipInput.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { errorMessage } from '@/lib/api-json'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import * as aiApi from '../api/ai.api'
import {
  createRequest,
  draftFromConnection,
  draftFromPreset,
  draftFromUrl,
  normalisedBaseUrl,
  testRequest,
  updateRequest,
  validateDraft,
  type AiConnectionDraft,
  type AiDraftErrors,
} from '../lib/ai-connection-draft'
import { connectionHost, maskedHint } from '../lib/ai-format'
import AiTestChecklist from './AiTestChecklist.vue'

/** What a caller can fill in before the dialog opens on its details step, such as a second API type for one host. */
export interface AiConnectionPrefill {
  name: string
  apiType: AiConnectionDraft['apiType']
  baseUrl: string
}

const props = defineProps<{
  open: boolean
  /** Editing this connection; null adds one. */
  connection: AiConnection | null
  prefill?: AiConnectionPrefill | null
  /** A preset picked before the dialog opened, which starts it on the details step. */
  presetId?: AiPresetId | null
  /** The model a slot uses on this connection, which the test asks by default. */
  slotModel?: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  saved: [connection: AiConnection, testPassed: boolean]
}>()

const { t } = useI18n()
const formId = useId()

type Step = 1 | 2 | 3

const step = ref<Step>(1)
const presetChosen = ref(false)
const draft = ref<AiConnectionDraft>(draftFromPreset('other'))
const initial = ref('')
const pasteUrl = ref('')
const pasteInvalid = ref(false)
const showKey = ref(false)
const errors = ref<AiDraftErrors>({})
const testResult = ref<AiConnectionTestResult | null>(null)
const testing = ref(false)
const testError = ref<string | null>(null)
const testModel = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)
const confirmSaveOpen = ref(false)
const discardOpen = ref(false)
let testRun = 0

const editing = computed(() => props.connection !== null)
const preset = computed(() => AI_PRESETS[draft.value.presetId])
const storedKeyHint = computed(() => (props.connection?.hasKey && !draft.value.removeKey ? (props.connection.keyHint ?? '') : null))
const keyRequired = computed(() => !preset.value.keyOptional && !storedKeyHint.value && !editing.value)
const endpoint = computed(() => {
  const base = normalisedBaseUrl(draft.value)
  return base ? aiEndpointUrl(base, draft.value.apiType) : ''
})
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value)
const modelLabel = computed(() =>
  preset.value.modelLabel === 'deployment' ? t('settings.admin.ai.sheet.testDeployment') : t('settings.admin.ai.sheet.testModel'),
)
const listedModels = computed(() => (testResult.value?.models?.listed ? testResult.value.models.models : []))
const advancedOpen = computed(
  () =>
    draft.value.headers.length > 0 ||
    Boolean(draft.value.proxyUrl || draft.value.resolvers.length) ||
    Boolean(errors.value.headers || errors.value.timeoutSeconds || errors.value.maxParallel || errors.value.requestsPerMinute),
)
const busy = computed(() => saving.value)

const title = computed(() =>
  props.connection ? t('settings.admin.ai.sheet.editTitle', { name: props.connection.name }) : t('settings.admin.ai.sheet.addTitle'),
)
const submitLabel = computed(() => {
  if (step.value === 1) return t('settings.admin.ai.sheet.next')
  if (step.value === 2) return t('settings.admin.ai.sheet.runTest')
  return saving.value ? t('settings.admin.ai.sheet.saving') : t('settings.admin.ai.sheet.save')
})
const canSubmit = computed(() => {
  if (saving.value) return false
  if (step.value === 1) return presetChosen.value
  if (step.value === 3) return !testing.value
  return true
})

function errorText(field: keyof AiDraftErrors): string | null {
  const error = errors.value[field]
  return error ? t(error.key, error.params ?? {}) : null
}

function reset() {
  testRun += 1
  testResult.value = null
  testing.value = false
  testError.value = null
  saveError.value = null
  errors.value = {}
  showKey.value = false
  pasteUrl.value = ''
  pasteInvalid.value = false
  confirmSaveOpen.value = false
  discardOpen.value = false
  testModel.value = props.slotModel ?? ''
  if (props.connection) {
    draft.value = draftFromConnection(props.connection)
    presetChosen.value = true
    step.value = 2
  } else if (props.prefill) {
    draft.value = { ...(draftFromUrl(props.prefill.baseUrl) ?? draftFromPreset('other')), ...props.prefill }
    presetChosen.value = true
    step.value = 2
  } else if (props.presetId) {
    draft.value = draftFromPreset(props.presetId)
    presetChosen.value = true
    step.value = 2
  } else {
    draft.value = draftFromPreset('other')
    presetChosen.value = false
    step.value = 1
  }
  initial.value = JSON.stringify(draft.value)
}

watch(
  () => [props.open, props.connection?.id] as const,
  ([open]) => {
    if (open) reset()
  },
  { immediate: true },
)

function choosePreset(id: AiPresetId) {
  draft.value = draftFromPreset(id)
  initial.value = JSON.stringify(draft.value)
  presetChosen.value = true
  errors.value = {}
  step.value = 2
}

function usePastedUrl() {
  const detected = draftFromUrl(pasteUrl.value)
  if (!detected || !/^https?:\/\//i.test(pasteUrl.value.trim())) {
    pasteInvalid.value = true
    return
  }
  pasteInvalid.value = false
  draft.value = detected
  initial.value = JSON.stringify(draft.value)
  presetChosen.value = true
  errors.value = {}
  step.value = 2
}

function addHeader() {
  if (draft.value.headers.length >= AI_HEADER_MAX_COUNT) return
  draft.value.headers.push({ name: '', value: '', storedHint: null })
}

function removeHeader(index: number) {
  draft.value.headers.splice(index, 1)
}

function goBack() {
  if (step.value === 3) {
    testRun += 1
    testing.value = false
    step.value = 2
  } else if (step.value === 2 && !editing.value && !props.prefill) {
    step.value = 1
  }
}

const canGoBack = computed(() => step.value === 3 || (step.value === 2 && !editing.value && !props.prefill))

async function runTest() {
  const run = ++testRun
  testing.value = true
  testError.value = null
  testResult.value = null
  try {
    const result = await aiApi.testDraftConnection(testRequest(draft.value, props.connection?.id ?? null, testModel.value.trim() || null))
    if (run !== testRun) return
    testResult.value = result
    if (!testModel.value && result.model) testModel.value = result.model
  } catch (reason) {
    if (run !== testRun) return
    testError.value = errorMessage(reason, 'settings.admin.ai.test.failed')
  } finally {
    if (run === testRun) testing.value = false
  }
}

function handleSubmit() {
  if (!canSubmit.value) return
  if (step.value === 1) {
    step.value = 2
    return
  }
  if (step.value === 2) {
    errors.value = validateDraft(draft.value, keyRequired.value)
    if (Object.keys(errors.value).length > 0) return
    step.value = 3
    void runTest()
    return
  }
  if (testResult.value?.ok) void save()
  else confirmSaveOpen.value = true
}

async function save() {
  confirmSaveOpen.value = false
  saving.value = true
  saveError.value = null
  try {
    const saved = props.connection
      ? await aiApi.updateConnection(props.connection.id, updateRequest(draft.value))
      : await aiApi.createConnection(createRequest(draft.value))
    emit('saved', saved, testResult.value?.ok ?? false)
    emit('update:open', false)
  } catch (reason) {
    saveError.value = errorMessage(reason, 'settings.admin.ai.sheet.saveFailed')
  } finally {
    saving.value = false
  }
}

function requestClose() {
  if (saving.value) return
  if (dirty.value) {
    discardOpen.value = true
    return
  }
  emit('update:open', false)
}

function handleOpenChange(open: boolean) {
  if (!open) requestClose()
}

function confirmDiscard() {
  discardOpen.value = false
  testRun += 1
  emit('update:open', false)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[60] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="ai-connection-dialog"
      >
        <div class="border-b border-border px-5 pb-4 pt-5">
          <p class="text-xs font-medium text-muted-foreground">
            {{ t('settings.admin.ai.sheet.stepOf', { step }) }} ·
            {{
              t(
                step === 1
                  ? 'settings.admin.ai.sheet.steps.provider'
                  : step === 2
                    ? 'settings.admin.ai.sheet.steps.details'
                    : 'settings.admin.ai.sheet.steps.test',
              )
            }}
          </p>
          <DialogTitle class="mt-1 text-lg font-semibold text-foreground">{{ title }}</DialogTitle>
          <DialogDescription class="mt-1 text-sm text-muted-foreground">
            {{
              t(
                step === 1
                  ? 'settings.admin.ai.sheet.descriptions.provider'
                  : step === 2
                    ? 'settings.admin.ai.sheet.descriptions.details'
                    : 'settings.admin.ai.sheet.descriptions.test',
              )
            }}
          </DialogDescription>
        </div>

        <form :id="formId" class="min-h-0 flex-1 overflow-y-auto px-5 py-4" novalidate @submit.prevent="handleSubmit">
          <!-- Step 1: provider -->
          <div v-if="step === 1" class="flex flex-col gap-5">
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                v-for="id in AI_PRESET_IDS"
                :key="id"
                type="button"
                class="flex min-h-16 flex-col items-start justify-center rounded-lg border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="presetChosen && draft.presetId === id ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-muted'"
                :data-preset="id"
                @click="choosePreset(id)"
              >
                <span class="text-sm font-medium text-foreground">{{
                  id === 'other' ? t('settings.admin.ai.presets.other') : AI_PRESETS[id].name
                }}</span>
                <span class="mt-0.5 truncate text-xs text-muted-foreground">
                  {{ id === 'other' ? t('settings.admin.ai.presets.otherBrief') : connectionHost(AI_PRESETS[id].baseUrl) }}
                </span>
              </button>
            </div>

            <SettingsField
              :label="t('settings.admin.ai.sheet.pasteLabel')"
              :input-id="`${formId}-paste`"
              :brief="t('settings.admin.ai.sheet.pasteBrief')"
              :error="pasteInvalid ? t('settings.admin.ai.sheet.errors.urlInvalid') : null"
            >
              <template #default="{ describedBy, invalid }">
                <div class="flex gap-2">
                  <input
                    :id="`${formId}-paste`"
                    v-model="pasteUrl"
                    type="url"
                    class="settings-control font-mono text-[13px]"
                    :placeholder="t('settings.admin.ai.sheet.pastePlaceholder')"
                    :maxlength="AI_URL_MAX_LENGTH"
                    :aria-describedby="describedBy"
                    :aria-invalid="invalid"
                    autocomplete="off"
                    @keydown.enter.prevent="usePastedUrl"
                  />
                  <Button type="button" variant="outline" :disabled="!pasteUrl.trim()" @click="usePastedUrl">
                    {{ t('settings.admin.ai.sheet.pasteUse') }}
                  </Button>
                </div>
              </template>
            </SettingsField>
          </div>

          <!-- Step 2: details -->
          <div v-else-if="step === 2" class="flex flex-col gap-4">
            <SettingsField :label="t('settings.admin.ai.sheet.name')" :input-id="`${formId}-name`" required :error="errorText('name')">
              <template #default="{ describedBy, invalid }">
                <input
                  :id="`${formId}-name`"
                  v-model="draft.name"
                  type="text"
                  class="settings-control"
                  :maxlength="AI_NAME_MAX_LENGTH"
                  :aria-describedby="describedBy"
                  :aria-invalid="invalid"
                  autocomplete="off"
                />
              </template>
            </SettingsField>

            <SettingsField
              :label="t('settings.admin.ai.sheet.baseUrl')"
              :input-id="`${formId}-url`"
              required
              :brief="endpoint ? t('settings.admin.ai.sheet.calls', { url: endpoint }) : undefined"
              :error="errorText('baseUrl')"
            >
              <template #default="{ describedBy, invalid }">
                <input
                  :id="`${formId}-url`"
                  v-model="draft.baseUrl"
                  type="url"
                  class="settings-control font-mono text-[13px]"
                  :maxlength="AI_URL_MAX_LENGTH"
                  :aria-describedby="describedBy"
                  :aria-invalid="invalid"
                  autocomplete="off"
                />
              </template>
            </SettingsField>

            <SettingsField
              :label="t('settings.admin.ai.sheet.apiType')"
              :input-id="`${formId}-type`"
              :brief="t('settings.admin.ai.sheet.apiTypeBrief')"
            >
              <template #default="{ describedBy }">
                <select :id="`${formId}-type`" v-model="draft.apiType" class="settings-control" :aria-describedby="describedBy">
                  <option v-for="apiType in AI_API_TYPES" :key="apiType" :value="apiType">{{ t(`settings.admin.ai.apiTypes.${apiType}`) }}</option>
                </select>
              </template>
            </SettingsField>

            <SettingsField
              :label="preset.keyOptional ? t('settings.admin.ai.sheet.keyOptional') : t('settings.admin.ai.sheet.key')"
              :input-id="`${formId}-key`"
              :required="keyRequired"
              :brief="storedKeyHint !== null ? t('settings.admin.ai.sheet.keyStored', { hint: maskedHint(storedKeyHint) }) : undefined"
              :error="errorText('key')"
            >
              <template #default="{ describedBy, invalid }">
                <p v-if="draft.removeKey" class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="ai-key-removed">
                  {{ t('settings.admin.ai.sheet.keyRemoved') }}
                  <Button type="button" variant="link" size="sm" class="h-auto px-0" @click="draft.removeKey = false">
                    {{ t('settings.admin.ai.sheet.keepKey') }}
                  </Button>
                </p>
                <div v-else class="flex gap-2">
                  <div class="relative min-w-0 flex-1">
                    <input
                      :id="`${formId}-key`"
                      v-model="draft.key"
                      type="text"
                      class="settings-control pe-9 font-mono text-[13px]"
                      :class="{ 'input-secret': !showKey }"
                      :maxlength="AI_KEY_MAX_LENGTH"
                      :placeholder="storedKeyHint !== null ? maskedHint(storedKeyHint) : undefined"
                      :aria-describedby="describedBy"
                      :aria-invalid="invalid"
                      v-bind="SECRET_INPUT_ATTRS"
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-e-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      :aria-label="showKey ? t('settings.admin.ai.sheet.hideKey') : t('settings.admin.ai.sheet.showKey')"
                      :aria-pressed="showKey"
                      @click="showKey = !showKey"
                    >
                      <EyeOff v-if="showKey" class="size-4" />
                      <Eye v-else class="size-4" />
                    </button>
                  </div>
                  <Button v-if="storedKeyHint !== null" type="button" variant="outline" @click="draft.removeKey = true">
                    {{ t('settings.admin.ai.sheet.removeKey') }}
                  </Button>
                </div>
              </template>
            </SettingsField>

            <div
              v-if="preset.warning"
              class="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
              data-testid="ai-preset-warning"
            >
              <AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <p>{{ t(`settings.admin.ai.presets.warnings.${draft.presetId}`) }}</p>
            </div>

            <details class="border-t border-border pt-4" :open="advancedOpen">
              <summary class="settings-label cursor-pointer rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                {{ t('settings.admin.ai.sheet.advanced') }}
              </summary>

              <div class="mt-4 flex flex-col gap-5">
                <fieldset class="flex flex-col gap-2">
                  <legend class="settings-label">{{ t('settings.admin.ai.sheet.headers') }}</legend>
                  <p class="settings-hint mt-0">{{ t('settings.admin.ai.sheet.headersBrief') }}</p>
                  <div v-for="(header, index) in draft.headers" :key="index" class="flex gap-2" data-testid="ai-header-row">
                    <input
                      v-model="header.name"
                      type="text"
                      class="settings-control w-2/5 font-mono text-[13px]"
                      :aria-label="t('settings.admin.ai.sheet.headerName')"
                      :placeholder="t('settings.admin.ai.sheet.headerName')"
                      :readonly="header.storedHint !== null"
                      autocomplete="off"
                    />
                    <input
                      v-model="header.value"
                      type="text"
                      class="settings-control input-secret min-w-0 flex-1 font-mono text-[13px]"
                      :aria-label="t('settings.admin.ai.sheet.headerValue')"
                      :placeholder="header.storedHint !== null ? maskedHint(header.storedHint) : t('settings.admin.ai.sheet.headerValue')"
                      v-bind="SECRET_INPUT_ATTRS"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      :aria-label="t('settings.admin.ai.sheet.removeHeader', { name: header.name || t('settings.admin.ai.sheet.headerName') })"
                      @click="removeHeader(index)"
                    >
                      <X class="size-4" />
                    </Button>
                  </div>
                  <p v-if="errorText('headers')" role="alert" class="text-xs text-destructive">{{ errorText('headers') }}</p>
                  <div>
                    <Button type="button" variant="outline" size="sm" :disabled="draft.headers.length >= AI_HEADER_MAX_COUNT" @click="addHeader">
                      <Plus class="size-3.5" />
                      {{ t('settings.admin.ai.sheet.addHeader') }}
                    </Button>
                  </div>
                </fieldset>

                <div class="grid gap-4 sm:grid-cols-2">
                  <SettingsField
                    :label="t('settings.admin.ai.sheet.proxyUrl')"
                    :input-id="`${formId}-proxy`"
                    :brief="t('settings.admin.ai.sheet.proxyBrief')"
                  >
                    <template #default="{ describedBy }">
                      <input
                        :id="`${formId}-proxy`"
                        v-model="draft.proxyUrl"
                        type="url"
                        class="settings-control font-mono text-[13px]"
                        placeholder="http://proxy.example.com:8080"
                        :aria-describedby="describedBy"
                        autocomplete="off"
                      />
                    </template>
                  </SettingsField>
                  <SettingsField
                    :label="t('settings.admin.ai.sheet.resolvers')"
                    :input-id="`${formId}-resolvers`"
                    :brief="t('settings.admin.ai.sheet.resolversBrief')"
                  >
                    <template #default="{ describedBy }">
                      <ChipInput
                        v-model="draft.resolvers"
                        :input-id="`${formId}-resolvers`"
                        control-class="min-h-9"
                        :described-by="describedBy"
                        placeholder="1.1.1.1"
                      />
                    </template>
                  </SettingsField>
                </div>

                <div class="grid gap-4 sm:grid-cols-3">
                  <SettingsField
                    :label="t('settings.admin.ai.sheet.timeout')"
                    :input-id="`${formId}-timeout`"
                    :brief="
                      t('settings.admin.ai.sheet.secondsRange', {
                        min: AI_CONNECTION_LIMITS.timeoutMs.min / 1000,
                        max: AI_CONNECTION_LIMITS.timeoutMs.max / 1000,
                      })
                    "
                    :error="errorText('timeoutSeconds')"
                  >
                    <template #default="{ describedBy, invalid }">
                      <input
                        :id="`${formId}-timeout`"
                        v-model="draft.timeoutSeconds"
                        type="text"
                        inputmode="numeric"
                        class="settings-control tabular-nums"
                        :aria-describedby="describedBy"
                        :aria-invalid="invalid"
                      />
                    </template>
                  </SettingsField>
                  <SettingsField
                    :label="t('settings.admin.ai.sheet.parallel')"
                    :input-id="`${formId}-parallel`"
                    :brief="
                      t('settings.admin.ai.sheet.range', { min: AI_CONNECTION_LIMITS.maxParallel.min, max: AI_CONNECTION_LIMITS.maxParallel.max })
                    "
                    :error="errorText('maxParallel')"
                  >
                    <template #default="{ describedBy, invalid }">
                      <input
                        :id="`${formId}-parallel`"
                        v-model="draft.maxParallel"
                        type="text"
                        inputmode="numeric"
                        class="settings-control tabular-nums"
                        :aria-describedby="describedBy"
                        :aria-invalid="invalid"
                      />
                    </template>
                  </SettingsField>
                  <SettingsField
                    :label="t('settings.admin.ai.sheet.perMinute')"
                    :input-id="`${formId}-rpm`"
                    :brief="t('settings.admin.ai.sheet.perMinuteBrief')"
                    :error="errorText('requestsPerMinute')"
                  >
                    <template #default="{ describedBy, invalid }">
                      <input
                        :id="`${formId}-rpm`"
                        v-model="draft.requestsPerMinute"
                        type="text"
                        inputmode="numeric"
                        class="settings-control tabular-nums"
                        :aria-describedby="describedBy"
                        :aria-invalid="invalid"
                      />
                    </template>
                  </SettingsField>
                </div>
              </div>
            </details>
          </div>

          <!-- Step 3: test -->
          <div v-else class="flex flex-col gap-5">
            <AiTestChecklist :result="testResult" :running="testing" />
            <p v-if="testError" role="alert" class="settings-error-state">{{ testError }}</p>

            <div class="flex flex-wrap items-end gap-2 border-t border-border pt-4">
              <SettingsField
                class="min-w-48 flex-1"
                :label="modelLabel"
                :input-id="`${formId}-model`"
                :brief="t('settings.admin.ai.sheet.testModelBrief')"
              >
                <template #default="{ describedBy }">
                  <select
                    v-if="listedModels.length > 0"
                    :id="`${formId}-model`"
                    v-model="testModel"
                    class="settings-control font-mono text-[13px]"
                    :aria-describedby="describedBy"
                  >
                    <option v-if="!listedModels.some((model) => model.id === testModel)" :value="testModel">{{ testModel }}</option>
                    <option v-for="model in listedModels" :key="model.id" :value="model.id">{{ model.id }}</option>
                  </select>
                  <input
                    v-else
                    :id="`${formId}-model`"
                    v-model="testModel"
                    type="text"
                    class="settings-control font-mono text-[13px]"
                    :aria-describedby="describedBy"
                    autocomplete="off"
                  />
                </template>
              </SettingsField>
              <Button type="button" variant="outline" class="mb-5" :disabled="testing" @click="runTest">{{
                t('settings.admin.ai.sheet.testAgain')
              }}</Button>
            </div>
          </div>
        </form>

        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button v-if="canGoBack" type="button" variant="ghost" class="me-auto" :disabled="busy" @click="goBack">
            {{ t('settings.admin.ai.sheet.back') }}
          </Button>
          <p v-if="saveError" class="me-auto min-w-0 text-sm text-destructive" role="alert">{{ saveError }}</p>
          <Button type="button" variant="outline" :disabled="busy" @click="requestClose">{{ t('common.cancel') }}</Button>
          <Button v-if="step !== 1" type="submit" :form="formId" :disabled="!canSubmit" data-testid="ai-connection-submit">{{ submitLabel }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <ConfirmDialog
    v-if="confirmSaveOpen"
    :open="confirmSaveOpen"
    :title="t('settings.admin.ai.sheet.saveWithFailureTitle')"
    :description="t('settings.admin.ai.sheet.saveWithFailureBody')"
    :confirm-label="t('settings.admin.ai.sheet.saveAnyway')"
    :destructive="false"
    @confirm="save"
    @cancel="confirmSaveOpen = false"
  />

  <ConfirmDialog
    v-if="discardOpen"
    :open="discardOpen"
    :title="t('components.formSheet.discardTitle')"
    :description="t('components.formSheet.discardDescription')"
    :confirm-label="t('components.formSheet.discardConfirm')"
    @confirm="confirmDiscard"
    @cancel="discardOpen = false"
  />
</template>
