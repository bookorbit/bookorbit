<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitMerge, Rows2, Rows3, Search, Trash2, X } from '@lucide/vue'
import type { BrowseEntityBookCountFilter } from '@bookorbit/types'

import type { EntityRowDensity } from '../types'

const props = defineProps<{
  search: string
  bookCount: BrowseEntityBookCountFilter
  total: number
  density: EntityRowDensity
  selectedCount: number
  isInline: boolean
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:bookCount': [value: BrowseEntityBookCountFilter]
  'update:density': [value: EntityRowDensity]
  bulkMerge: []
  bulkDelete: []
  clearSelection: []
}>()

const { t } = useI18n()

const hasSelection = computed(() => props.selectedCount > 0)
const canMerge = computed(() => props.selectedCount >= 2)
const emptyOnly = computed(() => props.bookCount === 'empty')

function handleSearchInput(event: Event): void {
  emit('update:search', (event.target as HTMLInputElement).value)
}

function handleShowAll(): void {
  emit('update:bookCount', 'any')
}

function handleShowEmpty(): void {
  emit('update:bookCount', 'empty')
}

function handleComfortable(): void {
  emit('update:density', 'comfortable')
}

function handleCompact(): void {
  emit('update:density', 'compact')
}

function handleBulkMerge(): void {
  emit('bulkMerge')
}

function handleBulkDelete(): void {
  emit('bulkDelete')
}

function handleClearSelection(): void {
  emit('clearSelection')
}
</script>

<template>
  <div class="relative min-w-44 flex-1 sm:max-w-64">
    <Search :size="15" class="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <input
      type="search"
      :value="search"
      :placeholder="t('tools.entityManager.browse.searchPlaceholder')"
      :aria-label="t('tools.entityManager.browse.searchPlaceholder')"
      class="h-8 w-full rounded-md border border-border bg-background ps-8 pe-2.5 text-sm text-foreground transition-shadow placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      @input="handleSearchInput"
    />
  </div>

  <div v-if="!isInline" class="inline-flex gap-0.5 rounded-lg bg-secondary p-0.5" role="group">
    <button
      type="button"
      class="h-7 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="emptyOnly ? 'text-muted-foreground hover:text-foreground' : 'bg-card text-foreground shadow-xs'"
      :aria-pressed="!emptyOnly"
      @click="handleShowAll"
    >
      {{ t('tools.entityManager.browse.filters.all') }}
    </button>
    <button
      type="button"
      class="h-7 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="emptyOnly ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
      :aria-pressed="emptyOnly"
      @click="handleShowEmpty"
    >
      {{ t('tools.entityManager.browse.filters.noBooks') }}
    </button>
  </div>

  <span class="text-xs text-muted-foreground tabular-nums">
    {{ t('tools.entityManager.browse.resultCount', { count: total }) }}
  </span>

  <div class="ms-auto flex items-center gap-2">
    <template v-if="hasSelection">
      <span class="text-xs font-semibold text-foreground tabular-nums">
        {{ t('tools.entityManager.browse.selectedCount', { count: selectedCount }) }}
      </span>
      <button
        v-if="canMerge"
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleBulkMerge"
      >
        <GitMerge :size="14" aria-hidden="true" />
        {{ t('tools.entityManager.actions.merge') }}
      </button>
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleBulkDelete"
      >
        <Trash2 :size="14" aria-hidden="true" />
        {{ t('common.delete') }}
      </button>
      <button
        type="button"
        class="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('tools.entityManager.browse.clear')"
        @click="handleClearSelection"
      >
        <X :size="15" aria-hidden="true" />
      </button>
    </template>

    <div v-else class="inline-flex gap-0.5 rounded-lg bg-secondary p-0.5" role="group" :aria-label="t('tools.entityManager.browse.density.label')">
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="density === 'comfortable' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        :aria-pressed="density === 'comfortable'"
        :aria-label="t('tools.entityManager.browse.density.comfortable')"
        :title="t('tools.entityManager.browse.density.comfortable')"
        @click="handleComfortable"
      >
        <Rows2 :size="15" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="density === 'compact' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        :aria-pressed="density === 'compact'"
        :aria-label="t('tools.entityManager.browse.density.compact')"
        :title="t('tools.entityManager.browse.density.compact')"
        @click="handleCompact"
      >
        <Rows3 :size="15" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
