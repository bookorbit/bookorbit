<script setup lang="ts">
import { Headphones } from '@lucide/vue'
import { BOOK_FORMATS, isReadAlongFormatKey, withReadAlongFormatPriority } from '@bookorbit/types'
import { formatKeyCode, formatKeyName } from '@/features/book/lib/book-formats'

const props = defineProps<{
  modelValue: string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const formatKeys = withReadAlongFormatPriority(BOOK_FORMATS)

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
      v-for="format in formatKeys"
      :key="format"
      type="button"
      :aria-label="formatKeyName(format)"
      :title="formatKeyName(format)"
      class="h-7 px-2.5 rounded-md border text-xs font-medium uppercase tracking-wide transition-colors"
      :class="
        modelValue.includes(format)
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-input bg-background text-muted-foreground hover:text-foreground hover:border-foreground/40'
      "
      @click="toggle(format)"
    >
      {{ formatKeyCode(format) }}
      <Headphones v-if="isReadAlongFormatKey(format)" class="ms-1 inline size-3" aria-hidden="true" />
    </button>
  </div>
</template>
