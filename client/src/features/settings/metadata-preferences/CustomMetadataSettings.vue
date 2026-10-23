<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Search, X } from '@lucide/vue'
import type { CustomMetadataFieldDefinition, CustomMetadataFieldType } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useCustomMetadataFields } from './composables/useCustomMetadataFields'
import { typeLabelKey } from './lib/custom-field-types'
import CustomFieldEditorSheet from './components/CustomFieldEditorSheet.vue'
import type { CustomFieldDraft, CustomFieldSheetMode } from './components/CustomFieldEditorSheet.vue'
import CustomFieldEmptyState from './components/CustomFieldEmptyState.vue'
import CustomFieldRosterCards from './components/CustomFieldRosterCards.vue'
import CustomFieldRosterTable from './components/CustomFieldRosterTable.vue'

const HEADER_ACTIONS_TARGET = '#settings-header-actions'

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()
const {
  fields,
  loading,
  loaded,
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
  moveField,
} = useCustomMetadataFields()

const headerSlotAvailable = ref(false)
const search = ref('')
const view = ref<'active' | 'archived'>('active')

const sheetOpen = ref(false)
const sheetMode = ref<CustomFieldSheetMode>('edit')
const sheetFieldId = ref<number | null>(null)
const sheetStarter = ref<{ label: string; type: CustomMetadataFieldType } | null>(null)
const sheetConfirmDelete = ref(false)

const query = computed(() => search.value.trim().toLowerCase())
const isSearching = computed(() => query.value.length > 0)

function matches(field: CustomMetadataFieldDefinition): boolean {
  if (!query.value) return true
  return (
    field.label.toLowerCase().includes(query.value) ||
    field.key.includes(query.value) ||
    t(typeLabelKey(field.type)).toLowerCase().includes(query.value)
  )
}

const listed = computed(() => (view.value === 'archived' ? archivedFields.value : activeFields.value).filter(matches))
const canReorder = computed(() => !isSearching.value && !reordering.value)

const headerFacts = computed(() => {
  const values = fields.value.reduce((total, field) => total + field.usageCount, 0)
  return t('settings.metadata.customFields.pageFacts', { fields: activeFields.value.length, values })
})

const sheetField = computed(() => fields.value.find((field) => field.id === sheetFieldId.value) ?? null)
const sheetIndex = computed(() => activeFields.value.findIndex((field) => field.id === sheetFieldId.value))
const sheetBusy = computed(() => {
  const id = sheetFieldId.value
  if (sheetMode.value === 'create') return creating.value
  return id !== null && (savingId.value === id || archivingId.value === id || restoringId.value === id || deletingPermanentlyId.value === id)
})

// Nothing archived left to show: fall back to the active list rather than an empty filter.
watch(
  () => archivedFields.value.length,
  (count) => {
    if (count === 0) view.value = 'active'
  },
)

function showActive() {
  view.value = 'active'
}

function showArchived() {
  view.value = 'archived'
}

function clearSearch() {
  search.value = ''
}

function openCreate() {
  sheetMode.value = 'create'
  sheetFieldId.value = null
  sheetStarter.value = null
  sheetConfirmDelete.value = false
  sheetOpen.value = true
}

function openStarter(starter: { label: string; type: CustomMetadataFieldType }) {
  openCreate()
  sheetStarter.value = starter
}

function openField(field: CustomMetadataFieldDefinition) {
  sheetMode.value = field.archivedAt ? 'archived' : 'edit'
  sheetFieldId.value = field.id
  sheetConfirmDelete.value = false
  sheetOpen.value = true
}

function openDelete(field: CustomMetadataFieldDefinition) {
  openField(field)
  sheetConfirmDelete.value = true
}

function closeSheet() {
  sheetOpen.value = false
}

async function handleCreate(draft: CustomFieldDraft) {
  const created = await createField(draft)
  if (created) sheetOpen.value = false
}

async function handleSave(field: CustomMetadataFieldDefinition, draft: Pick<CustomFieldDraft, 'label' | 'enabledLibraryIds'>) {
  const updated = await saveField(field, draft)
  if (updated) sheetOpen.value = false
}

async function handleArchive(field: CustomMetadataFieldDefinition) {
  const archived = await archiveField(field)
  if (archived && sheetFieldId.value === field.id) sheetOpen.value = false
}

async function handleRestore(field: CustomMetadataFieldDefinition) {
  const restored = await restoreField(field)
  if (restored && sheetFieldId.value === field.id) sheetOpen.value = false
}

async function handleDelete(field: CustomMetadataFieldDefinition) {
  const deleted = await deleteFieldPermanently(field)
  if (deleted) sheetOpen.value = false
}

async function handleMove(field: CustomMetadataFieldDefinition, step: -1 | 1) {
  await moveField(field, step)
}

async function handleReorder(orderedIds: number[]) {
  await reorderFields(orderedIds)
}

onMounted(() => {
  headerSlotAvailable.value = document.getElementById(HEADER_ACTIONS_TARGET.slice(1)) !== null
  void Promise.all([fetchLibraries(), loadFields()])
})
</script>

<template>
  <div class="space-y-3">
    <Teleport :to="HEADER_ACTIONS_TARGET" defer :disabled="!headerSlotAvailable">
      <p v-if="fields.length > 0" class="hidden text-sm tabular-nums text-muted-foreground xl:block">{{ headerFacts }}</p>
      <Button
        size="sm"
        type="button"
        class="max-sm:size-8 max-sm:px-0"
        :aria-label="t('settings.metadata.customFields.newFieldAction')"
        @click="openCreate"
      >
        <Plus :size="14" aria-hidden="true" />
        <span class="max-sm:sr-only">{{ t('settings.metadata.customFields.newFieldAction') }}</span>
      </Button>
    </Teleport>

    <p v-if="loading && !loaded" role="status" class="settings-loading-state">{{ t('common.loading') }}</p>

    <CustomFieldEmptyState v-else-if="loaded && fields.length === 0" @create="openCreate" @start="openStarter" />

    <template v-else-if="loaded">
      <div class="flex flex-wrap items-center gap-2">
        <label class="relative block w-full sm:w-80">
          <span class="sr-only">{{ t('settings.metadata.customFields.searchAriaLabel') }}</span>
          <Search :size="14" class="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            v-model="search"
            type="search"
            class="input-field h-9 w-full ps-8 pe-8"
            :placeholder="t('settings.metadata.customFields.searchPlaceholder')"
          />
          <button
            v-if="search"
            type="button"
            class="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('components.viewHeader.clearSearch')"
            @click="clearSearch"
          >
            <X :size="14" aria-hidden="true" />
          </button>
        </label>

        <div
          v-if="archivedFields.length > 0"
          role="group"
          :aria-label="t('settings.metadata.customFields.views.label')"
          class="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted p-0.5"
        >
          <button
            type="button"
            class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="view === 'active' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="view === 'active'"
            @click="showActive"
          >
            {{ t('settings.metadata.customFields.views.active') }}
            <span
              class="rounded-xs px-1 text-xs tabular-nums"
              :class="view === 'active' ? 'bg-primary/15 text-primary' : 'bg-foreground/8 text-muted-foreground'"
            >
              {{ formatNumber(activeFields.length) }}
            </span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="view === 'archived' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="view === 'archived'"
            @click="showArchived"
          >
            {{ t('settings.metadata.customFields.views.archived') }}
            <span
              class="rounded-xs px-1 text-xs tabular-nums"
              :class="view === 'archived' ? 'bg-primary/15 text-primary' : 'bg-foreground/8 text-muted-foreground'"
            >
              {{ formatNumber(archivedFields.length) }}
            </span>
          </button>
        </div>
      </div>

      <div v-if="listed.length === 0" class="rounded-lg border border-dashed border-border px-4 py-10 text-center">
        <p class="text-sm font-medium text-foreground">{{ t('settings.metadata.customFields.noMatchTitle', { query: search.trim() }) }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.noMatchHint') }}</p>
      </div>
      <template v-else>
        <CustomFieldRosterTable
          :fields="listed"
          :view="view"
          :libraries="libraries"
          :can-reorder="canReorder"
          :restoring-id="restoringId"
          @open="openField"
          @archive="handleArchive"
          @restore="handleRestore"
          @delete="openDelete"
          @move="handleMove"
          @reorder="handleReorder"
        />
        <CustomFieldRosterCards :fields="listed" :view="view" :libraries="libraries" @open="openField" />
      </template>
    </template>

    <CustomFieldEditorSheet
      :open="sheetOpen"
      :mode="sheetMode"
      :field="sheetField"
      :fields="fields"
      :libraries="libraries"
      :starter="sheetStarter"
      :confirm-delete="sheetConfirmDelete"
      :busy="sheetBusy"
      :can-move-up="canReorder && sheetIndex > 0"
      :can-move-down="canReorder && sheetIndex >= 0 && sheetIndex < activeFields.length - 1"
      @close="closeSheet"
      @create="handleCreate"
      @save="handleSave"
      @archive="handleArchive"
      @restore="handleRestore"
      @delete="handleDelete"
      @move="handleMove"
    />
  </div>
</template>
