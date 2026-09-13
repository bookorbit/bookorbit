<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, ChevronsUpDown } from '@lucide/vue'
import type { UserListSortDirection, UserListSortField } from '@bookorbit/types'

const props = defineProps<{ field: UserListSortField; sortBy: UserListSortField; sortDir: UserListSortDirection }>()
const emit = defineEmits<{ sort: [field: UserListSortField] }>()

const isActive = computed(() => props.sortBy === props.field)
const ariaSort = computed(() => (isActive.value ? (props.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'))

function requestSort() {
  emit('sort', props.field)
}
</script>

<template>
  <th scope="col" class="text-start text-xs font-semibold uppercase tracking-wider" :aria-sort="ariaSort">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 px-3 py-2.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      :class="isActive ? 'text-foreground' : 'text-muted-foreground'"
      @click="requestSort"
    >
      <slot />
      <ArrowUp v-if="isActive && sortDir === 'asc'" :size="12" class="text-primary" aria-hidden="true" />
      <ArrowDown v-else-if="isActive" :size="12" class="text-primary" aria-hidden="true" />
      <ChevronsUpDown v-else :size="12" class="opacity-45" aria-hidden="true" />
    </button>
  </th>
</template>
