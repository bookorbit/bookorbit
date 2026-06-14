<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { COLOR_OPTIONS, ORIGIN_OPTIONS, STYLE_OPTIONS } from '../lib/filter-options'

const color = defineModel<string>('color', { required: true })
const highlightStyle = defineModel<string>('highlightStyle', { required: true })
const origin = defineModel<string>('origin', { required: true })
const dateFrom = defineModel<string>('dateFrom', { required: true })
const dateTo = defineModel<string>('dateTo', { required: true })

const emit = defineEmits<{ clearAll: [] }>()

const SELECT_CLASS = 'h-9 w-full px-2 rounded-md border border-border bg-background text-sm'
const FIELD_LABEL_CLASS = 'flex flex-col gap-1 text-xs font-medium text-muted-foreground'

const hasActive = computed(
  () => color.value !== 'all' || highlightStyle.value !== 'all' || origin.value !== 'all' || Boolean(dateFrom.value) || Boolean(dateTo.value),
)

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
    <label :class="FIELD_LABEL_CLASS">
      Color
      <select v-model="color" :class="SELECT_CLASS">
        <option v-for="option in COLOR_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </label>
    <label :class="FIELD_LABEL_CLASS">
      Style
      <select v-model="highlightStyle" :class="SELECT_CLASS">
        <option v-for="option in STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </label>
    <label :class="FIELD_LABEL_CLASS">
      Source
      <select v-model="origin" :class="SELECT_CLASS">
        <option v-for="option in ORIGIN_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </label>
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
    <div class="flex justify-end border-t border-border pt-3">
      <button
        type="button"
        :disabled="!hasActive"
        class="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        @click="handleClearAll"
      >
        Clear all
      </button>
    </div>
  </div>
</template>
