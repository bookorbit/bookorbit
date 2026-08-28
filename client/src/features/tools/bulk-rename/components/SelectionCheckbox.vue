<script setup lang="ts">
import { computed } from 'vue'
import { Check, Minus } from '@lucide/vue'

import type { TriState } from '../composables/useBulkRenameReview'

/**
 * One checkbox shape for rows, group headers and the list header. Group and header boxes need a
 * mixed state, which a native input can only express through a DOM property, so this is a button
 * carrying `role="checkbox"` instead.
 */
const props = defineProps<{
  state: TriState
  label: string
}>()

const emit = defineEmits<{ toggle: [] }>()

const ariaChecked = computed(() => (props.state === 'all' ? 'true' : props.state === 'some' ? 'mixed' : 'false'))

function handleToggle(): void {
  emit('toggle')
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="ariaChecked"
    :aria-label="label"
    class="grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border-[1.5px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    :class="state === 'none' ? 'border-input bg-background hover:border-primary/60' : 'border-primary bg-primary'"
    @click.stop="handleToggle"
  >
    <Check v-if="state === 'all'" class="size-2.5 text-primary-foreground" aria-hidden="true" />
    <Minus v-else-if="state === 'some'" class="size-2.5 text-primary-foreground" aria-hidden="true" />
  </button>
</template>
