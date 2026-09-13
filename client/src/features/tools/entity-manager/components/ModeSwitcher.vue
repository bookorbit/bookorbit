<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

type Mode = 'duplicates' | 'browse'

defineProps<{ modelValue: Mode }>()
const emit = defineEmits<{ 'update:modelValue': [value: Mode] }>()

const { t } = useI18n()

const modes = computed<{ value: Mode; label: string }[]>(() => [
  { value: 'browse', label: t('tools.entityManager.modes.browse') },
  { value: 'duplicates', label: t('tools.entityManager.modes.duplicates') },
])

function handleSelect(value: Mode): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="inline-flex gap-0.5 rounded-lg bg-secondary p-0.5" role="group">
    <button
      v-for="m in modes"
      :key="m.value"
      type="button"
      class="h-7 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="modelValue === m.value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
      :aria-pressed="modelValue === m.value"
      @click="handleSelect(m.value)"
    >
      {{ m.label }}
    </button>
  </div>
</template>
