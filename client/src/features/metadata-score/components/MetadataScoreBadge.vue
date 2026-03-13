<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  score: number | null
}>()

const emit = defineEmits<{
  click: []
}>()

function handleClick() {
  emit('click')
}

const label = computed(() => {
  if (props.score === null) return null
  return `${props.score}%`
})

const colorClass = computed(() => {
  const s = props.score
  if (s === null) return 'bg-muted text-muted-foreground'
  if (s >= 90) return 'bg-green-500/15 text-green-600 dark:text-green-400'
  if (s >= 70) return 'bg-lime-500/15 text-lime-600 dark:text-lime-400'
  if (s >= 50) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  return 'bg-red-500/15 text-red-600 dark:text-red-400'
})
</script>

<template>
  <button
    v-if="label !== null"
    type="button"
    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-opacity hover:opacity-80"
    :class="colorClass"
    @click="handleClick"
  >
    {{ label }}
  </button>
</template>
