<script setup lang="ts">
import { FolderMinus, LoaderCircle, Plus } from '@lucide/vue'
import type { Collection } from '@bookorbit/types'

/**
 * The membership rows shared by the book and podcast "add to collection" sheets. Each sheet keeps
 * its own loading and mutation flow; only the row, its state classes and its icons live here.
 */
const props = withDefaults(
  defineProps<{
    collections: Collection[]
    /** The collection currently being written, so its row reads as busy rather than clickable. */
    mutatingId: number | null
    isMember: (collection: Collection) => boolean
    label: (collection: Collection) => string
    /** Which rows show the label in the accent colour; defaults to the ones already members. */
    highlight?: (collection: Collection) => boolean
    /** Disables every row on top of the per-row busy state, for example when nothing is selected. */
    disabled?: boolean
  }>(),
  { highlight: undefined, disabled: false },
)

const emit = defineEmits<{ select: [collection: Collection] }>()

function isHighlighted(collection: Collection): boolean {
  return props.highlight ? props.highlight(collection) : props.isMember(collection)
}

function handleSelect(collection: Collection) {
  emit('select', collection)
}
</script>

<template>
  <div class="space-y-1">
    <button
      v-for="collection in collections"
      :key="collection.id"
      type="button"
      class="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors"
      :class="
        mutatingId === collection.id
          ? 'cursor-wait bg-muted'
          : isMember(collection)
            ? 'cursor-pointer hover:bg-destructive/10'
            : 'cursor-pointer hover:bg-muted'
      "
      :disabled="disabled || mutatingId === collection.id"
      @click="handleSelect(collection)"
    >
      <span class="flex min-w-0 items-center gap-2.5">
        <slot name="icon" :collection="collection" />
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-sm font-medium text-foreground">{{ collection.name }}</span>
          <span class="text-xs" :class="isHighlighted(collection) ? 'font-medium text-primary' : 'text-muted-foreground'">
            {{ label(collection) }}
          </span>
        </span>
      </span>
      <LoaderCircle
        v-if="mutatingId === collection.id"
        :size="18"
        class="shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
      <FolderMinus v-else-if="isMember(collection)" :size="18" class="shrink-0 text-destructive" aria-hidden="true" />
      <Plus v-else :size="18" class="shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  </div>
</template>
