<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownAZ, ArrowUpAZ, ChevronDown, ChevronUp, Plus, Trash2 } from '@lucide/vue'
import type { SortField, SortSpec } from '@bookorbit/types'
import { SORT_FIELDS } from '@bookorbit/types'
import { SORT_FIELD_LABELS } from '@/features/book/lib/filter-labels'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  modelValue: SortSpec[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SortSpec[]]
}>()

const usedFields = computed(() => new Set(props.modelValue.map((s) => s.field)))

function availableFields(currentField: SortField): SortField[] {
  return SORT_FIELDS.filter((f) => f === currentField || !usedFields.value.has(f))
}

function updateField(index: number, field: SortField) {
  emit(
    'update:modelValue',
    props.modelValue.map((s, i) => (i === index ? { ...s, field } : s)),
  )
}

function toggleDir(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.map((s, i) => (i === index ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s)),
  )
}

function move(index: number, dir: -1 | 1) {
  const next = [...props.modelValue]
  const target = index + dir
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  emit('update:modelValue', next)
}

function remove(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}

function addTier() {
  const nextField = SORT_FIELDS.find((f) => !usedFields.value.has(f))
  if (!nextField) return
  emit('update:modelValue', [...props.modelValue, { field: nextField, dir: 'asc' }])
}

const canAddMore = computed(() => props.modelValue.length < SORT_FIELDS.length)
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-for="(spec, index) in modelValue" :key="index" class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div class="flex flex-col shrink-0">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              @click="move(index, -1)"
              :disabled="index === 0"
              class="h-5 w-5 flex items-center justify-center rounded text-foreground/60 hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronUp :size="14" stroke-width="2.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.sort.moveUp') }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              @click="move(index, 1)"
              :disabled="index === modelValue.length - 1"
              class="h-5 w-5 flex items-center justify-center rounded text-foreground/60 hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronDown :size="14" stroke-width="2.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.sort.moveDown') }}</TooltipContent>
        </Tooltip>
      </div>
      <select
        :value="spec.field"
        @change="updateField(index, ($event.target as HTMLSelectElement).value as SortField)"
        class="flex-1 h-8 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option v-for="field in availableFields(spec.field)" :key="field" :value="field">
          {{ SORT_FIELD_LABELS[field] }}
        </option>
      </select>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            @click="toggleDir(index)"
            class="h-8 w-8 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <ArrowDownAZ v-if="spec.dir === 'asc'" :size="15" />
            <ArrowUpAZ v-else :size="15" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ spec.dir === 'asc' ? t('book.sort.ascending') : t('book.sort.descending') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            @click="remove(index)"
            class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
          >
            <Trash2 :size="13" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('book.sort.remove') }}</TooltipContent>
      </Tooltip>
    </div>

    <p v-if="modelValue.length === 0" class="text-sm text-muted-foreground">{{ t('book.sort.emptyState') }}</p>

    <button
      v-if="canAddMore"
      @click="addTier"
      class="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-dashed border-input text-sm text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-muted/30 transition-colors self-start"
    >
      <Plus :size="13" />
      {{ t('book.sort.addLevel') }}
    </button>
  </div>
</template>
