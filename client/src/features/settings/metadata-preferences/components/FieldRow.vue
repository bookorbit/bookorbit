<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import type { FieldPreference, MetadataField, ProviderStatus } from '@projectx/types'
import MergeStrategyPicker from './MergeStrategyPicker.vue'
import ProviderChipList from './ProviderChipList.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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

function update(patch: Partial<FieldPreference>) {
  emit('change', props.field, { ...props.preference, ...patch })
}
</script>

<template>
  <div class="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 transition-colors">
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

    <!-- Provider chip list -->
    <div class="flex-1 min-w-0">
      <ProviderChipList
        :providers="preference.providers"
        :statuses="statuses"
        :disabled="!preference.enabled || saving"
        @update:providers="update({ providers: $event })"
      />
    </div>

    <!-- Merge strategy + inherited badge + revert -->
    <div class="flex items-center gap-2 shrink-0">
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
            class="flex items-center gap-1 h-6 px-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            @click="$emit('revert', field)"
          >
            <RotateCcw :size="11" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Revert to global default</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
