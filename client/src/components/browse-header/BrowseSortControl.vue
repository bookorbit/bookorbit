<script setup lang="ts">
import { cn } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { barButton, barButtonOn, barIconButton } from './browse-header'

/**
 * Sort as two controls: the field, whose popover holds the full builder, and the direction of
 * the first tier, which flips in one click instead of opening anything.
 */
withDefaults(
  defineProps<{
    label: string
    direction: 'asc' | 'desc'
    /** A sort that differs from the view's default. */
    changed?: boolean
    popoverClass?: string
  }>(),
  { changed: false, popoverClass: 'w-80 p-3' },
)

const emit = defineEmits<{
  'toggle-direction': []
}>()

const { t } = useI18n()

function handleToggleDirection() {
  emit('toggle-direction')
}
</script>

<template>
  <div class="flex shrink-0 items-center">
    <Popover>
      <PopoverTrigger as-child>
        <button type="button" :class="cn(barButton, changed && barButtonOn)" :aria-label="t('components.browseHeader.sort.sortBy', { field: label })">
          <ArrowUpDown :size="14" :class="changed ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
          <span class="hidden max-w-[11rem] truncate lg:inline">{{ label }}</span>
          <ChevronDown :size="13" class="-ms-0.5 hidden text-muted-foreground lg:block" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" :class="popoverClass">
        <slot />
      </PopoverContent>
    </Popover>
    <button
      type="button"
      :class="cn(barIconButton, 'hidden sm:inline-grid')"
      :aria-label="direction === 'asc' ? t('components.browseHeader.sort.ascending') : t('components.browseHeader.sort.descending')"
      :title="direction === 'asc' ? t('components.browseHeader.sort.ascending') : t('components.browseHeader.sort.descending')"
      @click="handleToggleDirection"
    >
      <ArrowUp v-if="direction === 'asc'" :size="15" aria-hidden="true" />
      <ArrowDown v-else :size="15" aria-hidden="true" />
    </button>
  </div>
</template>
