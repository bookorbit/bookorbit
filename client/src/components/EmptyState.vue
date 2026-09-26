<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ icon?: string; title: string; hint?: string }>()
</script>

<template>
  <div class="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/45 px-6 text-center">
    <div v-if="icon" class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <AppIcon :icon="icon" :size="24" />
    </div>
    <h2 class="text-lg font-bold tracking-tight" :class="icon ? 'mt-4' : ''">{{ title }}</h2>
    <p v-if="hint" class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{{ hint }}</p>
    <div v-if="$slots.actions" class="mt-5 flex flex-wrap justify-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
