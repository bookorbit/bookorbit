<script setup lang="ts">
/**
 * A pill that turns a filter, a sort or a saved list on. `aria-pressed` rather than `aria-current`:
 * these are toggles within a group, not a position in a navigation trail, and the two were used
 * interchangeably across the podcast views until this component settled it.
 */
withDefaults(defineProps<{ active?: boolean; label?: string }>(), { active: false, label: undefined })

const emit = defineEmits<{ select: [] }>()

function handleClick() {
  emit('select')
}
</script>

<template>
  <button
    type="button"
    class="h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
    :class="active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'"
    :aria-pressed="active"
    :aria-label="label"
    @click="handleClick"
  >
    <slot />
  </button>
</template>
