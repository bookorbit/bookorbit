<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-vue-next'
import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import type { EditableSeriesMembership } from '../../../composables/useMetadataEditor'

const props = defineProps<{
  modelValue: EditableSeriesMembership[]
  searchFn: (q: string) => Promise<string[]>
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [EditableSeriesMembership[]] }>()

const visibleMemberships = computed<EditableSeriesMembership[]>(() =>
  props.modelValue.length > 0 ? props.modelValue : [{ seriesName: '', seriesIndex: null }],
)

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
  emit('update:modelValue', [...props.modelValue, { seriesName: '', seriesIndex: null }])
}

function removeMembership(index: number) {
  if (props.disabled) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}

function moveMembership(index: number, offset: -1 | 1) {
  if (props.disabled) return
  const target = index + offset
  if (target < 0 || target >= props.modelValue.length) return
  const next = [...props.modelValue]
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(target, 0, item)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(membership, index) in visibleMemberships"
      :key="modelValue.length === 0 ? 'empty-series-row' : `${index}:${membership.seriesName}`"
      class="grid grid-cols-[2rem_minmax(0,1fr)_5.5rem_auto] items-center gap-2"
    >
      <button
        v-if="index === 0"
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        :disabled="disabled"
        title="Add series"
        @click="addMembership"
      >
        <Plus class="size-3.5" />
      </button>
      <div v-else class="h-8 w-8" aria-hidden="true" />

      <InputWithSuggestions
        :model-value="membership.seriesName"
        :search-fn="searchFn"
        :disabled="disabled"
        placeholder="Series"
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
          title="Move up"
          @click="moveMembership(index, -1)"
        >
          <ArrowUp class="size-3.5" />
        </button>
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          :disabled="disabled || modelValue.length < 2 || index === visibleMemberships.length - 1"
          title="Move down"
          @click="moveMembership(index, 1)"
        >
          <ArrowDown class="size-3.5" />
        </button>
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
          :disabled="disabled || modelValue.length === 0"
          title="Remove series"
          @click="removeMembership(index)"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
