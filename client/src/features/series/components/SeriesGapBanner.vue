<script setup lang="ts">
import { computed } from 'vue'
import { AlertCircle } from 'lucide-vue-next'

const props = defineProps<{
  gaps: number[]
}>()

const gapsLabel = computed(() => props.gaps.map((g) => `#${g}`).join(', '))
</script>

<template>
  <div v-if="gaps.length > 0" class="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
    <AlertCircle :size="16" class="mt-0.5 shrink-0 text-muted-foreground" />
    <p class="text-xs text-muted-foreground"><span class="font-medium">Possible gaps:</span> {{ gapsLabel }}</p>
  </div>
</template>
