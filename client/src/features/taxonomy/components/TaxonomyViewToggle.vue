<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { List, MoreHorizontal, Tags } from '@lucide/vue'
import { barIconButton, segmentItem, segmentTrack } from '@/components/browse-header/browse-header'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { TaxonomyViewMode } from '../lib/taxonomy-text'

/** List | Cloud as a segment on wider screens and a menu on phones, where the bar keeps room for search. */
const props = defineProps<{ modelValue: TaxonomyViewMode }>()

const emit = defineEmits<{ 'update:modelValue': [value: TaxonomyViewMode] }>()

const { t } = useI18n()

const MODES = [
  { value: 'list', icon: List, label: 'taxonomy.index.viewList' },
  { value: 'cloud', icon: Tags, label: 'taxonomy.index.viewCloud' },
] as const

function select(value: TaxonomyViewMode) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function handleMenuUpdate(value: unknown) {
  if (value === 'list' || value === 'cloud') select(value)
}
</script>

<template>
  <div :class="cn(segmentTrack, 'hidden md:inline-flex')" role="group" :aria-label="t('components.browseHeader.viewModes')">
    <button
      v-for="mode in MODES"
      :key="mode.value"
      type="button"
      :class="cn(segmentItem, 'w-7 justify-center px-0')"
      :aria-pressed="modelValue === mode.value"
      :aria-label="t(mode.label)"
      :title="t(mode.label)"
      @click="select(mode.value)"
    >
      <component :is="mode.icon" :size="15" :class="modelValue === mode.value ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
    </button>
  </div>

  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button type="button" :class="cn(barIconButton, 'md:hidden')" :aria-label="t('components.browseHeader.viewModes')">
        <MoreHorizontal :size="15" class="text-muted-foreground" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-44">
      <DropdownMenuRadioGroup :model-value="modelValue" @update:model-value="handleMenuUpdate">
        <DropdownMenuRadioItem v-for="mode in MODES" :key="mode.value" :value="mode.value">{{ t(mode.label) }}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
