<script setup lang="ts">
import { computed, ref, watch, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Library, Trash2, Save } from '@lucide/vue'
import type {
  FieldPreference,
  FieldPreferenceOverrides,
  LibraryMetadataPreferences,
  MetadataFetchPreferences,
  MetadataField,
  ProviderStatus,
} from '@bookorbit/types'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'
import FieldPreferenceTable from './FieldPreferenceTable.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { getFormatColor } from '@/features/book/lib/format-colors'

const { t } = useI18n()

const props = defineProps<{
  libraryName: string
  libraryPrimaryFormat: string | null
  libraryPrefs: LibraryMetadataPreferences | null
  globalPrefs: MetadataFetchPreferences | null
  statuses: ProviderStatus[]
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [libraryId: number, overrides: FieldPreferenceOverrides]
  reset: [libraryId: number]
}>()

const open = ref(false)
const draft = ref<MetadataFetchPreferences | null>(null)
const pendingChanges = ref<Map<MetadataField, FieldPreference | null>>(new Map())

watch(
  () => props.libraryPrefs,
  (lp) => {
    if (!lp) return
    draft.value = JSON.parse(JSON.stringify(lp.effective))
    pendingChanges.value = new Map()
  },
  { immediate: true },
)

const isDirty = computed(() => pendingChanges.value.size > 0)

const hasPersistedOverrides = computed(() => {
  if (!props.libraryPrefs?.overrides) return false
  return Object.keys(props.libraryPrefs.overrides).length > 0
})

const overriddenFields = computed<Set<MetadataField>>(() => {
  const base = new Set<MetadataField>(Object.keys(props.libraryPrefs?.overrides ?? {}) as MetadataField[])
  for (const [field, pref] of pendingChanges.value) {
    if (pref === null) base.delete(field)
    else base.add(field)
  }
  return base
})

const primaryFormat = computed(() => {
  if (!props.libraryPrimaryFormat) return 'ANY'
  return props.libraryPrimaryFormat.toUpperCase()
})

const primaryFormatStyle = computed<CSSProperties>(() => ({
  color: getFormatColor(props.libraryPrimaryFormat),
}))

function toggleOpen() {
  open.value = !open.value
}

function onFieldChange(field: MetadataField, pref: FieldPreference) {
  if (!draft.value || props.saving) return
  draft.value = { ...draft.value, fields: { ...draft.value.fields, [field]: pref } }
  pendingChanges.value = new Map(pendingChanges.value).set(field, pref)
}

function onRevert(field: MetadataField) {
  if (!draft.value || !props.globalPrefs || props.saving) return
  const globalField = props.globalPrefs.fields[field]
  draft.value = { ...draft.value, fields: { ...draft.value.fields, [field]: { ...globalField } } }
  pendingChanges.value = new Map(pendingChanges.value).set(field, null)
}

function onClearAll() {
  if (!draft.value) return
  if (!confirm(t('settings.metadata.fieldRules.library.clearAllConfirm', { library: props.libraryName }))) return
  const updatedFields = { ...draft.value.fields }
  const newChanges = new Map(pendingChanges.value)
  for (const field of ALL_METADATA_FIELDS) {
    const updated = { ...updatedFields[field], providers: [] }
    updatedFields[field] = updated
    newChanges.set(field, updated)
  }
  draft.value = { ...draft.value, fields: updatedFields as MetadataFetchPreferences['fields'] }
  pendingChanges.value = newChanges
}

function onReset() {
  if (!props.libraryPrefs) return
  if (!confirm(t('settings.metadata.fieldRules.library.resetConfirm', { library: props.libraryName }))) return
  emit('reset', props.libraryPrefs.libraryId)
}

function onSave() {
  if (!props.libraryPrefs || !isDirty.value) return
  const newOverrides: FieldPreferenceOverrides = { ...props.libraryPrefs.overrides }
  for (const [field, pref] of pendingChanges.value) {
    if (pref === null) delete newOverrides[field]
    else newOverrides[field] = pref
  }
  emit('save', props.libraryPrefs.libraryId, newOverrides)
}
</script>

<template>
  <div
    class="border border-border rounded-lg bg-card overflow-hidden shadow-xs transition-all"
    :class="open ? 'ring-1 ring-primary/20' : 'hover:border-primary/30'"
  >
    <!-- Accordion toggle row -->
    <div class="flex items-center gap-3 px-5 py-4 cursor-pointer select-none" @click="toggleOpen">
      <div class="flex items-center gap-4 flex-1 min-w-0">
        <div
          class="flex items-center justify-center w-8 h-8 rounded-lg bg-muted shrink-0 text-muted-foreground transition-colors"
          :class="open ? 'bg-primary/10 text-primary' : ''"
        >
          <Library :size="16" />
        </div>
        <div class="min-w-0 space-y-0.5">
          <div class="flex items-center gap-3">
            <span class="text-sm font-semibold text-foreground truncate">{{ libraryName }}</span>
            <Badge variant="outline" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight">
              <span class="text-muted-foreground">{{ t('settings.metadata.fieldRules.library.primary') }}</span>
              <span class="ml-1" :style="primaryFormatStyle">{{ primaryFormat }}</span>
            </Badge>
            <Badge v-if="overriddenFields.size > 0" variant="secondary" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight">
              {{ t('settings.metadata.fieldRules.library.overrideCount', { count: overriddenFields.size }, overriddenFields.size) }}
              <span v-if="isDirty" class="ml-1 opacity-60">{{ t('settings.metadata.fieldRules.library.unsavedSuffix') }}</span>
            </Badge>
            <Badge v-else variant="outline" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight opacity-60">
              {{ isDirty ? t('settings.metadata.fieldRules.library.unsavedChanges') : t('settings.metadata.fieldRules.library.globalDefaults') }}
            </Badge>
          </div>
          <p v-if="!open" class="text-[11px] text-muted-foreground font-mono truncate">
            {{
              hasPersistedOverrides
                ? t('settings.metadata.fieldRules.library.overriding', { fields: Array.from(Object.keys(libraryPrefs?.overrides ?? {})).join(', ') })
                : t('settings.metadata.fieldRules.library.inheritingAll')
            }}
          </p>
        </div>
      </div>
      <div class="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors">
        <component :is="open ? ChevronDown : ChevronRight" :size="16" class="text-muted-foreground" />
      </div>
    </div>

    <!-- Expanded content -->
    <template v-if="open">
      <div v-if="draft">
        <!-- Action sub-header -->
        <div class="px-5 py-4 border-t border-border flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/30">
          <div>
            <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ libraryName }}</span>
            <p class="settings-hint">{{ t('settings.metadata.fieldRules.library.subHint') }}</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              class="settings-btn h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md hover:text-destructive hover:border-destructive/50 hover:bg-destructive/5 transition-colors disabled:opacity-40"
              :disabled="saving || !draft"
              @click="onClearAll"
            >
              <Trash2 :size="13" />
              <span>{{ t('settings.metadata.fieldRules.clearAllProviders') }}</span>
            </button>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="settings-btn h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-border/80 hover:bg-muted/50 transition-colors disabled:opacity-40"
                  :disabled="saving"
                  @click="onReset"
                >
                  <RotateCcw :size="13" />
                  <span>{{ t('settings.metadata.fieldRules.resetToDefault') }}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ t('settings.metadata.fieldRules.library.resetTooltip') }}</TooltipContent>
            </Tooltip>
            <button class="settings-btn-primary h-8 px-3" :disabled="saving || !isDirty" @click="onSave">
              <Loader2 v-if="saving" :size="14" class="animate-spin" />
              <Save v-else :size="14" />
              <span>{{ t('common.save') }}</span>
            </button>
          </div>
        </div>

        <FieldPreferenceTable
          :preferences="draft"
          :statuses="statuses"
          :overridden-fields="overriddenFields"
          :saving="saving"
          @change="onFieldChange"
          @revert="onRevert"
        />
      </div>

      <div v-else class="border-t border-border px-6 py-10 flex items-center justify-center">
        <Loader2 :size="20" class="animate-spin text-muted-foreground" />
      </div>
    </template>
  </div>
</template>
