<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, ArchiveRestore, Loader2, Lock, MoreHorizontal, Trash2 } from '@lucide/vue'
import type { CustomMetadataFieldDefinition, CustomMetadataFieldType, Library } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDate, formatNumber, formatRelativeTimeFromNow } from '@/i18n/formatters'
import SettingsEditorSheet from '@/features/settings/components/SettingsEditorSheet.vue'
import type { EditorMenuAction } from '@/features/settings/lib/editor-actions'
import { fieldCoverage, previewFieldKey, sameLibraries } from '../lib/custom-field-coverage'
import { typeHintKey, typeLabelKey } from '../lib/custom-field-types'
import CustomFieldAppearance from './CustomFieldAppearance.vue'
import CustomFieldLibraryChecklist from './CustomFieldLibraryChecklist.vue'
import CustomFieldLibrarySummary from './CustomFieldLibrarySummary.vue'
import CustomFieldTypeChip from './CustomFieldTypeChip.vue'
import CustomFieldTypePicker from './CustomFieldTypePicker.vue'
import CustomFieldTypeTile from './CustomFieldTypeTile.vue'

export type CustomFieldSheetMode = 'create' | 'edit' | 'archived'
export type CustomFieldDraft = { label: string; type: CustomMetadataFieldType; enabledLibraryIds: number[] }

const props = defineProps<{
  open: boolean
  mode: CustomFieldSheetMode
  field: CustomMetadataFieldDefinition | null
  /** Every field, archived included: labels must be unique among active ones and keys among all. */
  fields: CustomMetadataFieldDefinition[]
  libraries: Library[]
  /** Prefills a new field, from an empty-state example. */
  starter?: { label: string; type: CustomMetadataFieldType } | null
  /** Opens an archived field straight at the delete question. */
  confirmDelete?: boolean
  busy?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
}>()

const emit = defineEmits<{
  close: []
  create: [draft: CustomFieldDraft]
  save: [field: CustomMetadataFieldDefinition, draft: Pick<CustomFieldDraft, 'label' | 'enabledLibraryIds'>]
  archive: [field: CustomMetadataFieldDefinition]
  restore: [field: CustomMetadataFieldDefinition]
  delete: [field: CustomMetadataFieldDefinition]
  move: [field: CustomMetadataFieldDefinition, step: -1 | 1]
}>()

const { t } = useI18n()

const label = ref('')
const type = ref<CustomMetadataFieldType>('text')
const libraryIds = ref<number[]>([])
const deleting = ref(false)
const typedName = ref('')
const labelInput = ref<HTMLInputElement | null>(null)

function reset() {
  deleting.value = props.mode === 'archived' && !!props.confirmDelete
  typedName.value = ''
  if (props.mode === 'create') {
    label.value = props.starter?.label ?? ''
    type.value = props.starter?.type ?? 'text'
    // A field on no library shows up nowhere, so a new one starts everywhere.
    libraryIds.value = props.libraries.map((library) => library.id)
    void nextTick(() => labelInput.value?.focus())
    return
  }
  label.value = props.field?.label ?? ''
  type.value = props.field?.type ?? 'text'
  libraryIds.value = [...(props.field?.enabledLibraryIds ?? [])]
}

watch(
  () => [props.open, props.mode, props.field?.id] as const,
  ([open]) => {
    if (open) reset()
  },
  { immediate: true },
)

const trimmed = computed(() => label.value.trim())
const labelError = computed(() => {
  if (!trimmed.value) return null
  if (trimmed.value.length > 255) return t('settings.metadata.customFields.labelTooLong')
  const lower = trimmed.value.toLowerCase()
  const clash = props.fields.some((other) => !other.archivedAt && other.id !== props.field?.id && other.label.toLowerCase() === lower)
  return clash ? t('settings.metadata.customFields.labelDuplicate') : null
})

const dirty = computed(() => {
  if (props.mode === 'create') return trimmed.value.length > 0
  if (props.mode !== 'edit' || !props.field) return false
  return trimmed.value !== props.field.label || !sameLibraries(libraryIds.value, props.field.enabledLibraryIds)
})

const fieldKey = computed(() =>
  props.mode === 'create'
    ? previewFieldKey(
        trimmed.value,
        props.fields.map((field) => field.key),
      )
    : (props.field?.key ?? ''),
)

const coverage = computed(() => (props.field ? fieldCoverage(props.field, props.libraries) : null))

const title = computed(() => (props.mode === 'create' ? t('settings.metadata.customFields.sheet.newTitle') : (props.field?.label ?? '')))
const description = computed(() => {
  if (props.mode === 'create') return t('settings.metadata.customFields.sheet.newDescription')
  if (props.mode === 'archived') return t('settings.metadata.customFields.sheet.archivedDescription')
  return t('settings.metadata.customFields.sheet.editDescription')
})

const statusLine = computed(() => {
  const field = props.field
  const cov = coverage.value
  if (!field || !cov) return ''
  const parts = [
    cov.none
      ? t('settings.metadata.customFields.sheet.statusNone')
      : t('settings.metadata.customFields.sheet.statusFilled', { filled: formatNumber(cov.filled), total: cov.books }),
  ]
  if (cov.hidden > 0) parts.push(t('settings.metadata.customFields.sheet.statusHidden', { count: formatNumber(cov.hidden) }))
  parts.push(t('settings.metadata.customFields.sheet.statusCreated', { date: formatDate(new Date(field.createdAt), { dateStyle: 'medium' }) }))
  return parts.join(' · ')
})

const menuActions = computed<EditorMenuAction[]>(() => {
  if (props.mode !== 'edit' || !props.field) return []
  return [
    { id: 'move-up', label: t('settings.metadata.customFields.rowActions.moveUp'), disabled: !props.canMoveUp },
    { id: 'move-down', label: t('settings.metadata.customFields.rowActions.moveDown'), disabled: !props.canMoveDown },
    {
      id: 'archive',
      label: t('settings.metadata.customFields.sheet.archiveAction'),
      separated: true,
      confirm: t('settings.metadata.customFields.sheet.archiveConfirm', { label: props.field.label }),
      consequence: t('settings.metadata.customFields.sheet.archiveConsequence', { count: props.field.usageCount }),
    },
  ]
})

const canDelete = computed(() => !!props.field && (props.field.usageCount === 0 || typedName.value === props.field.label))
const libraryCountLine = computed(() =>
  libraryIds.value.length === props.libraries.length
    ? t('settings.metadata.customFields.sheet.onAllLibraries', { total: props.libraries.length })
    : t('settings.metadata.customFields.sheet.onLibraries', { count: libraryIds.value.length, total: props.libraries.length }),
)

function handleClose() {
  emit('close')
}

function handleSave() {
  if (props.mode !== 'edit' || !props.field) return
  if (!dirty.value) {
    emit('close')
    return
  }
  if (!trimmed.value || labelError.value) return
  emit('save', props.field, { label: trimmed.value, enabledLibraryIds: [...libraryIds.value] })
}

function handleCreate() {
  if (!trimmed.value || labelError.value) {
    labelInput.value?.focus()
    return
  }
  emit('create', { label: trimmed.value, type: type.value, enabledLibraryIds: [...libraryIds.value] })
}

function handleAction(id: string) {
  if (!props.field) return
  if (id === 'archive') emit('archive', props.field)
  else if (id === 'move-up') emit('move', props.field, -1)
  else if (id === 'move-down') emit('move', props.field, 1)
}

function handleRestore() {
  if (props.field) emit('restore', props.field)
}

function askDelete() {
  deleting.value = true
}

function cancelDelete() {
  deleting.value = false
  typedName.value = ''
}

function handleDelete() {
  if (props.field && canDelete.value) emit('delete', props.field)
}

function handleLabelEnter() {
  if (props.mode === 'create') handleCreate()
  else handleSave()
}
</script>

<template>
  <SettingsEditorSheet
    :open="open"
    :title="title"
    :description="description"
    :dirty="dirty"
    :busy="busy"
    :menu-actions="menuActions"
    @save="handleSave"
    @cancel="handleClose"
    @action="handleAction"
  >
    <template #badge>
      <span
        v-if="mode === 'archived'"
        class="inline-flex h-5 items-center rounded-full bg-foreground/8 px-2 text-[11px] font-semibold text-muted-foreground"
      >
        {{ t('settings.metadata.customFields.sheet.archivedBadge') }}
      </span>
    </template>
    <template #status>
      <p v-if="mode === 'edit' && statusLine" class="text-xs tabular-nums text-muted-foreground">{{ statusLine }}</p>
    </template>

    <template v-if="mode !== 'archived'">
      <label class="block space-y-1.5">
        <span class="settings-label">{{ t('settings.metadata.customFields.label') }}</span>
        <input
          ref="labelInput"
          v-model="label"
          class="input-field w-full"
          :class="labelError ? 'border-destructive' : ''"
          :placeholder="t('settings.metadata.customFields.labelPlaceholder')"
          :aria-invalid="!!labelError"
          maxlength="300"
          @keydown.enter.prevent="handleLabelEnter"
        />
        <span v-if="labelError" class="block text-xs text-destructive" role="alert">{{ labelError }}</span>
        <i18n-t
          v-if="mode === 'edit'"
          keypath="settings.metadata.customFields.sheet.renameHint"
          tag="span"
          scope="global"
          class="settings-hint block"
        >
          <template #key>
            <code class="rounded-[5px] border border-foreground/9 bg-foreground/6 px-1 font-mono text-[11.5px] text-foreground">{{ fieldKey }}</code>
          </template>
        </i18n-t>
        <i18n-t v-else-if="trimmed" keypath="settings.metadata.customFields.sheet.keyHint" tag="span" scope="global" class="settings-hint block">
          <template #key>
            <code class="rounded-[5px] border border-foreground/9 bg-foreground/6 px-1 font-mono text-[11.5px] text-foreground">{{ fieldKey }}</code>
          </template>
        </i18n-t>
        <span v-else class="settings-hint block">{{ t('settings.metadata.customFields.sheet.labelHint') }}</span>
      </label>

      <CustomFieldTypePicker v-if="mode === 'create'" v-model="type" name="custom-field-type" />
      <div v-else-if="field" class="space-y-1.5">
        <span class="settings-label">{{ t('settings.metadata.customFields.type') }}</span>
        <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <CustomFieldTypeTile :type="field.type" :size="30" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground">{{ t(typeLabelKey(field.type)) }}</p>
            <p class="text-xs text-muted-foreground">{{ t(typeHintKey(field.type)) }}</p>
          </div>
          <span
            class="ms-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
            :title="t('settings.metadata.customFields.sheet.typeLockedHint')"
          >
            <Lock :size="12" aria-hidden="true" />
            {{ t('settings.metadata.customFields.sheet.typeLocked') }}
          </span>
        </div>
      </div>

      <CustomFieldLibraryChecklist v-model="libraryIds" :libraries="libraries" :field="mode === 'edit' ? field : null" />

      <CustomFieldAppearance :type="type" :label="trimmed" :field-key="fieldKey" :library-ids="libraryIds" :libraries="libraries" />
    </template>

    <template v-else-if="field">
      <div class="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 shadow-xs">
        <Archive :size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <p class="text-xs leading-relaxed text-muted-foreground">
          <span class="font-medium text-foreground">{{
            t('settings.metadata.customFields.sheet.archivedTitle', { when: field.archivedAt ? formatRelativeTimeFromNow(field.archivedAt) : '' })
          }}</span>
          {{ ' ' }}{{ t('settings.metadata.customFields.sheet.archivedBody', { count: field.usageCount }) }}
        </p>
      </div>
      <dl class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-sm">
        <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.facts.type') }}</dt>
          <dd><CustomFieldTypeChip :type="field.type" size="sm" /></dd>
        </div>
        <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.facts.libraries') }}</dt>
          <dd class="min-w-0 overflow-hidden">
            <CustomFieldLibrarySummary :library-ids="field.enabledLibraryIds" :libraries="libraries" :max="3" />
          </dd>
        </div>
        <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.facts.valuesKept') }}</dt>
          <dd class="tabular-nums text-foreground">
            {{ field.usageCount ? formatNumber(field.usageCount) : t('settings.metadata.customFields.noValues') }}
          </dd>
        </div>
        <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.facts.fileKey') }}</dt>
          <dd class="min-w-0">
            <code class="rounded-[5px] border border-foreground/9 bg-foreground/6 px-1.5 py-px font-mono text-xs break-all text-foreground"
              >bookorbit:custom:{{ field.key }}</code
            >
          </dd>
        </div>
        <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.facts.created') }}</dt>
          <dd class="text-foreground">{{ formatDate(new Date(field.createdAt), { dateStyle: 'medium' }) }}</dd>
        </div>
        <div v-if="field.archivedAt" class="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
          <dt class="text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.facts.archived') }}</dt>
          <dd class="text-foreground">{{ formatDate(new Date(field.archivedAt), { dateStyle: 'medium' }) }}</dd>
        </div>
      </dl>
    </template>

    <template v-if="mode === 'create'" #footer="{ requestClose }">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <Button size="sm" type="button" :disabled="busy || !trimmed || !!labelError" @click="handleCreate">
            <Loader2 v-if="busy" class="animate-spin" aria-hidden="true" />
            {{ t('settings.metadata.customFields.sheet.create') }}
          </Button>
          <Button size="sm" variant="outline" type="button" :disabled="busy" @click="requestClose">{{ t('common.cancel') }}</Button>
        </div>
        <span class="ms-auto text-xs text-muted-foreground">{{ libraryCountLine }}</span>
      </div>
    </template>

    <template v-else-if="mode === 'archived' && field" #footer="{ requestClose }">
      <div v-if="deleting" class="space-y-3">
        <p role="alert" class="text-xs">
          <span class="text-foreground">{{ t('settings.metadata.customFields.sheet.deleteQuestion', { label: field.label }) }}</span>
          <span class="ms-1 text-muted-foreground">{{
            t('settings.metadata.customFields.sheet.deleteConsequence', { count: field.usageCount })
          }}</span>
        </p>
        <label v-if="field.usageCount > 0" class="block">
          <span class="sr-only">{{ t('settings.metadata.customFields.sheet.deleteConfirmLabel') }}</span>
          <input
            v-model="typedName"
            class="input-field w-full"
            :placeholder="t('settings.metadata.customFields.sheet.deleteConfirmPlaceholder', { label: field.label })"
            @keydown.enter.prevent="handleDelete"
          />
        </label>
        <div class="flex items-center justify-end gap-2">
          <Button size="sm" variant="destructive" type="button" :disabled="busy || !canDelete" @click="handleDelete">
            <Loader2 v-if="busy" class="animate-spin" aria-hidden="true" />
            <Trash2 v-else :size="14" aria-hidden="true" />
            {{ t('settings.metadata.customFields.deleteForever') }}
          </Button>
          <Button size="sm" variant="outline" type="button" :disabled="busy" @click="cancelDelete">{{ t('common.cancel') }}</Button>
        </div>
      </div>
      <div v-else class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <Button size="sm" type="button" :disabled="busy" @click="handleRestore">
            <Loader2 v-if="busy" class="animate-spin" aria-hidden="true" />
            <ArchiveRestore v-else :size="14" aria-hidden="true" />
            {{ t('settings.metadata.customFields.restore') }}
          </Button>
          <Button size="sm" variant="outline" type="button" :disabled="busy" @click="requestClose">{{ t('common.close') }}</Button>
        </div>
        <div class="ms-auto">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button size="icon-sm" variant="outline" type="button" :disabled="busy" :aria-label="t('settings.editor.moreActions')">
                <MoreHorizontal :size="16" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuItem variant="destructive" @click="askDelete">
                <Trash2 aria-hidden="true" />
                {{ t('settings.metadata.customFields.rowActions.deletePermanently') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </template>
  </SettingsEditorSheet>
</template>
