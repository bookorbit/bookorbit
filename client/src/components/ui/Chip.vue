<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { X } from '@lucide/vue'
import { cn } from '@/lib/utils'

/**
 * A pill carrying one committed value, optionally with its own remove control. The two variants
 * are the neutral chip inside a text field and the selected-value chip a form renders beside one.
 */
const props = withDefaults(
  defineProps<{
    variant?: 'muted' | 'primary'
    removable?: boolean
    /** Required whenever `removable` is set: the remove control is icon-only. */
    removeLabel?: string
    disabled?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { variant: 'muted', removable: false, removeLabel: undefined, disabled: false, class: undefined },
)

const emit = defineEmits<{ remove: [] }>()

function handleRemove() {
  if (!props.disabled) emit('remove')
}
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center gap-1 rounded-full text-xs',
        removable ? 'py-0.5 pl-2.5 pr-1' : 'px-2.5 py-0.5',
        variant === 'primary' ? 'border border-primary/30 bg-primary/10 text-primary' : 'bg-muted text-foreground',
        props.class,
      )
    "
  >
    <slot />
    <button
      v-if="removable"
      type="button"
      class="inline-flex size-5 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
      :class="variant === 'primary' ? 'text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-foreground'"
      :aria-label="removeLabel"
      :disabled="disabled"
      @click="handleRemove"
    >
      <X :size="12" />
    </button>
  </span>
</template>
