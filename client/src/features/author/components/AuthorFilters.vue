<script setup lang="ts">
import { computed } from 'vue'

import type { AuthorListSort, LibraryFilterOption, SortDirection } from '../types/author'

const props = defineProps<{
  search: string
  sort: AuthorListSort
  order: SortDirection
  libraryId: number | null
  libraries: LibraryFilterOption[]
  activeCount?: number
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:sort': [value: AuthorListSort]
  'update:order': [value: SortDirection]
  'update:libraryId': [value: number | null]
  clear: []
}>()

const searchModel = computed({
  get: () => props.search,
  set: (value: string) => emit('update:search', value),
})

const sortModel = computed({
  get: () => props.sort,
  set: (value: AuthorListSort) => emit('update:sort', value),
})

const orderModel = computed({
  get: () => props.order,
  set: (value: SortDirection) => emit('update:order', value),
})

function onLibraryChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:libraryId', value ? Number(value) : null)
}
</script>

<template>
  <section class="mb-4 rounded-md border border-border bg-card p-3">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">Author Filters</span>
      <button
        v-if="(activeCount ?? 0) > 0"
        class="h-7 rounded-md border border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="emit('clear')"
      >
        Clear all
      </button>
    </div>

    <div class="flex flex-col gap-2.5 md:flex-row md:items-center">
      <input
        v-model="searchModel"
        type="search"
        placeholder="Search authors"
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary/60 md:max-w-sm"
      />

      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="sortModel"
          class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
        >
          <option value="name">Name</option>
          <option value="bookCount">Book Count</option>
          <option value="lastAddedAt">Recent Additions</option>
        </select>

        <select
          v-model="orderModel"
          class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>

        <select
          :value="libraryId ?? ''"
          class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
          @change="onLibraryChange"
        >
          <option value="">All Libraries</option>
          <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
        </select>
      </div>
    </div>
  </section>
</template>
