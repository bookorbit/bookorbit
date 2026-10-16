<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(defineProps<{ icon: Component; tone?: 'error' | 'notice'; id?: string }>(), { tone: 'error', id: undefined })
</script>

<template>
  <div
    :id="id"
    :role="tone === 'error' ? 'alert' : 'status'"
    class="flex items-start gap-2.5 rounded-[3px] border px-3 py-2.5 text-[0.8125rem] leading-[1.1875rem] text-foreground"
    :class="tone === 'error' ? 'border-destructive/45 bg-destructive/10' : 'border-primary/40 bg-primary/10'"
  >
    <component :is="icon" :size="16" class="mt-0.5 shrink-0" :class="tone === 'error' ? 'text-destructive' : 'text-primary'" aria-hidden="true" />
    <div class="min-w-0">
      <p><slot /></p>
      <div v-if="$slots.action" class="mt-1.5"><slot name="action" /></div>
    </div>
  </div>
</template>
