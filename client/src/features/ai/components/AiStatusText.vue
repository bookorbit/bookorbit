<script setup lang="ts">
import { aiTable, STATUS_DOT, type AiStatusTone } from '../lib/ai-settings-ui'

defineProps<{
  tone: AiStatusTone
  label: string
}>()
</script>

<template>
  <p :class="[aiTable.status, tone === 'error' ? 'text-destructive' : 'text-muted-foreground']">
    <span :class="[aiTable.dot, STATUS_DOT[tone]]" aria-hidden="true" />
    <span class="min-w-0">{{ label }}</span>
  </p>
</template>
