<script setup lang="ts">
defineProps<{ title: string; subtitle: string }>()
</script>

<template>
  <div class="flex items-center justify-between mb-8 gap-4">
    <div class="min-w-0">
      <h2 class="settings-title">{{ title }}</h2>
      <p class="settings-subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.default" class="flex items-center gap-2 shrink-0">
      <slot />
    </div>
  </div>
</template>
