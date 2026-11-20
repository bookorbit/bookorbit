<script setup lang="ts" generic="F extends SortField">
import { computed } from 'vue'
import type { SortField, SortSpec } from '@bookorbit/types'
import BrowseSortControl from '@/components/browse-header/BrowseSortControl.vue'
import { useSortFields } from '@/features/book/composables/useSortFields'
import { sortsEqual } from '@/features/book/lib/sort-defaults'
import SortPanel from './SortPanel.vue'

/**
 * The bar's sort for a page that orders by a few fields and one level only, such as an author's
 * or a series' books: the same button, order arrow and panel as a library, without "Then by".
 */
const props = defineProps<{
  field: F
  dir: SortSpec['dir']
  fields: F[]
  /** The page's own names for its fields, such as "Recently Added". */
  labels?: Partial<Record<F, string>>
  defaultField: F
  defaultDir: SortSpec['dir']
}>()

const emit = defineEmits<{
  change: [field: F, dir: SortSpec['dir']]
}>()

const { labelOf, directionLabel } = useSortFields({ only: () => props.fields, labels: () => props.labels })

const sort = computed<SortSpec[]>(() => [{ field: props.field, dir: props.dir }])
const defaultSort = computed<SortSpec[]>(() => [{ field: props.defaultField, dir: props.defaultDir }])
const changed = computed(() => !sortsEqual(sort.value, defaultSort.value))
const nextDir = computed<SortSpec['dir']>(() => (props.dir === 'asc' ? 'desc' : 'asc'))

function handleSort(value: SortSpec[]) {
  const lead = value[0]
  if (lead && props.fields.includes(lead.field as F)) emit('change', lead.field as F, lead.dir)
}

function handleToggleDirection() {
  emit('change', props.field, nextDir.value)
}
</script>

<template>
  <BrowseSortControl
    :label="labelOf(field)"
    :direction="dir"
    :changed="changed"
    popover-class=""
    phone-sheet
    always-show-label
    :direction-label="directionLabel(field, dir)"
    :next-direction-label="directionLabel(field, nextDir)"
    @toggle-direction="handleToggleDirection"
  >
    <SortPanel :model-value="sort" :default-sort="defaultSort" :only="fields" :labels="labels" :multi="false" @update:model-value="handleSort" />
  </BrowseSortControl>
</template>
