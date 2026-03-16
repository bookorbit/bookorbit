<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, RotateCcw, Library } from 'lucide-vue-next'
import type { FieldPreference, LibraryMetadataPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldPreferenceTable from './FieldPreferenceTable.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'

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
  <div
    class="border border-border rounded-xl bg-card overflow-hidden shadow-sm transition-all"
    :class="open ? 'ring-1 ring-primary/20' : 'hover:border-primary/30'"
  >
    <div class="flex items-center gap-3 px-5 py-4 cursor-pointer select-none" @click="open = !open">
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
            <Badge v-if="hasOverrides" variant="secondary" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight">
              {{ overriddenFields.size }} {{ overriddenFields.size === 1 ? 'Override' : 'Overrides' }}
            </Badge>
            <Badge v-else variant="outline" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight opacity-60"> Global Defaults </Badge>
          </div>
          <p class="text-[11px] text-muted-foreground font-mono truncate" v-if="!open">
            {{ hasOverrides ? `Overriding: ${Array.from(overriddenFields).join(', ')}` : 'Inheriting all global metadata rules' }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <Tooltip v-if="hasOverrides">
          <TooltipTrigger as-child>
            <button
              class="shrink-0 flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background text-muted-foreground hover:text-destructive hover:bg-destructive/5 hover:border-destructive/30 transition-all"
              @click.stop="onReset"
            >
              <RotateCcw :size="13" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reset library to global defaults</TooltipContent>
        </Tooltip>

        <div class="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors">
          <component :is="open ? ChevronDown : ChevronRight" :size="16" class="text-muted-foreground" />
        </div>
      </div>
    </div>

    <div v-if="open && libraryPrefs" class="border-t border-border bg-muted/5 animate-in fade-in slide-in-from-top-1 duration-200">
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

    <div v-else-if="open && !libraryPrefs" class="border-t border-border px-6 py-10 flex items-center justify-center">
      <Loader2 :size="20" class="animate-spin text-muted-foreground" />
    </div>
  </div>
</template>
