<script setup lang="ts">
import { cn } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import { Funnel } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { barButton, barButtonOn } from './browse-header'

/**
 * The filter builder, opened over the grid from the bar. It used to open as a panel that pushed
 * the grid down; the bar is the last band the header may take.
 */
withDefaults(
  defineProps<{
    open: boolean
    /** Rules in effect, shown as a badge so a filter is visible even when its tokens are folded. */
    count?: number
  }>(),
  { count: 0 },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}
</script>

<template>
  <Popover :open="open" @update:open="handleOpenChange">
    <PopoverTrigger as-child>
      <button type="button" :class="cn(barButton, (count > 0 || open) && barButtonOn)" :aria-label="t('views.bookView.filters')">
        <Funnel :size="14" :class="count > 0 || open ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
        <span class="hidden lg:inline">{{ t('views.bookView.filters') }}</span>
        <span
          v-if="count > 0"
          class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums"
          >{{ count }}</span
        >
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" :side-offset="8" class="flex w-[min(720px,calc(100vw-24px))] flex-col p-0">
      <div class="max-h-[70vh] overflow-y-auto p-3">
        <slot />
      </div>
      <div v-if="$slots.footer" class="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <slot name="footer" />
      </div>
    </PopoverContent>
  </Popover>
</template>
