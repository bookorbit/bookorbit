<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronDown, SlidersHorizontal } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const SIMILARITY_OPTIONS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const

defineProps<{ minSimilarity: number; disabled: boolean }>()

const emit = defineEmits<{ 'update:minSimilarity': [value: number] }>()

const { t } = useI18n()

function percent(value: number): string {
  return String(Math.round(value * 100))
}

function handleSelect(value: number): void {
  emit('update:minSimilarity', value)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="disabled"
        :aria-label="t('tools.entityManager.duplicates.thresholdLabel')"
      >
        <SlidersHorizontal :size="13" class="text-muted-foreground" aria-hidden="true" />
        {{ t('tools.entityManager.duplicates.thresholdValue', { percent: percent(minSimilarity) }) }}
        <ChevronDown :size="13" class="text-muted-foreground" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-28">
      <DropdownMenuItem v-for="option in SIMILARITY_OPTIONS" :key="option" @click="handleSelect(option)">
        {{ t('tools.entityManager.duplicates.thresholdValue', { percent: percent(option) }) }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
