<script setup lang="ts">
import { Check, X } from '@lucide/vue'
import { ANNOTATION_COLOR_FILTER_OPTIONS } from '@bookorbit/types'

const colors = defineModel<string[]>('colors', { required: true })
const dateFrom = defineModel<string>('dateFrom', { required: true })
const dateTo = defineModel<string>('dateTo', { required: true })

const emit = defineEmits<{ clearAll: [] }>()

const COLOR_OPTIONS = ANNOTATION_COLOR_FILTER_OPTIONS
const FIELD_LABEL_CLASS = 'flex flex-col gap-1.5 text-xs font-medium text-muted-foreground'

function isSelected(hex: string): boolean {
  return colors.value.includes(hex)
}

function toggleColor(hex: string) {
  colors.value = isSelected(hex) ? colors.value.filter((value) => value !== hex) : [...colors.value, hex]
}

function clearDates() {
  dateFrom.value = ''
  dateTo.value = ''
}

function handleClearAll() {
  emit('clearAll')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div :class="FIELD_LABEL_CLASS">
      <span>Colors</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="option in COLOR_OPTIONS"
          :key="option.hex"
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-full border-2 transition-transform hover:scale-110"
          :class="isSelected(option.hex) ? 'border-foreground' : 'border-transparent'"
          :style="{ background: option.hex }"
          :title="option.label"
          :aria-label="option.label"
          :aria-pressed="isSelected(option.hex)"
          @click="toggleColor(option.hex)"
        >
          <Check v-if="isSelected(option.hex)" :size="12" class="text-white drop-shadow" />
        </button>
      </div>
    </div>

    <div :class="FIELD_LABEL_CLASS">
      <span>Date range</span>
      <div class="flex items-center gap-1.5">
        <input
          v-model="dateFrom"
          type="date"
          aria-label="From date"
          class="h-9 min-w-0 flex-1 px-2 rounded-md border border-border bg-background text-sm"
        />
        <span class="text-xs text-muted-foreground">to</span>
        <input
          v-model="dateTo"
          type="date"
          aria-label="To date"
          class="h-9 min-w-0 flex-1 px-2 rounded-md border border-border bg-background text-sm"
        />
        <button
          v-if="dateFrom || dateTo"
          type="button"
          aria-label="Clear date range"
          class="inline-flex h-9 items-center rounded-md border border-border bg-background px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="clearDates"
        >
          <X :size="13" />
        </button>
      </div>
    </div>

    <slot name="extra" />

    <div class="flex justify-end border-t border-border pt-3">
      <button type="button" class="text-sm text-muted-foreground transition-colors hover:text-foreground" @click="handleClearAll">Clear all</button>
    </div>
  </div>
</template>
