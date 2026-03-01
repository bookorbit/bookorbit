<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-vue-next'
import type { FieldPreference, LibraryMetadataPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldPreferenceTable from './FieldPreferenceTable.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  libraryName: string
  libraryPrefs: LibraryMetadataPreferences | null
  statuses: ProviderStatus[]
  savingField: string | null
}>()

const emit = defineEmits<{
  fieldChange: [libraryId: number, field: MetadataField, pref: FieldPreference | null]
  reset: [libraryId: number]
}>()

const open = ref(false)

const hasOverrides = computed(() => {
  if (!props.libraryPrefs?.overrides) return false
  return Object.keys(props.libraryPrefs.overrides).length > 0
})

const overriddenFields = computed<Set<MetadataField>>(() => {
  if (!props.libraryPrefs?.overrides) return new Set()
  return new Set(Object.keys(props.libraryPrefs.overrides) as MetadataField[])
})

function onFieldChange(field: MetadataField, pref: FieldPreference) {
  if (!props.libraryPrefs) return
  emit('fieldChange', props.libraryPrefs.libraryId, field, pref)
}

function onRevert(field: MetadataField) {
  if (!props.libraryPrefs) return
  emit('fieldChange', props.libraryPrefs.libraryId, field, null)
}

function onReset() {
  if (!props.libraryPrefs) return
  emit('reset', props.libraryPrefs.libraryId)
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card overflow-hidden">
    <div class="flex items-center gap-3 px-5 py-3.5">
      <button class="flex items-center gap-2 flex-1 min-w-0 text-left" @click="open = !open">
        <component :is="open ? ChevronDown : ChevronRight" :size="14" class="text-muted-foreground shrink-0" />
        <span class="settings-label truncate">{{ libraryName }}</span>
        <span
          class="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded"
          :class="hasOverrides ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
        >
          {{ hasOverrides ? `${overriddenFields.size} override${overriddenFields.size === 1 ? '' : 's'}` : 'using global' }}
        </span>
      </button>

      <Tooltip v-if="hasOverrides">
        <TooltipTrigger as-child>
          <button
            class="shrink-0 flex items-center gap-1 h-6 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="onReset"
          >
            <RotateCcw :size="11" />
            Reset all
          </button>
        </TooltipTrigger>
        <TooltipContent>Reset all to global</TooltipContent>
      </Tooltip>
    </div>

    <div v-if="open && libraryPrefs" class="border-t border-border">
      <FieldPreferenceTable
        :preferences="libraryPrefs.effective"
        :statuses="statuses"
        :overridden-fields="overriddenFields"
        :saving-field="savingField"
        :library-id="libraryPrefs.libraryId"
        @change="onFieldChange"
        @revert="onRevert"
      />
    </div>

    <div v-else-if="open && !libraryPrefs" class="border-t border-border px-5 py-4 text-sm text-muted-foreground">Loading...</div>
  </div>
</template>
