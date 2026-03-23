<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, RotateCcw, Settings2 } from 'lucide-vue-next'
import type { FieldPreference, MetadataField, MetadataProviderKey, ProviderStatus } from '@projectx/types'
import MergeStrategyPicker from './MergeStrategyPicker.vue'
import ProviderChipList from './ProviderChipList.vue'
import FieldConfigSheet from './FieldConfigSheet.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { Badge } from '@/components/ui/badge'

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
  narrators: 'Narrators',
  duration: 'Duration',
  abridged: 'Abridged',
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
    class="flex flex-col md:flex-row md:items-center gap-4 px-6 py-3.5 transition-colors relative hover:bg-muted/15"
    :class="isDragOver ? 'bg-primary/5 outline outline-primary/25 -outline-offset-1' : ''"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Drop hint overlay -->
    <div v-if="isDragOver" class="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <span
        class="text-xs text-primary font-bold bg-card border-2 border-primary/30 px-4 py-1.5 rounded-full shadow-lg animate-in zoom-in-95 duration-200"
      >
        Drop to add to {{ label }}
      </span>
    </div>

    <!-- Enable toggle + label -->
    <div class="flex items-center gap-3 md:w-44 shrink-0">
      <div
        class="relative flex h-4.5 w-8.5 shrink-0 items-center rounded-full transition-colors cursor-pointer"
        :class="preference.enabled ? 'bg-primary' : 'bg-muted border border-border'"
        @click="update({ enabled: !preference.enabled })"
      >
        <span
          class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
          :class="preference.enabled ? 'translate-x-4' : 'translate-x-0.5'"
        />
      </div>
      <span class="settings-label truncate">{{ label }}</span>
    </div>

    <!-- Provider chip list (desktop) -->
    <div class="flex-1 min-w-0 hidden md:block">
      <div class="flex items-center gap-2">
        <ProviderChipList
          :providers="preference.providers"
          :statuses="statuses"
          :disabled="!preference.enabled || saving"
          @update:providers="update({ providers: $event })"
        />
        <Tooltip v-if="noProviders">
          <TooltipTrigger as-child>
            <AlertTriangle :size="14" class="text-amber-500 animate-pulse shrink-0" />
          </TooltipTrigger>
          <TooltipContent>Enabled but has no providers</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- Mobile: chip preview + configure button -->
    <div class="flex items-center gap-3 md:hidden">
      <div class="flex flex-wrap gap-1.5 flex-1 min-w-0">
        <span
          v-for="key in preference.providers"
          :key="key"
          class="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight"
          :style="providerChipStyle(key)"
        >
          {{ PROVIDER_SHORT_LABELS[key] ?? key }}
        </span>
        <span v-if="preference.providers.length === 0 && !preference.enabled" class="text-xs text-muted-foreground/60 italic">Not fetched</span>
        <span v-if="noProviders" class="flex items-center gap-1.5 text-xs text-amber-500 font-bold uppercase tracking-tight">
          <AlertTriangle :size="12" />
          Empty
        </span>
      </div>
      <button
        :disabled="saving"
        class="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        @click="sheetOpen = true"
      >
        <Settings2 :size="13" />
        Config
      </button>
    </div>

    <!-- Merge strategy + badges + revert (desktop) -->
    <div class="hidden md:flex items-center gap-4 shrink-0">
      <div class="w-44 shrink-0">
        <MergeStrategyPicker
          :model-value="preference.mergeStrategy"
          :disabled="!preference.enabled || saving"
          @update:model-value="update({ mergeStrategy: $event })"
        />
      </div>

      <div v-if="inherited !== undefined" class="w-16 flex items-center justify-center shrink-0">
        <Tooltip v-if="!inherited">
          <TooltipTrigger as-child>
            <div class="flex items-center gap-1">
              <Badge variant="secondary" class="h-4.5 px-1.5 text-[9px] font-bold uppercase tracking-tight"> Custom </Badge>
              <button
                :disabled="saving"
                class="flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-40"
                @click="$emit('revert', field)"
              >
                <RotateCcw :size="11" />
              </button>
            </div>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
        <Badge v-else variant="outline" class="h-4.5 px-1.5 text-[9px] font-bold uppercase tracking-tight opacity-40"> Default </Badge>
      </div>
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
