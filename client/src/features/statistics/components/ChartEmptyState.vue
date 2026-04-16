<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
  description?: string
}>()
</script>

<template>
  <div
    class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-center animate-fade-up"
    style="animation-delay: 100ms"
  >
    <component :is="icon" class="size-9 opacity-20" />
    <div class="flex max-w-[280px] flex-col items-center gap-1">
      <p class="text-sm font-medium">{{ title }}</p>
      <p v-if="description" class="text-xs opacity-70">{{ description }}</p>
    </div>
  </div>
</template>
