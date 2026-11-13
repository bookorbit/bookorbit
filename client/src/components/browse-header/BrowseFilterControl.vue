<script setup lang="ts">
import { cn } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import { Funnel } from '@lucide/vue'
import type { PopoverAnchorProps } from 'reka-ui'
import BrowsePanel from './BrowsePanel.vue'
import { barButton, barButtonOn } from './browse-header'

/**
 * The bar's Filters button and its panel, opened over the grid. The panel sizes to what it shows,
 * becomes a bottom sheet on a phone, and can sit under a filter token instead of the button.
 */
withDefaults(
  defineProps<{
    open: boolean
    /** Rules in effect, shown as a badge so a filter is visible even when its tokens are folded. */
    count?: number
    /** Where the panel opens when it is not under the button, such as the token being edited. */
    anchor?: PopoverAnchorProps['reference'] | null
  }>(),
  { count: 0, anchor: null },
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
  <BrowsePanel :open="open" :title="t('book.filter.panelTitle')" phone-sheet :anchor="anchor" @update:open="handleOpenChange">
    <template #trigger>
      <button
        type="button"
        :class="cn(barButton, (count > 0 || open) && barButtonOn)"
        :aria-label="t('views.bookView.filters')"
        aria-haspopup="dialog"
      >
        <Funnel :size="14" :class="count > 0 || open ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
        <span class="hidden lg:inline">{{ t('views.bookView.filters') }}</span>
        <span
          v-if="count > 0"
          class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums"
          >{{ count }}</span
        >
      </button>
    </template>
    <slot />
  </BrowsePanel>
</template>
