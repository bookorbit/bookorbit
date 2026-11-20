<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, GripVertical, Plus, RotateCcw, Shuffle, X } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { SortField, SortSpec } from '@bookorbit/types'
import { useSortFields } from '@/features/book/composables/useSortFields'
import { DEFAULT_SORT, copySort, sortsEqual } from '@/features/book/lib/sort-defaults'
import { MAX_SORT_LEVELS, withLeadField } from '@/features/book/lib/sort-fields'
import FieldListbox from './FieldListbox.vue'
import SortOrderSegment from './SortOrderSegment.vue'

/**
 * The bar's sort, as one panel that stays open: the order in words on top, every field in a
 * searchable grouped list, and extra levels in a short footer. Picking a field re-sorts at once
 * in that field's natural order, so trying a few orders never means reopening anything.
 */
const props = withDefaults(
  defineProps<{
    modelValue: SortSpec[]
    defaultSort?: SortSpec[]
    collectionScoped?: boolean
    /** Limits the list to these fields, for pages that sort by only a few. */
    only?: SortField[]
    labels?: Partial<Record<SortField, string>>
    /** Offers "Then by…" levels. */
    multi?: boolean
  }>(),
  { defaultSort: () => DEFAULT_SORT, collectionScoped: false, only: undefined, labels: undefined, multi: true },
)

const emit = defineEmits<{
  'update:modelValue': [value: SortSpec[]]
  shuffle: []
}>()

const { t } = useI18n()
const { groups, fieldCount, kindOf, iconOf, labelOf, directionLabel, naturalDirectionOf } = useSortFields({
  collectionScoped: () => props.collectionScoped,
  only: () => props.only,
  labels: () => props.labels,
})

const mode = ref<'main' | 'then'>('main')

const effectiveSort = computed<SortSpec[]>(() => (props.modelValue.length > 0 ? props.modelValue : copySort(props.defaultSort)))
const lead = computed<SortSpec>(() => effectiveSort.value[0] ?? DEFAULT_SORT[0]!)
const leadKind = computed(() => kindOf(lead.value.field))
const usedFields = computed(() => effectiveSort.value.map((spec) => spec.field))
const otherFields = computed(() => usedFields.value.slice(1))
const isDefault = computed(() => sortsEqual(effectiveSort.value, props.defaultSort))
const canAddLevel = computed(() => props.multi && leadKind.value !== 'random' && effectiveSort.value.length < MAX_SORT_LEVELS)
const showFooter = computed(() => props.multi || !isDefault.value)

const defaultLead = computed(() => props.defaultSort[0] ?? DEFAULT_SORT[0]!)
const resetLabel = computed(() => {
  const order = directionLabel(defaultLead.value.field, defaultLead.value.dir)
  const field = labelOf(defaultLead.value.field)
  return order ? t('book.sort.resetTo', { field, order }) : t('book.sort.resetToField', { field })
})

const levels = computed({
  get: () => effectiveSort.value.slice(1).map((spec) => ({ ...spec })),
  set: (next: SortSpec[]) => emit('update:modelValue', [lead.value, ...next]),
})

function update(next: SortSpec[]) {
  emit('update:modelValue', next)
}

function handlePickLead(field: SortField) {
  update(withLeadField(effectiveSort.value, field, kindOf(field)))
}

function handleLeadDirection(dir: SortSpec['dir']) {
  update([{ ...lead.value, dir }, ...effectiveSort.value.slice(1)])
}

function toggleLevel(index: number) {
  update(effectiveSort.value.map((spec, i) => (i === index ? { ...spec, dir: spec.dir === 'asc' ? 'desc' : 'asc' } : spec)))
}

const panelRef = ref<HTMLElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)
let refocus = false

// Removing a level or resetting takes the pressed button away. Once the new sort has rendered,
// which can be a route change later, focus moves to the footer instead of falling to the page.
watch(
  () => props.modelValue,
  () => {
    if (!refocus) return
    refocus = false
    if (panelRef.value?.contains(document.activeElement)) return
    const target = footerRef.value?.querySelector<HTMLElement>('button') ?? panelRef.value?.querySelector<HTMLElement>('button, input')
    target?.focus()
  },
  { flush: 'post' },
)

function removeLevel(index: number) {
  refocus = true
  update(effectiveSort.value.filter((_, i) => i !== index))
}

function handleThenBy() {
  mode.value = 'then'
}

function handleBack() {
  mode.value = 'main'
}

function handleAddLevel(field: SortField) {
  update([...effectiveSort.value, { field, dir: naturalDirectionOf(field) }])
  mode.value = 'main'
}

function handleReset() {
  refocus = true
  update(copySort(props.defaultSort))
}

function handleShuffle() {
  emit('shuffle')
}

function levelLabel(spec: SortSpec) {
  return labelOf(spec.field)
}

function levelOrder(spec: SortSpec) {
  return directionLabel(spec.field, spec.dir)
}

const iconButton =
  'inline-grid size-[26px] shrink-0 place-items-center rounded-[calc(var(--radius)-4px)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none'
const footRow =
  'flex min-h-8 w-full items-center gap-[9px] rounded-[calc(var(--radius)-4px)] px-2 text-start text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none max-sm:min-h-[42px] max-sm:text-[14.5px]'
</script>

<template>
  <div ref="panelRef" class="flex min-h-0 w-[300px] max-w-full flex-col max-sm:w-full" data-testid="sort-panel">
    <template v-if="mode === 'main'">
      <div class="shrink-0 px-2.5 pt-2.5" :class="fieldCount > 8 ? '' : 'pb-2'">
        <button
          v-if="leadKind === 'random'"
          type="button"
          class="inline-flex h-[30px] w-full items-center justify-center gap-1.5 rounded-[calc(var(--radius)-3px)] border border-border px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none max-sm:h-[38px] max-sm:text-[14px]"
          @click="handleShuffle"
        >
          <Shuffle :size="14" aria-hidden="true" />
          {{ t('book.sort.shuffleAgain') }}
        </button>
        <SortOrderSegment
          v-else
          :model-value="lead.dir"
          :asc-label="directionLabel(lead.field, 'asc')"
          :desc-label="directionLabel(lead.field, 'desc')"
          :label="t('book.sort.orderFor', { field: labelOf(lead.field) })"
          @update:model-value="handleLeadDirection"
        />
      </div>
      <FieldListbox
        :groups="groups"
        :selected="lead.field"
        :exclude="otherFields"
        :placeholder="t('book.sort.findField')"
        :search-label="t('book.sort.findFieldAria')"
        :list-label="t('book.sort.sortByList')"
        list-class="max-h-[318px] max-sm:max-h-none"
        @pick="handlePickLead"
      />
      <div v-if="showFooter" ref="footerRef" class="grid shrink-0 gap-0.5 border-t border-border p-1.5">
        <VueDraggable
          v-if="levels.length > 0"
          v-model="levels"
          handle=".sort-level-grip"
          :animation="150"
          ghost-class="opacity-40"
          class="grid gap-0.5 py-0.5"
        >
          <div
            v-for="(level, index) in levels"
            :key="level.field"
            class="flex h-[34px] items-center gap-1 rounded-[calc(var(--radius)-4px)] pe-0.5 text-[13px] hover:bg-muted"
            data-testid="sort-level"
          >
            <span
              class="sort-level-grip grid h-[26px] w-5 shrink-0 cursor-grab place-items-center text-muted-foreground"
              :title="t('book.sort.dragToReorder')"
              aria-hidden="true"
            >
              <GripVertical :size="13" />
            </span>
            <span class="w-[34px] shrink-0 text-[11.5px] text-muted-foreground">{{ t('book.sort.then') }}</span>
            <span class="inline-flex min-w-0 flex-1 items-center gap-[7px] font-semibold">
              <component :is="iconOf(level.field)" :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="truncate">{{ levelLabel(level) }}</span>
            </span>
            <button
              v-if="levelOrder(level)"
              type="button"
              class="inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2 text-[11.5px] font-semibold whitespace-nowrap text-foreground transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              :aria-label="t('book.sort.switchLevelOrder', { field: levelLabel(level), order: levelOrder(level) })"
              @click="toggleLevel(index + 1)"
            >
              {{ levelOrder(level) }}
            </button>
            <button
              type="button"
              :class="iconButton"
              :aria-label="t('book.sort.removeLevel', { field: levelLabel(level) })"
              @click="removeLevel(index + 1)"
            >
              <X :size="14" aria-hidden="true" />
            </button>
          </div>
        </VueDraggable>
        <button v-if="canAddLevel" type="button" :class="footRow" @click="handleThenBy">
          <Plus :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ t('book.sort.thenByEllipsis') }}</span>
        </button>
        <button v-if="!isDefault" type="button" :class="footRow" @click="handleReset">
          <RotateCcw :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ resetLabel }}</span>
        </button>
      </div>
    </template>
    <template v-else>
      <div class="flex shrink-0 items-center gap-1.5 px-1.5 pt-1.5">
        <button type="button" :class="iconButton" :aria-label="t('book.sort.backToSort')" @click="handleBack">
          <ChevronLeft :size="16" aria-hidden="true" />
        </button>
        <span class="text-[12.5px] font-semibold text-foreground">{{ t('book.sort.thenBy') }}</span>
      </div>
      <FieldListbox
        :groups="groups"
        :exclude="usedFields"
        :placeholder="t('book.sort.findField')"
        :search-label="t('book.sort.findThenByAria')"
        :list-label="t('book.sort.thenBy')"
        list-class="max-h-[318px] max-sm:max-h-none"
        @pick="handleAddLevel"
      />
    </template>
  </div>
</template>
