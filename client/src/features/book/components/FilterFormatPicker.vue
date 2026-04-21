<script setup lang="ts">
import { BOOK_FORMATS } from '@bookorbit/types'

const props = defineProps<{
  modelValue: string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

function toggle(format: string) {
  if (props.modelValue.includes(format)) {
    emit(
      'update:modelValue',
      props.modelValue.filter((f) => f !== format),
    )
  } else {
    emit('update:modelValue', [...props.modelValue, format])
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1">
    <button
      v-for="format in BOOK_FORMATS"
      :key="format"
      type="button"
      class="h-7 px-2.5 rounded-md border text-xs font-medium uppercase tracking-wide transition-colors"
      :class="
        modelValue.includes(format)
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-input bg-background text-muted-foreground hover:text-foreground hover:border-foreground/40'
      "
      @click="toggle(format)"
    >
      {{ format }}
    </button>
  </div>
</template>
