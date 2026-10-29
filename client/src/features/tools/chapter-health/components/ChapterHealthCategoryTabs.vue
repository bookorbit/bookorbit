<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHAPTER_HEALTH_CATEGORIES, type ChapterHealthCategory, type ChapterHealthSummary } from '@bookorbit/types'

import { formatNumber } from '@/i18n/formatters'

const props = defineProps<{ modelValue: ChapterHealthCategory; summary: ChapterHealthSummary | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: ChapterHealthCategory] }>()

const { t } = useI18n()

const tabs = computed(() =>
  CHAPTER_HEALTH_CATEGORIES.map((value) => ({
    value,
    label: t(`tools.chapterHealth.categories.${value}`),
    count: props.summary ? formatNumber(props.summary.counts[value]) : '-',
  })),
)

function handleSelect(value: ChapterHealthCategory): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="flex flex-wrap gap-1 rounded-lg border border-border p-0.5" role="tablist" :aria-label="t('tools.chapterHealth.categoriesLabel')">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.value"
      class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="modelValue === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
      @click="handleSelect(tab.value)"
    >
      <span>{{ tab.label }}</span>
      <span
        class="rounded-full px-1.5 py-0.5 text-xs tabular-nums"
        :class="modelValue === tab.value ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground'"
      >
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>
