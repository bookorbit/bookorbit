<script setup lang="ts">
/**
 * One shape for every setting: the words on the left at a readable measure, the control parked
 * in a column on the right. Without the fixed control column each row places its switch wherever
 * its own sentence happens to end, which is what made a wide settings card unscannable.
 */
defineProps<{ label: string; hint?: string; controlId?: string }>()
</script>

<template>
  <div class="settings-row">
    <div class="min-w-0 settings-prose">
      <label v-if="controlId" :for="controlId" class="settings-label block">{{ label }}</label>
      <p v-else class="settings-label">{{ label }}</p>
      <p v-if="hint" class="settings-hint">{{ hint }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-3 md:w-48 md:justify-end">
      <slot />
    </div>
  </div>
</template>
