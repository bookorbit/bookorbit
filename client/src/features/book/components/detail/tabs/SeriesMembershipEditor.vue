<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/vue'
import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import type { EditableSeriesMembership } from '../../../composables/useMetadataEditor'

const props = defineProps<{
  modelValue: EditableSeriesMembership[]
  searchFn: (q: string) => Promise<string[]>
  disabled?: boolean
}>()

const { t } = useI18n()

const emit = defineEmits<{ 'update:modelValue': [EditableSeriesMembership[]] }>()

const visibleMemberships = computed<EditableSeriesMembership[]>(() =>
  props.modelValue.length > 0 ? props.modelValue : [{ seriesName: '', seriesIndex: null }],
)

const rowKeys = ref<string[]>([])
let nextRowKey = 0

function createRowKey() {
  nextRowKey += 1
  return `series-membership-${nextRowKey}`
}

function syncRowKeys() {
  const visibleLength = Math.max(1, props.modelValue.length)
  if (rowKeys.value.length < visibleLength) {
    rowKeys.value = [...rowKeys.value, ...Array.from({ length: visibleLength - rowKeys.value.length }, () => createRowKey())]
    return
  }
  if (rowKeys.value.length > visibleLength) {
    rowKeys.value = rowKeys.value.slice(0, visibleLength)
  }
}

watch(() => props.modelValue.length, syncRowKeys, { immediate: true })

function getRowKey(index: number) {
  return rowKeys.value[index] ?? `series-membership-fallback-${index}`
}

function updateMembership(index: number, patch: Partial<EditableSeriesMembership>) {
  if (props.disabled) return
  if (props.modelValue.length === 0 && index === 0) {
    emit('update:modelValue', [{ seriesName: '', seriesIndex: null, ...patch }])
    return
  }
  const next = props.modelValue.map((membership, i) => (i === index ? { ...membership, ...patch } : membership))
  emit('update:modelValue', next)
}

function updateSeriesName(index: number, value: string | null) {
  updateMembership(index, { seriesName: value ?? '' })
}

function updateSeriesIndex(index: number, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  updateMembership(index, { seriesIndex: raw === '' ? null : Number.parseFloat(raw) })
}

function addMembership() {
  if (props.disabled) return
  if (props.modelValue.length > 0) {
    rowKeys.value = [...rowKeys.value, createRowKey()]
  }
  emit('update:modelValue', [...props.modelValue, { seriesName: '', seriesIndex: null }])
}

function removeMembership(index: number) {
  if (props.disabled) return
  const next = props.modelValue.filter((_, i) => i !== index)
  rowKeys.value = next.length > 0 ? rowKeys.value.filter((_, i) => i !== index) : [createRowKey()]
  emit('update:modelValue', next)
}

function moveMembership(index: number, offset: -1 | 1) {
  if (props.disabled) return
  const target = index + offset
  if (target < 0 || target >= props.modelValue.length) return
  const next = [...props.modelValue]
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(target, 0, item)
  const nextKeys = [...rowKeys.value]
  const [key] = nextKeys.splice(index, 1)
  if (key) {
    nextKeys.splice(target, 0, key)
    rowKeys.value = nextKeys
  }
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(membership, index) in visibleMemberships"
      :key="getRowKey(index)"
      class="grid grid-cols-[2rem_minmax(0,1fr)_5.5rem_auto] items-center gap-2"
    >
      <button
        v-if="index === 0"
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        :disabled="disabled"
        :title="t('book.detail.seriesMembership.addSeries')"
        @click="addMembership"
      >
        <Plus class="size-3.5" />
      </button>
      <div v-else class="h-8 w-8" aria-hidden="true" />

      <InputWithSuggestions
        :model-value="membership.seriesName"
        :search-fn="searchFn"
        :disabled="disabled"
        :placeholder="t('book.detail.seriesMembership.seriesPlaceholder')"
        :class="'h-8 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'"
        @update:model-value="updateSeriesName(index, $event)"
      />
      <input
        :value="membership.seriesIndex ?? ''"
        type="number"
        step="0.1"
        min="0"
        class="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none transition-shadow focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="disabled"
        placeholder="#"
        @input="updateSeriesIndex(index, $event)"
      />
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          :disabled="disabled || index === 0"
          :title="t('book.detail.seriesMembership.moveUp')"
          @click="moveMembership(index, -1)"
        >
          <ArrowUp class="size-3.5" />
        </button>
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          :disabled="disabled || modelValue.length < 2 || index === visibleMemberships.length - 1"
          :title="t('book.detail.seriesMembership.moveDown')"
          @click="moveMembership(index, 1)"
        >
          <ArrowDown class="size-3.5" />
        </button>
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
          :disabled="disabled || modelValue.length === 0"
          :title="t('book.detail.seriesMembership.removeSeries')"
          @click="removeMembership(index)"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
