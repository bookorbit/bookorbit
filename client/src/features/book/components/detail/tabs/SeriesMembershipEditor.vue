<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Check, ChevronDown, Plus, Trash2 } from '@lucide/vue'
import { isValidSeriesIndex, parseSeriesUnit, SERIES_INDEX_MAX_LENGTH, type SeriesUnit } from '@bookorbit/types'
import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { EditableSeriesMembership } from '../../../composables/useMetadataEditor'

const props = defineProps<{
  modelValue: EditableSeriesMembership[]
  searchFn: (q: string) => Promise<string[]>
  disabled?: boolean
  /** Shows the Kind menu. Off where several books are edited at once, which keep their own units. */
  unitEditable?: boolean
}>()

const { t } = useI18n()

const emit = defineEmits<{ 'update:modelValue': [EditableSeriesMembership[]] }>()

const NO_UNIT = 'none'

function emptyMembership(): EditableSeriesMembership {
  return props.unitEditable
    ? { seriesName: '', seriesIndex: null, expectedBookCount: null, unit: null }
    : { seriesName: '', seriesIndex: null, expectedBookCount: null }
}

const visibleMemberships = computed<EditableSeriesMembership[]>(() => (props.modelValue.length > 0 ? props.modelValue : [emptyMembership()]))

const unitOptions = computed<{ value: SeriesUnit | typeof NO_UNIT; label: string }[]>(() => [
  { value: NO_UNIT, label: t('book.detail.seriesMembership.kindNone') },
  { value: 'volume', label: t('book.detail.seriesMembership.kindVolume') },
  { value: 'chapter', label: t('book.detail.seriesMembership.kindChapter') },
  { value: 'issue', label: t('book.detail.seriesMembership.kindIssue') },
])

function unitLabel(unit: SeriesUnit | null | undefined): string {
  return unitOptions.value.find((option) => option.value === (unit ?? NO_UNIT))?.label ?? t('book.detail.seriesMembership.kindNone')
}

function unitButtonLabel(unit: SeriesUnit | null | undefined): string {
  return t('book.detail.seriesMembership.kindButtonLabel', { kind: unitLabel(unit) })
}

function isUnitSelected(membership: EditableSeriesMembership, value: SeriesUnit | typeof NO_UNIT): boolean {
  return (membership.unit ?? NO_UNIT) === value
}

const idPrefix = useId()

function unitHintId(index: number): string {
  return `${idPrefix}-${getRowKey(index)}-unit-hint`
}

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
    emit('update:modelValue', [{ ...emptyMembership(), ...patch }])
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
  updateMembership(index, { seriesIndex: raw === '' ? null : raw })
}

function updateUnit(index: number, value: unknown) {
  updateMembership(index, { unit: parseSeriesUnit(value) })
}

function isSeriesIndexInvalid(value: string | null) {
  return value !== null && !isValidSeriesIndex(value)
}

function updateExpectedBookCount(index: number, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const parsed = Number.parseInt(raw, 10)
  updateMembership(index, { expectedBookCount: raw === '' || Number.isNaN(parsed) ? null : parsed })
}

function addMembership() {
  if (props.disabled) return
  if (props.modelValue.length > 0) {
    rowKeys.value = [...rowKeys.value, createRowKey()]
  }
  emit('update:modelValue', [...props.modelValue, emptyMembership()])
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
    <div v-for="(membership, index) in visibleMemberships" :key="getRowKey(index)" class="flex flex-wrap items-center gap-2">
      <button
        v-if="index === 0"
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        :disabled="disabled"
        :title="t('book.detail.seriesMembership.addSeries')"
        @click="addMembership"
      >
        <Plus class="size-3.5" />
      </button>
      <div v-else class="h-8 w-8 shrink-0" aria-hidden="true" />

      <InputWithSuggestions
        :model-value="membership.seriesName"
        :search-fn="searchFn"
        :disabled="disabled"
        :placeholder="t('book.detail.seriesMembership.seriesPlaceholder')"
        :class="'h-8 min-w-24 flex-[3_1_12rem] rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'"
        @update:model-value="updateSeriesName(index, $event)"
      />
      <div class="flex flex-wrap items-center gap-2">
        <DropdownMenu v-if="unitEditable">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              data-testid="series-unit-menu"
              class="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-input bg-background ps-2.5 pe-1.5 text-sm text-foreground outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="disabled"
              :aria-label="unitButtonLabel(membership.unit)"
              :title="t('book.detail.seriesMembership.kindLabel')"
            >
              {{ unitLabel(membership.unit) }}
              <ChevronDown class="size-3.5 text-muted-foreground" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-44" :aria-describedby="unitHintId(index)">
            <DropdownMenuRadioGroup :model-value="membership.unit ?? NO_UNIT" @update:model-value="updateUnit(index, $event)">
              <DropdownMenuRadioItem
                v-for="option in unitOptions"
                :key="option.value"
                :value="option.value"
                class="justify-between pl-2 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
              >
                <!-- The check is drawn at the end, so the built-in start indicator gets an empty node instead of its dot. -->
                <template #indicator-icon><span /></template>
                {{ option.label }}
                <Check v-if="isUnitSelected(membership, option.value)" class="size-3.5" aria-hidden="true" />
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <p :id="unitHintId(index)" class="mx-1 mt-1 border-t border-border px-1 pt-1.5 pb-0.5 text-[11px] leading-snug text-muted-foreground">
              {{ t('book.detail.seriesMembership.kindNoneHint') }}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          :value="membership.seriesIndex ?? ''"
          type="text"
          inputmode="decimal"
          :maxlength="SERIES_INDEX_MAX_LENGTH"
          class="h-8 min-w-14 max-w-16 flex-1 rounded-lg border border-input bg-background px-2 text-sm outline-none transition-shadow focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          :class="isSeriesIndexInvalid(membership.seriesIndex) ? 'border-destructive' : ''"
          :disabled="disabled"
          placeholder="#"
          :aria-label="t('book.detail.seriesMembership.seriesIndexLabel')"
          :aria-invalid="isSeriesIndexInvalid(membership.seriesIndex)"
          @input="updateSeriesIndex(index, $event)"
        />
        <input
          :value="membership.expectedBookCount ?? ''"
          type="number"
          step="1"
          min="1"
          class="h-8 min-w-14 max-w-16 flex-1 rounded-lg border border-input bg-background px-2 text-sm outline-none transition-shadow focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="disabled"
          :placeholder="t('book.detail.seriesMembership.totalPlaceholder')"
          :aria-label="t('book.detail.seriesMembership.totalLabel')"
          :title="t('book.detail.seriesMembership.totalHint')"
          @input="updateExpectedBookCount(index, $event)"
        />
        <div class="flex items-center gap-1">
          <button
            v-if="visibleMemberships.length > 1"
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            :disabled="disabled || index === 0"
            :title="t('book.detail.seriesMembership.moveUp')"
            @click="moveMembership(index, -1)"
          >
            <ArrowUp class="size-3.5" />
          </button>
          <button
            v-if="visibleMemberships.length > 1"
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            :disabled="disabled || modelValue.length < 2 || index === visibleMemberships.length - 1"
            :title="t('book.detail.seriesMembership.moveDown')"
            @click="moveMembership(index, 1)"
          >
            <ArrowDown class="size-3.5" />
          </button>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
            :disabled="disabled || modelValue.length === 0"
            :title="t('book.detail.seriesMembership.removeSeries')"
            @click="removeMembership(index)"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
      </div>
      <p v-if="isSeriesIndexInvalid(membership.seriesIndex)" class="w-full ps-10 text-xs text-destructive" role="alert">
        {{ t('book.detail.seriesMembership.invalidSeriesIndex') }}
      </p>
    </div>
  </div>
</template>
