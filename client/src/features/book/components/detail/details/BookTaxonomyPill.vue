<script setup lang="ts">
import { computed } from 'vue'
import type { TaxonomyKind } from '@bookorbit/types'

/**
 * A genre or tag on the book page. It links to that name's page when the server sent its id; a
 * name without one, or a copy only used to measure the row, stays plain text.
 */
const props = defineProps<{
  kind: TaxonomyKind
  name: string
  id?: number | null
}>()

const emit = defineEmits<{ navigate: [] }>()

const to = computed(() => (props.id ? { name: props.kind === 'tag' ? 'tag-detail' : 'genre-detail', params: { id: props.id } } : null))
const label = computed(() => (props.kind === 'tag' ? `#${props.name}` : props.name))
const chipClass = computed(() => (props.kind === 'tag' ? 'chip-tag border' : 'chip-genre'))

function handleClick() {
  emit('navigate')
}
</script>

<template>
  <RouterLink v-if="to" :to="to" class="book-taxonomy-pill is-link" :class="chipClass" @click="handleClick">{{ label }}</RouterLink>
  <span v-else class="book-taxonomy-pill" :class="chipClass">{{ label }}</span>
</template>

<style scoped>
.book-taxonomy-pill {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  border-radius: var(--radius-md);
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.is-link {
  transition:
    background-color 0.12s,
    box-shadow 0.12s,
    border-color 0.12s;
}

.is-link.chip-genre:hover {
  background-color: color-mix(in oklch, var(--chip-genre-fg) 24%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--chip-genre-fg) 55%, transparent);
}

.is-link.chip-tag:hover {
  background-color: color-mix(in oklch, var(--chip-tag-fg) 24%, transparent);
  border-color: color-mix(in oklch, var(--chip-tag-fg) 55%, transparent);
}

.is-link:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.is-link:active {
  transform: translateY(0.5px);
}

@media (max-width: 767px) {
  .book-taxonomy-pill {
    min-height: 26px;
    padding-inline: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-link {
    transition: none;
  }
}
</style>
