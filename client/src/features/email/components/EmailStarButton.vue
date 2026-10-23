<script setup lang="ts">
import { Star } from '@lucide/vue'

const props = defineProps<{ on: boolean; label: string; busy?: boolean }>()
const emit = defineEmits<{ star: [] }>()

function handleClick() {
  if (!props.on) emit('star')
}
</script>

<template>
  <!-- The default stays visible; any other star shows on hover, or always where there is no hover. -->
  <button
    type="button"
    class="relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] transition-[opacity,background-color,color] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :class="
      on
        ? 'text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100'
    "
    :aria-pressed="on"
    :aria-label="label"
    :title="label"
    :disabled="busy"
    @click="handleClick"
  >
    <Star :size="15" :class="on ? 'fill-current' : ''" aria-hidden="true" />
  </button>
</template>
