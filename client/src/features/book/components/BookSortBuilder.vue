<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Plus, X } from '@lucide/vue'
import type { SortField, SortSpec } from '@bookorbit/types'
import { useSortFields } from '@/features/book/composables/useSortFields'
import { DEFAULT_SORT, copySort } from '@/features/book/lib/sort-defaults'
import { MAX_SORT_LEVELS, withLeadField } from '@/features/book/lib/sort-fields'
import FieldPickerPopover from './sort-filter/FieldPickerPopover.vue'
import SortOrderSegment from './sort-filter/SortOrderSegment.vue'
import { ghostButton, iconButton } from './sort-filter/filter-styles'

/**
 * A saved sort as one sentence: "Sort by Title, A to Z, then by Author". With no sort saved it
 * reads as the default, and the first change makes that sort the saved one.
 */
const props = withDefaults(
  defineProps<{
    modelValue: SortSpec[]
    /** Set when the builder sits inside a collection view, which is the only place a sort may order by collection membership. */
    collectionScoped?: boolean
    /** The sort an empty model stands for. */
    defaultSort?: SortSpec[]
  }>(),
  { collectionScoped: false, defaultSort: () => DEFAULT_SORT },
)

const emit = defineEmits<{
  'update:modelValue': [value: SortSpec[]]
}>()

const { t } = useI18n()
const { groups, kindOf, iconOf, labelOf, directionLabel, naturalDirectionOf } = useSortFields({ collectionScoped: () => props.collectionScoped })

/** The field picker that is open: `lead`, `add`, or `level:<index>`. */
const openPicker = ref<string | null>(null)

const effectiveSort = computed<SortSpec[]>(() => (props.modelValue.length > 0 ? props.modelValue : copySort(props.defaultSort)))
const lead = computed<SortSpec>(() => effectiveSort.value[0] ?? DEFAULT_SORT[0]!)
const leadKind = computed(() => kindOf(lead.value.field))
const levels = computed(() => effectiveSort.value.slice(1))
const usedFields = computed(() => effectiveSort.value.map((spec) => spec.field))
const otherFields = computed(() => usedFields.value.slice(1))
const canAddLevel = computed(() => leadKind.value !== 'random' && effectiveSort.value.length < MAX_SORT_LEVELS)

function update(next: SortSpec[]) {
  emit('update:modelValue', next)
}

function levelKey(index: number) {
  return `level:${index}`
}

function setPicker(key: string, open: boolean) {
  openPicker.value = open ? key : null
}

function handleLeadOpen(open: boolean) {
  setPicker('lead', open)
}

function handleAddOpen(open: boolean) {
  setPicker('add', open)
}

function handleLevelOpen(index: number, open: boolean) {
  setPicker(levelKey(index), open)
}

function handlePickLead(field: SortField) {
  update(withLeadField(effectiveSort.value, field, kindOf(field)))
}

function handleLeadDirection(dir: SortSpec['dir']) {
  update([{ ...lead.value, dir }, ...levels.value])
}

function handleLevelPick(index: number, field: SortField) {
  update(effectiveSort.value.map((spec, i) => (i === index + 1 ? { field, dir: naturalDirectionOf(field) } : spec)))
}

function toggleLevel(index: number) {
  update(effectiveSort.value.map((spec, i) => (i === index + 1 ? { ...spec, dir: spec.dir === 'asc' ? 'desc' : 'asc' } : spec)))
}

function removeLevel(index: number) {
  update(effectiveSort.value.filter((_, i) => i !== index + 1))
}

function handleAddLevel(field: SortField) {
  update([...effectiveSort.value, { field, dir: naturalDirectionOf(field) }])
}

function levelExclude(index: number) {
  return usedFields.value.filter((_, i) => i !== index + 1)
}

const fieldButton = `${ghostButton} -ms-1 font-semibold`
</script>

<template>
  <div class="grid gap-0.5" data-testid="sort-sentence">
    <div class="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span class="w-[52px] shrink-0 text-[13px] text-muted-foreground">{{ t('book.sort.sentenceSortBy') }}</span>
      <FieldPickerPopover
        :open="openPicker === 'lead'"
        :groups="groups"
        :selected="lead.field"
        :exclude="otherFields"
        :title="t('book.sort.changeField')"
        :placeholder="t('book.sort.findField')"
        :search-label="t('book.sort.findFieldAria')"
        :list-label="t('book.sort.sortByList')"
        @update:open="handleLeadOpen"
        @pick="handlePickLead"
      >
        <template #trigger>
          <button type="button" :class="fieldButton" aria-haspopup="dialog" :aria-label="`${t('book.sort.changeField')}: ${labelOf(lead.field)}`">
            <component :is="iconOf(lead.field)" :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            {{ labelOf(lead.field) }}
            <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </template>
      </FieldPickerPopover>
      <span class="flex-1" />
      <SortOrderSegment
        v-if="leadKind !== 'random'"
        class="w-[220px] max-sm:w-full"
        :model-value="lead.dir"
        :asc-label="directionLabel(lead.field, 'asc')"
        :desc-label="directionLabel(lead.field, 'desc')"
        :label="t('book.sort.orderFor', { field: labelOf(lead.field) })"
        @update:model-value="handleLeadDirection"
      />
    </div>

    <div v-for="(level, index) in levels" :key="level.field" class="flex min-h-9 items-center gap-2" data-testid="sort-sentence-level">
      <span class="w-[52px] shrink-0 text-[13px] text-muted-foreground">{{ t('book.sort.sentenceThenBy') }}</span>
      <FieldPickerPopover
        :open="openPicker === levelKey(index)"
        :groups="groups"
        :selected="level.field"
        :exclude="levelExclude(index)"
        :title="t('book.sort.changeField')"
        :placeholder="t('book.sort.findField')"
        :search-label="t('book.sort.findFieldAria')"
        :list-label="t('book.sort.thenBy')"
        @update:open="handleLevelOpen(index, $event)"
        @pick="handleLevelPick(index, $event)"
      >
        <template #trigger>
          <button
            type="button"
            :class="fieldButton"
            class="min-w-0"
            aria-haspopup="dialog"
            :aria-label="`${t('book.sort.changeField')}: ${labelOf(level.field)}`"
          >
            <component :is="iconOf(level.field)" :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="truncate">{{ labelOf(level.field) }}</span>
            <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </template>
      </FieldPickerPopover>
      <span class="flex-1" />
      <button
        v-if="directionLabel(level.field, level.dir)"
        type="button"
        class="inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2 text-[11.5px] font-semibold whitespace-nowrap text-foreground transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        :aria-label="t('book.sort.switchLevelOrder', { field: labelOf(level.field), order: directionLabel(level.field, level.dir) })"
        @click="toggleLevel(index)"
      >
        {{ directionLabel(level.field, level.dir) }}
      </button>
      <button type="button" :class="iconButton" :aria-label="t('book.sort.removeLevel', { field: labelOf(level.field) })" @click="removeLevel(index)">
        <X :size="14" aria-hidden="true" />
      </button>
    </div>

    <div v-if="canAddLevel" class="flex min-h-8 items-center">
      <FieldPickerPopover
        :open="openPicker === 'add'"
        :groups="groups"
        :exclude="usedFields"
        :title="t('book.sort.thenBy')"
        :placeholder="t('book.sort.findField')"
        :search-label="t('book.sort.findThenByAria')"
        :list-label="t('book.sort.thenBy')"
        @update:open="handleAddOpen"
        @pick="handleAddLevel"
      >
        <template #trigger>
          <button type="button" :class="ghostButton" class="-ms-2 text-muted-foreground hover:text-foreground" aria-haspopup="dialog">
            <Plus :size="13" aria-hidden="true" />
            {{ t('book.sort.thenByEllipsis') }}
          </button>
        </template>
      </FieldPickerPopover>
    </div>
  </div>
</template>
