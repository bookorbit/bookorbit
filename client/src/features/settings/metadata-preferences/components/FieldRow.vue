<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, RotateCcw, Settings2 } from 'lucide-vue-next'
import type { FieldPreference, MetadataField, MetadataProviderKey, ProviderStatus } from '@projectx/types'
import MergeStrategyPicker from './MergeStrategyPicker.vue'
import ProviderChipList from './ProviderChipList.vue'
import FieldConfigSheet from './FieldConfigSheet.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'

const RESERVOIR_TYPE = 'application/x-provider-key'

const props = defineProps<{
  field: MetadataField
  preference: FieldPreference
  statuses: ProviderStatus[]
  inherited?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
}>()

const FIELD_LABELS: Record<MetadataField, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  description: 'Description',
  cover: 'Cover',
  authors: 'Authors',
  publisher: 'Publisher',
  publishedYear: 'Published year',
  language: 'Language',
  pageCount: 'Page count',
  seriesName: 'Series name',
  seriesIndex: 'Series index',
  genres: 'Genres',
}

const label = computed(() => FIELD_LABELS[props.field] ?? props.field)
const noProviders = computed(() => props.preference.enabled && props.preference.providers.length === 0)
const sheetOpen = ref(false)
const isDragOver = ref(false)

function update(patch: Partial<FieldPreference>) {
  emit('change', props.field, { ...props.preference, ...patch })
}

function onSheetChange(pref: FieldPreference) {
  emit('change', props.field, pref)
}

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes(RESERVOIR_TYPE)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  isDragOver.value = true
}

function onDragLeave(e: DragEvent) {
  const row = e.currentTarget as Element
  if (e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return
  isDragOver.value = false
}

function onDrop(e: DragEvent) {
  isDragOver.value = false
  const key = e.dataTransfer?.getData(RESERVOIR_TYPE) as MetadataProviderKey | undefined
  if (!key) return
  if (props.preference.providers.includes(key)) return
  update({ providers: [...props.preference.providers, key] })
}
</script>

<template>
  <div
    class="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 transition-colors relative"
    :class="isDragOver ? 'bg-primary/5 outline outline-1 outline-primary/25 outline-offset-[-1px]' : ''"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Drop hint overlay -->
    <div v-if="isDragOver" class="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <span class="text-xs text-primary font-medium bg-card border border-primary/30 px-2.5 py-1 rounded-full shadow-sm"> Add to {{ label }} </span>
    </div>

    <!-- Enable toggle + label -->
    <div class="flex items-center gap-2 sm:w-36 shrink-0">
      <input
        type="checkbox"
        :checked="preference.enabled"
        :disabled="saving"
        class="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
        @change="update({ enabled: ($event.target as HTMLInputElement).checked })"
      />
      <span class="text-sm text-foreground font-medium truncate">{{ label }}</span>
    </div>

    <!-- Provider chip list (desktop) -->
    <div class="flex-1 min-w-0 hidden sm:block">
      <ProviderChipList
        :providers="preference.providers"
        :statuses="statuses"
        :disabled="!preference.enabled || saving"
        @update:providers="update({ providers: $event })"
      />
    </div>

    <!-- Mobile: chip preview + configure button -->
    <div class="flex items-center gap-2 sm:hidden">
      <div class="flex flex-wrap gap-1 flex-1 min-w-0">
        <span v-for="key in preference.providers" :key="key" class="text-xs px-1.5 py-0.5 rounded font-medium" :style="providerChipStyle(key)">
          {{ PROVIDER_SHORT_LABELS[key] ?? key }}
        </span>
        <span v-if="preference.providers.length === 0 && !preference.enabled" class="text-xs text-muted-foreground/50 italic">none</span>
        <span v-if="noProviders" class="flex items-center gap-1 text-xs text-amber-500 font-medium">
          <AlertTriangle :size="11" />
          No providers
        </span>
      </div>
      <button
        :disabled="saving"
        class="shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded border border-border bg-background text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        @click="sheetOpen = true"
      >
        <Settings2 :size="12" />
        Configure
      </button>
    </div>

    <!-- Merge strategy + badges + revert (desktop) -->
    <div class="hidden sm:flex items-center gap-2 shrink-0">
      <Tooltip v-if="noProviders">
        <TooltipTrigger as-child>
          <span class="flex items-center gap-1 text-xs text-amber-500 font-medium shrink-0">
            <AlertTriangle :size="12" />
            No providers
          </span>
        </TooltipTrigger>
        <TooltipContent>Field is enabled but has no providers - it will be skipped during refresh</TooltipContent>
      </Tooltip>

      <MergeStrategyPicker
        :model-value="preference.mergeStrategy"
        :disabled="!preference.enabled || saving"
        @update:model-value="update({ mergeStrategy: $event })"
      />

      <span
        v-if="inherited !== undefined"
        class="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
        :class="inherited ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'"
      >
        {{ inherited ? 'inherited' : 'custom' }}
      </span>

      <Tooltip v-if="inherited === false">
        <TooltipTrigger as-child>
          <button
            :disabled="saving"
            class="flex items-center h-6 px-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            @click="$emit('revert', field)"
          >
            <RotateCcw :size="11" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Revert to global default</TooltipContent>
      </Tooltip>
    </div>

    <FieldConfigSheet
      v-if="sheetOpen"
      :field="field"
      :preference="preference"
      :statuses="statuses"
      @change="onSheetChange"
      @close="sheetOpen = false"
    />
  </div>
</template>
