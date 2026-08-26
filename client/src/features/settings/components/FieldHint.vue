<script setup lang="ts">
/**
 * One line under a control. A settings form that sets three sentences of prose beside every input
 * reads as documentation with inputs embedded in it, so a hint says the one thing worth saying and
 * the rest belongs in the docs.
 */
defineProps<{
  /** Short enough to sit on one line beside the field it belongs to. */
  brief: string
}>()
</script>

<template>
  <p class="settings-hint">{{ brief }}</p>
</template>
