<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
  message?: string
}>()
</script>

<template>
  <!--
    One treatment for every empty list in the feature, matching the Book Dock file list so the two
    pages do not each invent their own. Actions go in the slot.
  -->
  <div role="status" class="flex flex-col items-center gap-3 px-6 py-16 text-center">
    <div class="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
      <component :is="icon" class="size-6" aria-hidden="true" />
    </div>
    <p class="text-sm font-medium text-foreground">{{ title }}</p>
    <p v-if="message" class="max-w-md text-xs text-muted-foreground">{{ message }}</p>
    <div v-if="$slots.default" class="mt-1 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
