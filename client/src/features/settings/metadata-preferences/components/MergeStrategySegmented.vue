<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronsDown, CircleDashed, Download } from '@lucide/vue'
import type { MergeStrategy } from '@bookorbit/types'

const { t } = useI18n()

defineProps<{ modelValue: MergeStrategy; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: MergeStrategy] }>()

const ICONS = { fillMissing: CircleDashed, overwriteIfProvided: Download, overwrite: ChevronsDown } as const

// Order the segments least to most destructive so the control reads as a dial.
const ORDER: MergeStrategy[] = ['fillMissing', 'overwriteIfProvided', 'overwrite']

const options = computed(() =>
  ORDER.map((value) => ({
    value,
    icon: ICONS[value],
    short: t(`settings.metadata.mergeStrategy.${value}.short`),
    label: t(`settings.metadata.mergeStrategy.${value}.label`),
    description: t(`settings.metadata.mergeStrategy.${value}.description`),
  })),
)

function select(value: MergeStrategy) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="t('settings.metadata.fieldRules.table.mergeStrategy')"
    class="inline-flex min-w-0 gap-0.5 rounded-md border border-input bg-muted p-0.5"
    :class="disabled ? 'opacity-50' : ''"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      :aria-label="`${option.label}. ${option.description}`"
      :title="`${option.label} - ${option.description}`"
      :disabled="disabled"
      class="inline-flex h-6 min-w-0 items-center gap-1.5 rounded px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed"
      :class="
        modelValue === option.value
          ? 'bg-background font-semibold text-foreground shadow-xs'
          : 'font-medium text-muted-foreground hover:text-foreground'
      "
      @click="select(option.value)"
    >
      <component :is="option.icon" :size="13" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ option.short }}</span>
    </button>
  </div>
</template>
