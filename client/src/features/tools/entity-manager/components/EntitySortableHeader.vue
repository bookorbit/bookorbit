<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, ChevronsUpDown } from '@lucide/vue'
import type { BrowseEntitySortBy, BrowseEntitySortOrder } from '@bookorbit/types'

const props = defineProps<{
  field: BrowseEntitySortBy
  sortBy: BrowseEntitySortBy
  sortOrder: BrowseEntitySortOrder
  align?: 'start' | 'end'
}>()

const emit = defineEmits<{ sort: [field: BrowseEntitySortBy] }>()

const isActive = computed(() => props.sortBy === props.field)
const ariaSort = computed(() => (isActive.value ? (props.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'))
const alignClass = computed(() => (props.align === 'end' ? 'justify-end' : 'justify-start'))

function requestSort(): void {
  emit('sort', props.field)
}
</script>

<template>
  <th scope="col" class="text-xs font-semibold uppercase tracking-wider" :class="align === 'end' ? 'text-end' : 'text-start'" :aria-sort="ariaSort">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 px-3 py-2.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      :class="[alignClass, isActive ? 'text-foreground' : 'text-muted-foreground']"
      @click="requestSort"
    >
      <slot />
      <ArrowUp v-if="isActive && sortOrder === 'asc'" :size="12" class="text-primary" aria-hidden="true" />
      <ArrowDown v-else-if="isActive" :size="12" class="text-primary" aria-hidden="true" />
      <ChevronsUpDown v-else :size="12" class="opacity-45" aria-hidden="true" />
    </button>
  </th>
</template>
