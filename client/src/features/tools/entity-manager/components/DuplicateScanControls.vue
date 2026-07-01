<script setup lang="ts">
import { Loader2, Search } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  minSimilarity: number
  scanning: boolean
}>()

const emit = defineEmits<{
  'update:minSimilarity': [value: number]
  scan: []
}>()

function handleSimilarityChange(event: Event): void {
  emit('update:minSimilarity', Number((event.target as HTMLInputElement).value))
}

function handleScan(): void {
  emit('scan')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-4">
    <div class="flex items-center gap-2">
      <label class="text-sm text-muted-foreground whitespace-nowrap">{{ t('tools.entityManager.duplicates.similarity') }}</label>
      <input type="range" :value="minSimilarity" min="0.1" max="1.0" step="0.05" class="w-32 accent-primary" @input="handleSimilarityChange" />
      <span class="text-sm font-mono text-muted-foreground w-10 text-right">{{ (minSimilarity * 100).toFixed(0) }}%</span>
    </div>

    <button
      class="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
      :disabled="scanning"
      @click="handleScan"
    >
      <Loader2 v-if="scanning" class="h-4 w-4 animate-spin" />
      <Search v-else class="h-4 w-4" />
      {{ scanning ? t('tools.entityManager.duplicates.scanning') : t('tools.entityManager.duplicates.scan') }}
    </button>
  </div>
</template>
