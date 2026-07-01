<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  value: boolean | null
  isReadOnly?: boolean
}>()

const emit = defineEmits<{
  save: [value: boolean | null]
}>()

function handleToggle() {
  if (props.isReadOnly) return
  // Tri-state cycle: null (unset) -> true -> false -> null
  if (props.value === null) emit('save', true)
  else if (props.value === true) emit('save', false)
  else emit('save', null)
}

function ariaLabel(): string {
  if (props.value === null) return t('book.table.boolean.ariaNotSet')
  return props.value ? t('book.table.boolean.ariaTrue') : t('book.table.boolean.ariaFalse')
}
</script>

<template>
  <div class="flex h-full w-full items-center px-1">
    <button
      type="button"
      class="flex h-5 w-5 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="[
        value === true
          ? 'border-primary bg-primary text-primary-foreground'
          : value === false
            ? 'border-border bg-background text-muted-foreground'
            : 'border-border/50 bg-background text-transparent opacity-40',
        isReadOnly ? 'cursor-default' : 'cursor-pointer hover:border-primary/70',
      ]"
      :aria-label="ariaLabel()"
      :aria-checked="value ?? 'mixed'"
      role="checkbox"
      :disabled="isReadOnly"
      @click.stop="handleToggle"
    >
      <svg v-if="value === true" viewBox="0 0 12 12" fill="none" class="h-3 w-3" aria-hidden="true">
        <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg v-else-if="value === false" viewBox="0 0 12 12" fill="none" class="h-3 w-3" aria-hidden="true">
        <path d="M3 6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>
