<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Aperture, FileUp, Loader2 } from '@lucide/vue'
import { parseCustomSortFieldId, type SortSpec } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import { Button } from '@/components/ui/button'
import { sortFieldLabel } from '@/features/book/lib/filter-labels'
import { ApiError } from '@/lib/api-json'
import { useSmartScopeImport } from '../composables/useSmartScopeTransfer'
import {
  MAX_TEMPLATE_BYTES,
  ScopeTransferError,
  parseScopeTemplate,
  type ReferenceOption,
  type ScopeReference,
  type ScopeTemplate,
} from '../lib/smart-scope-transfer'
import SmartScopeTemplateRules from './SmartScopeTemplateRules.vue'
import SmartScopeTransferDialog from './SmartScopeTransferDialog.vue'

defineProps<{ returnFocusTo?: HTMLElement }>()
const emit = defineEmits<{ close: []; imported: [id: number] }>()
const { t } = useI18n()
const { loadMappings, importScope } = useSmartScopeImport()
const id = useId()
const source = ref('')
const sourceInput = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const name = ref('')
const template = shallowRef<ScopeTemplate | null>(null)
const rows = shallowRef<Awaited<ReturnType<typeof loadMappings>>>([])
const mappings = ref<Record<string, string>>({})
const reading = ref(false)
const saving = ref(false)
const error = ref('')
const unmapped = computed(() => rows.value.filter(({ reference }) => !mappings.value[reference.key]).length)

function close() {
  if (!saving.value) emit('close')
}

function resetError() {
  error.value = ''
}

function chooseFile() {
  fileInput.value?.click()
}

async function review(text: string) {
  try {
    const decoded = parseScopeTemplate(text)
    const nextRows = await loadMappings(decoded)
    rows.value = nextRows
    mappings.value = Object.fromEntries(nextRows.map(({ reference, suggestion }) => [reference.key, suggestion]))
    name.value = decoded.name
    template.value = decoded
    await nextTick()
    nameInput.value?.focus()
  } catch (cause) {
    error.value = cause instanceof ScopeTransferError ? cause.code : 'catalogFailed'
  }
}

async function reviewText() {
  if (reading.value || !source.value.trim()) return
  reading.value = true
  resetError()
  try {
    await review(source.value)
  } finally {
    reading.value = false
  }
}

async function readFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || reading.value) return
  if (file.size > MAX_TEMPLATE_BYTES) {
    error.value = 'tooLarge'
    return
  }
  reading.value = true
  resetError()
  try {
    source.value = (await file.text()).replace(/^\uFEFF/, '')
    await review(source.value)
  } catch {
    error.value = 'readFailed'
  } finally {
    reading.value = false
  }
}

async function back() {
  template.value = null
  resetError()
  await nextTick()
  sourceInput.value?.focus()
}

function optionLabel(reference: ScopeReference, option: ReferenceOption) {
  if (option.count <= 1) return option.label
  if (reference.kind === 'collection') return t('smartScope.transfer.collectionOption', { name: option.label, count: option.count })
  if (reference.kind === 'customField')
    return t('smartScope.transfer.customFieldOption', { name: option.label, id: parseCustomSortFieldId(option.value) })
  return option.label
}

function describeSort(spec: SortSpec) {
  const id = parseCustomSortFieldId(spec.field)
  const field = id === null ? sortFieldLabel(spec.field) : template.value?.customFields[id - 1]?.label
  const direction = t(spec.dir === 'asc' ? 'components.entityIndex.ascending' : 'components.entityIndex.descending')
  return t('smartScope.transfer.sortSpec', { field, direction })
}

async function save() {
  if (!template.value || !name.value.trim() || unmapped.value || saving.value) return
  saving.value = true
  resetError()
  let scopeId: number
  try {
    const scope = await importScope(template.value, name.value, mappings.value)
    scopeId = scope.id
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.status === 400 ? 'validationFailed' : 'importFailed'
    return
  } finally {
    saving.value = false
  }
  emit('imported', scopeId)
}
</script>

<template>
  <SmartScopeTransferDialog
    :title="t('smartScope.transfer.importTitle')"
    :description="t(template ? 'smartScope.transfer.reviewDescription' : 'smartScope.transfer.importDescription')"
    :busy="saving"
    :return-focus-to="returnFocusTo"
    @close="close"
  >
    <div v-if="!template" class="space-y-3">
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="readFile" />
      <Button type="button" variant="outline" :disabled="reading" @click="chooseFile">
        <FileUp aria-hidden="true" />
        {{ t('smartScope.transfer.chooseFile') }}
      </Button>

      <div>
        <label :for="`${id}-source`" class="mb-1.5 block text-sm font-medium text-foreground">{{ t('smartScope.transfer.pasteLabel') }}</label>
        <textarea
          :id="`${id}-source`"
          ref="sourceInput"
          v-model="source"
          :disabled="reading"
          dir="ltr"
          rows="14"
          spellcheck="false"
          class="block h-[min(43svh,24rem)] min-h-44 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-base leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          @input="resetError"
        />
      </div>
      <p v-if="reading" role="status" class="text-sm text-muted-foreground">{{ t('smartScope.transfer.preparing') }}</p>
    </div>
    <form v-else :id="`${id}-import`" class="space-y-4" @submit.prevent="save">
      <fieldset :disabled="saving" class="min-w-0 space-y-4">
        <div>
          <label :for="`${id}-name`" class="mb-1.5 block text-sm font-medium text-foreground">{{ t('smartScope.dialog.name') }}</label>
          <div class="flex items-center gap-2">
            <span class="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <AppIcon :icon="template.icon" :fallback="Aperture" :size="18" />
            </span>
            <input
              :id="`${id}-name`"
              ref="nameInput"
              v-model="name"
              type="text"
              maxlength="255"
              required
              class="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <fieldset v-if="rows.length" class="min-w-0 space-y-3 rounded-md border border-border p-3">
          <legend class="px-1 text-sm font-medium text-foreground">{{ t('smartScope.transfer.mappingTitle') }}</legend>
          <p class="text-sm text-muted-foreground">{{ t('smartScope.transfer.mappingHint') }}</p>
          <div v-for="({ reference, options }, index) in rows" :key="reference.key" class="space-y-1">
            <label :for="`${id}-mapping-${index}`" class="block text-sm text-foreground [overflow-wrap:anywhere]">
              {{ t(`smartScope.transfer.reference.${reference.kind}`, { name: reference.label }) }}
              <span v-if="reference.kind === 'customField'" class="text-muted-foreground">
                ({{ t(`settings.metadata.customFields.types.${reference.type}.label`) }})
              </span>
            </label>
            <select
              :id="`${id}-mapping-${index}`"
              v-model="mappings[reference.key]"
              :disabled="options.length === 0"
              required
              class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>{{ t(options.length ? 'smartScope.transfer.chooseMapping' : 'smartScope.transfer.noOptions') }}</option>
              <option v-for="option in options" :key="option.value" :value="option.value">{{ optionLabel(reference, option) }}</option>
            </select>
          </div>
          <p v-if="unmapped" role="status" class="text-sm text-muted-foreground">{{ t('smartScope.transfer.unmapped') }}</p>
        </fieldset>
      </fieldset>

      <details class="rounded-md border border-border px-3 py-2">
        <summary
          class="cursor-pointer rounded-sm text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {{ t('smartScope.transfer.sharedRules') }}
        </summary>
        <div class="mt-3 space-y-3">
          <SmartScopeTemplateRules v-if="template.filter" :group="template.filter" :custom-fields="template.customFields" />
          <p v-else class="text-sm text-muted-foreground">{{ t('smartScope.transfer.emptyRules') }}</p>
          <div v-if="template.defaultSort.length">
            <p class="text-sm font-medium text-foreground">{{ t('smartScope.editorPanel.defaultSort') }}</p>
            <ol class="mt-1 list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
              <li v-for="(spec, index) in template.defaultSort" :key="index" class="[overflow-wrap:anywhere]">{{ describeSort(spec) }}</li>
            </ol>
          </div>
        </div>
      </details>
      <p class="text-sm text-muted-foreground">{{ t('smartScope.transfer.privateCopy') }}</p>
    </form>

    <p v-if="error" role="alert" class="mt-3 text-sm text-destructive">{{ t(`smartScope.transfer.${error}`) }}</p>

    <template #actions>
      <template v-if="template">
        <Button type="button" variant="outline" :disabled="saving" @click="back">{{ t('common.back') }}</Button>
        <Button type="submit" :form="`${id}-import`" :disabled="!name.trim() || unmapped > 0 || saving">
          <Loader2 v-if="saving" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t(saving ? 'smartScope.transfer.importing' : 'smartScope.transfer.importCopy') }}
        </Button>
      </template>
      <template v-else>
        <Button type="button" variant="outline" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="button" :disabled="!source.trim() || reading" @click="reviewText">{{ t('smartScope.transfer.review') }}</Button>
      </template>
    </template>
  </SmartScopeTransferDialog>
</template>
