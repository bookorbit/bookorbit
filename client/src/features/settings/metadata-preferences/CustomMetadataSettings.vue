<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, ArchiveRestore, ChevronDown, GripVertical, LayoutList, Loader2, Plus, Save, Search, Trash2 } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { CustomMetadataFieldDefinition, CustomMetadataFieldType } from '@bookorbit/types'
import { CUSTOM_METADATA_FIELD_TYPES } from '@bookorbit/types'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useCustomMetadataFields } from './composables/useCustomMetadataFields'
import { CUSTOM_FIELD_TYPE_META, formatAbsoluteDateTime, formatRelativeTime } from './lib/custom-field-types'
import CustomFieldPreviewInput from './components/CustomFieldPreviewInput.vue'
import LibraryToggleGroup from './components/LibraryToggleGroup.vue'

type Draft = {
  label: string
  enabledLibraryIds: number[]
}

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()
const {
  loading,
  creating,
  savingId,
  archivingId,
  restoringId,
  deletingPermanentlyId,
  reordering,
  activeFields,
  archivedFields,
  loadFields,
  createField,
  saveField,
  archiveField,
  restoreField,
  deleteFieldPermanently,
  reorderFields,
} = useCustomMetadataFields()

const drafts = reactive<Record<number, Draft>>({})
const createOpen = ref(false)
const createForm = reactive({
  label: '',
  type: 'text' as CustomMetadataFieldType,
  enabledLibraryIds: [] as number[],
})
const searchQuery = ref('')
const showArchived = ref(false)
const showCreatePreview = ref(false)
const deleteConfirmField = ref<CustomMetadataFieldDefinition | null>(null)
const deleteConfirmInput = ref('')

const orderableFields = ref<CustomMetadataFieldDefinition[]>([])
watch(activeFields, (value) => (orderableFields.value = [...value]), { immediate: true })

const normalizedQuery = computed(() => searchQuery.value.trim().toLowerCase())
const isSearching = computed(() => normalizedQuery.value.length > 0)
const visibleFieldCount = computed(() => orderableFields.value.filter(matchesSearch).length)

const createLabelError = computed(() => labelError(createForm.label))
const canCreate = computed(() => createForm.label.trim().length > 0 && !createLabelError.value && !creating.value)
const canConfirmDelete = computed(() => deleteConfirmInput.value === deleteConfirmField.value?.label && deletingPermanentlyId.value === null)

function labelError(label: string, excludeId?: number): string | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  if (trimmed.length > 255) return t('settings.metadata.customFields.labelTooLong')
  const duplicate = activeFields.value.some((field) => field.id !== excludeId && field.label.toLowerCase() === trimmed.toLowerCase())
  if (duplicate) return t('settings.metadata.customFields.labelDuplicate')
  return null
}

function matchesSearch(field: CustomMetadataFieldDefinition): boolean {
  if (!normalizedQuery.value) return true
  const query = normalizedQuery.value
  return (
    field.label.toLowerCase().includes(query) ||
    field.key.toLowerCase().includes(query) ||
    CUSTOM_FIELD_TYPE_META[field.type].label.toLowerCase().includes(query)
  )
}

function draftFor(field: CustomMetadataFieldDefinition): Draft {
  drafts[field.id] ??= { label: field.label, enabledLibraryIds: [...field.enabledLibraryIds] }
  return drafts[field.id]!
}

function setDraftLibraries(field: CustomMetadataFieldDefinition, libraryIds: number[]) {
  draftFor(field).enabledLibraryIds = libraryIds
}

function draftLabelError(field: CustomMetadataFieldDefinition): string | null {
  return labelError(draftFor(field).label, field.id)
}

function isDirty(field: CustomMetadataFieldDefinition): boolean {
  const draft = draftFor(field)
  if (draft.label.trim() !== field.label) return true
  const current = [...draft.enabledLibraryIds].sort((a, b) => a - b)
  const saved = [...field.enabledLibraryIds].sort((a, b) => a - b)
  return current.length !== saved.length || current.some((id, index) => id !== saved[index])
}

function canSave(field: CustomMetadataFieldDefinition): boolean {
  return isDirty(field) && !draftLabelError(field) && draftFor(field).label.trim().length > 0 && savingId.value !== field.id
}

function usageLabel(field: CustomMetadataFieldDefinition): string {
  return t('settings.metadata.customFields.usage', { count: field.usageCount }, field.usageCount)
}

function toggleCreate() {
  createOpen.value = !createOpen.value
}

function toggleArchived() {
  showArchived.value = !showArchived.value
}

function toggleCreatePreview() {
  showCreatePreview.value = !showCreatePreview.value
}

async function handleCreate() {
  if (!canCreate.value) return
  const created = await createField({
    label: createForm.label.trim(),
    type: createForm.type,
    enabledLibraryIds: createForm.enabledLibraryIds,
  })
  if (created) {
    drafts[created.id] = { label: created.label, enabledLibraryIds: [...created.enabledLibraryIds] }
    createForm.label = ''
    createForm.type = 'text'
    createForm.enabledLibraryIds = []
  }
}

async function handleSave(field: CustomMetadataFieldDefinition) {
  if (!canSave(field)) return
  const draft = draftFor(field)
  const updated = await saveField(field.id, { label: draft.label.trim(), enabledLibraryIds: draft.enabledLibraryIds })
  if (updated) drafts[updated.id] = { label: updated.label, enabledLibraryIds: [...updated.enabledLibraryIds] }
}

async function handleArchive(field: CustomMetadataFieldDefinition) {
  const archived = await archiveField(field.id)
  if (archived) delete drafts[field.id]
}

async function handleRestore(field: CustomMetadataFieldDefinition) {
  const restored = await restoreField(field.id)
  if (restored) drafts[restored.id] = { label: restored.label, enabledLibraryIds: [...restored.enabledLibraryIds] }
}

async function handleReorder() {
  await reorderFields(orderableFields.value.map((field) => field.id))
}

function openDeleteConfirm(field: CustomMetadataFieldDefinition) {
  deleteConfirmField.value = field
  deleteConfirmInput.value = ''
}

function cancelDeleteConfirm() {
  deleteConfirmField.value = null
  deleteConfirmInput.value = ''
}

async function confirmDeletePermanently() {
  if (!canConfirmDelete.value || !deleteConfirmField.value) return
  const deleted = await deleteFieldPermanently(deleteConfirmField.value.id)
  if (deleted) {
    delete drafts[deleteConfirmField.value.id]
    cancelDeleteConfirm()
  }
}

onMounted(() => {
  void Promise.all([fetchLibraries(), loadFields()])
})
</script>

<template>
  <div class="space-y-5">
    <section class="rounded-lg border border-border bg-card overflow-hidden shadow-xs">
      <button
        type="button"
        class="w-full px-4 py-3.5 md:px-5 md:py-4 flex items-center justify-between gap-3 bg-muted/30 hover:bg-muted/50 transition-colors"
        @click="toggleCreate"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Plus :size="15" />
          </div>
          <div class="text-left">
            <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{
              t('settings.metadata.customFields.newField.title')
            }}</span>
            <p class="settings-hint">{{ t('settings.metadata.customFields.newField.hint') }}</p>
          </div>
        </div>
        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform" :class="createOpen ? 'rotate-180' : ''" />
      </button>

      <div v-if="createOpen" class="p-4 md:p-5 space-y-4 border-t border-border">
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
          <label class="space-y-1.5">
            <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.customFields.label') }}</span>
            <input
              v-model="createForm.label"
              class="input-field w-full"
              :placeholder="t('settings.metadata.customFields.labelPlaceholder')"
              :aria-invalid="!!createLabelError"
              @keydown.enter="handleCreate"
            />
            <span v-if="createLabelError" class="text-xs text-destructive">{{ createLabelError }}</span>
          </label>
          <label class="space-y-1.5">
            <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.customFields.type') }}</span>
            <select v-model="createForm.type" class="select-field w-full">
              <option v-for="type in CUSTOM_METADATA_FIELD_TYPES" :key="type" :value="type">{{ CUSTOM_FIELD_TYPE_META[type].label }}</option>
            </select>
            <span class="text-xs text-muted-foreground">{{ CUSTOM_FIELD_TYPE_META[createForm.type].example }}</span>
          </label>
        </div>

        <LibraryToggleGroup v-model="createForm.enabledLibraryIds" :libraries="libraries" />

        <div class="rounded-md border border-dashed border-border bg-muted/20 p-3">
          <button
            type="button"
            class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            @click="toggleCreatePreview"
          >
            <ChevronDown class="h-3.5 w-3.5 transition-transform" :class="showCreatePreview ? 'rotate-180' : ''" />
            {{ t('settings.metadata.customFields.previewToggle') }}
          </button>
          <div v-if="showCreatePreview" class="mt-3 max-w-xs">
            <span class="text-xs font-medium text-muted-foreground">{{
              createForm.label.trim() || t('settings.metadata.customFields.untitledField')
            }}</span>
            <CustomFieldPreviewInput class="mt-1" :type="createForm.type" />
          </div>
        </div>

        <div class="flex justify-end">
          <button class="settings-btn-primary" :disabled="!canCreate" @click="handleCreate">
            <Loader2 v-if="creating" :size="14" class="animate-spin" />
            <Plus v-else :size="14" />
            {{ t('settings.metadata.customFields.addField') }}
          </button>
        </div>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card overflow-hidden shadow-xs">
      <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex flex-col gap-3 bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <LayoutList :size="15" />
          </div>
          <div>
            <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.customFields.fields') }}</span>
            <p class="settings-hint">{{ t('settings.metadata.customFields.fieldsHint') }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div v-if="activeFields.length > 0" class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              v-model="searchQuery"
              type="search"
              :placeholder="t('settings.metadata.customFields.searchPlaceholder')"
              class="input-field w-full pl-8 sm:w-48"
              :aria-label="t('settings.metadata.customFields.searchAriaLabel')"
            />
          </div>
          <Loader2 v-if="loading || reordering" :size="15" class="animate-spin text-muted-foreground shrink-0" />
        </div>
      </div>

      <div v-if="activeFields.length === 0 && !loading" class="mx-4 my-5 rounded-lg border border-dashed border-border px-4 py-10 text-center">
        <p class="text-sm font-medium text-foreground">{{ t('settings.metadata.customFields.emptyTitle') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.emptyHint') }}</p>
      </div>

      <div v-else-if="isSearching && visibleFieldCount === 0" class="mx-4 my-5 rounded-lg border border-dashed border-border px-4 py-10 text-center">
        <p class="text-sm font-medium text-foreground">{{ t('settings.metadata.customFields.noMatchTitle', { query: searchQuery.trim() }) }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.noMatchHint') }}</p>
      </div>

      <VueDraggable
        v-else
        v-model="orderableFields"
        tag="div"
        class="divide-y divide-border"
        :animation="150"
        handle=".custom-field-handle"
        ghost-class="opacity-40"
        :disabled="reordering || isSearching"
        @end="handleReorder"
      >
        <div v-for="field in orderableFields" v-show="matchesSearch(field)" :key="field.id" class="px-4 py-4 md:px-5 space-y-3">
          <div class="flex items-start gap-3">
            <button
              type="button"
              class="custom-field-handle mt-7 shrink-0 text-muted-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed cursor-grab active:cursor-grabbing"
              :disabled="reordering || isSearching"
              :title="isSearching ? t('settings.metadata.customFields.clearSearchToReorder') : t('settings.metadata.customFields.dragToReorder')"
              :aria-label="t('settings.metadata.customFields.dragToReorderField')"
            >
              <GripVertical :size="16" />
            </button>
            <div class="min-w-0 flex-1 space-y-3">
              <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <label class="space-y-1.5">
                  <span class="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {{ t('settings.metadata.customFields.label') }}
                    <span
                      v-if="isDirty(field)"
                      class="inline-flex items-center gap-1 normal-case tracking-normal font-medium text-amber-600 dark:text-amber-400"
                    >
                      <span class="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      {{ t('settings.metadata.customFields.unsaved') }}
                    </span>
                  </span>
                  <input
                    v-model="draftFor(field).label"
                    class="input-field w-full"
                    :aria-invalid="!!draftLabelError(field)"
                    @keydown.enter="handleSave(field)"
                  />
                  <span v-if="draftLabelError(field)" class="text-xs text-destructive">{{ draftLabelError(field) }}</span>
                </label>
                <div class="space-y-1.5">
                  <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{
                    t('settings.metadata.customFields.type')
                  }}</span>
                  <div class="h-9 flex items-center gap-1.5 px-3 rounded-md border border-border bg-muted/30 text-sm">
                    <component :is="CUSTOM_FIELD_TYPE_META[field.type].icon" :size="14" class="text-muted-foreground" />
                    <span class="text-muted-foreground">{{ CUSTOM_FIELD_TYPE_META[field.type].label }}</span>
                  </div>
                </div>
              </div>

              <LibraryToggleGroup
                :model-value="draftFor(field).enabledLibraryIds"
                :libraries="libraries"
                @update:model-value="setDraftLibraries(field, $event)"
              />

              <div class="flex flex-wrap items-center justify-between gap-3">
                <span
                  class="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
                  :class="CUSTOM_FIELD_TYPE_META[field.type].badgeClass"
                >
                  {{ usageLabel(field) }}
                </span>
                <div class="flex items-center gap-2">
                  <button class="settings-btn-outline" :disabled="!canSave(field)" @click="handleSave(field)">
                    <Loader2 v-if="savingId === field.id" :size="14" class="animate-spin" />
                    <Save v-else :size="14" />
                    {{ t('common.save') }}
                  </button>
                  <button
                    class="settings-btn-outline text-destructive hover:border-destructive/40 hover:bg-destructive/5"
                    :disabled="archivingId === field.id"
                    @click="handleArchive(field)"
                  >
                    <Loader2 v-if="archivingId === field.id" :size="14" class="animate-spin" />
                    <Archive v-else :size="14" />
                    {{ t('settings.metadata.customFields.archive') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </VueDraggable>
    </section>

    <section v-if="archivedFields.length > 0" class="rounded-lg border border-border bg-card overflow-hidden shadow-xs">
      <button
        type="button"
        class="w-full px-4 py-3.5 md:px-5 md:py-4 flex items-center justify-between gap-3 bg-muted/30 hover:bg-muted/50 transition-colors"
        @click="toggleArchived"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Archive :size="15" />
          </div>
          <div class="text-left">
            <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{
              t('settings.metadata.customFields.archivedFields')
            }}</span>
            <p class="settings-hint">
              {{ t('settings.metadata.customFields.archivedSummary', { count: archivedFields.length }, archivedFields.length) }}
            </p>
          </div>
        </div>
        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform" :class="showArchived ? 'rotate-180' : ''" />
      </button>

      <div v-if="showArchived" class="divide-y divide-border">
        <div
          v-for="field in archivedFields"
          :key="field.id"
          class="px-4 py-4 md:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div class="min-w-0 space-y-1">
            <p class="text-sm font-medium text-foreground truncate">{{ field.label }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                :class="CUSTOM_FIELD_TYPE_META[field.type].badgeClass"
              >
                <component :is="CUSTOM_FIELD_TYPE_META[field.type].icon" :size="12" />
                {{ CUSTOM_FIELD_TYPE_META[field.type].label }}
              </span>
              <span class="text-xs text-muted-foreground">{{ usageLabel(field) }}</span>
              <span class="text-xs text-muted-foreground" :title="formatAbsoluteDateTime(field.archivedAt!)">
                {{ t('settings.metadata.customFields.archivedAt', { when: formatRelativeTime(field.archivedAt!) }) }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button class="settings-btn-outline" :disabled="restoringId === field.id" @click="handleRestore(field)">
              <Loader2 v-if="restoringId === field.id" :size="14" class="animate-spin" />
              <ArchiveRestore v-else :size="14" />
              {{ t('settings.metadata.customFields.restore') }}
            </button>
            <button
              class="settings-btn-outline text-destructive hover:border-destructive/40 hover:bg-destructive/5"
              :disabled="restoringId === field.id"
              @click="openDeleteConfirm(field)"
            >
              <Trash2 :size="14" />
              {{ t('settings.metadata.customFields.deleteForever') }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>

  <Teleport to="body">
    <div v-if="deleteConfirmField" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="cancelDeleteConfirm">
      <div class="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div class="p-5 border-b border-border flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <Trash2 :size="16" />
          </div>
          <div>
            <p class="text-sm font-semibold text-foreground">{{ t('settings.metadata.customFields.deleteDialog.title') }}</p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ t('settings.metadata.customFields.deleteDialog.bodyBefore') }}
              <span class="font-medium text-foreground">{{ deleteConfirmField.label }}</span>
              {{ t('settings.metadata.customFields.deleteDialog.bodyMiddle') }}
              <span class="font-medium text-foreground">{{ usageLabel(deleteConfirmField).toLowerCase() }}</span
              >{{ t('settings.metadata.customFields.deleteDialog.bodyAfter') }}
            </p>
          </div>
        </div>
        <div class="p-5 space-y-3">
          <label class="space-y-1.5">
            <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              {{ t('settings.metadata.customFields.deleteDialog.confirmBefore') }}
              <span class="text-foreground normal-case tracking-normal font-semibold">{{ deleteConfirmField.label }}</span>
              {{ t('settings.metadata.customFields.deleteDialog.confirmAfter') }}
            </span>
            <input
              v-model="deleteConfirmInput"
              class="input-field w-full"
              :placeholder="t('settings.metadata.customFields.deleteDialog.confirmPlaceholder')"
              @keydown.enter="confirmDeletePermanently"
            />
          </label>
          <div class="flex justify-end gap-2">
            <button class="settings-btn-outline" @click="cancelDeleteConfirm">{{ t('common.cancel') }}</button>
            <button
              class="settings-btn-outline text-destructive hover:border-destructive/40 hover:bg-destructive/5 disabled:opacity-50"
              :disabled="!canConfirmDelete"
              @click="confirmDeletePermanently"
            >
              <Loader2 v-if="deletingPermanentlyId !== null" :size="14" class="animate-spin" />
              <Trash2 v-else :size="14" />
              {{ t('settings.metadata.customFields.deleteForever') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
