<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CoverMedium } from '@bookorbit/types'
import { nextRovingIndex } from '@/lib/roving-index'

const props = defineProps<{ modelValue: CoverMedium; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: CoverMedium] }>()

const { t } = useI18n()

const options = computed(() => [
  { value: 'ebook' as const, label: t('book.detail.coverLightbox.ebook') },
  { value: 'audio' as const, label: t('book.detail.coverLightbox.audio') },
])

const group = ref<HTMLElement | null>(null)

function select(value: CoverMedium) {
  emit('update:modelValue', value)
}

function handleKeydown(event: KeyboardEvent) {
  const index = options.value.findIndex((option) => option.value === props.modelValue)
  const next = nextRovingIndex(event.key, index, options.value.length)
  if (next === null) return
  event.preventDefault()
  const value = options.value[next]!.value
  select(value)
  void nextTick(() => group.value?.querySelector<HTMLButtonElement>(`[data-medium="${value}"]`)?.focus())
}
</script>

<template>
  <div
    ref="group"
    role="radiogroup"
    :aria-label="props.label"
    class="inline-flex gap-0.5 rounded-md border border-border bg-muted p-0.5"
    @keydown="handleKeydown"
  >
    <button
      v-for="option in options"
      :key="option.value"
      :data-medium="option.value"
      type="button"
      role="radio"
      :aria-checked="props.modelValue === option.value"
      :tabindex="props.modelValue === option.value ? 0 : -1"
      class="inline-flex h-7 items-center rounded px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      :class="
        props.modelValue === option.value
          ? 'bg-background font-semibold text-foreground shadow-xs'
          : 'font-medium text-muted-foreground hover:text-foreground'
      "
      @click="select(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
