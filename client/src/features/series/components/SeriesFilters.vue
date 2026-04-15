<script setup lang="ts">
import type { CompletionStatus } from '../types/series'

defineProps<{
  libraryId: number | null
  libraries: { id: number; name: string }[]
  completionStatus: CompletionStatus | null
  author: string | null
  activeCount?: number
  closable?: boolean
}>()

const emit = defineEmits<{
  'update:libraryId': [value: number | null]
  'update:completionStatus': [value: CompletionStatus | null]
  'update:author': [value: string | null]
  clear: []
  close: []
}>()

function onClear() {
  emit('clear')
}

function onClose() {
  emit('close')
}

function onLibraryChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:libraryId', value ? Number(value) : null)
}

function onCompletionChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:completionStatus', (value as CompletionStatus) || null)
}

function onAuthorChange(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim()
  emit('update:author', value || null)
}
</script>

<template>
  <section class="mb-4 rounded-md border border-border bg-card p-3">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">Series Filters</span>
      <div class="flex items-center gap-2">
        <button
          v-if="(activeCount ?? 0) > 0"
          class="h-7 rounded-md border border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="onClear"
        >
          Clear all
        </button>
        <button
          v-if="closable"
          class="h-7 rounded-md border border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="onClose"
        >
          Close
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <select
        :value="libraryId ?? ''"
        class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
        @change="onLibraryChange"
      >
        <option value="">All Libraries</option>
        <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
      </select>

      <select
        :value="completionStatus ?? ''"
        class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
        @change="onCompletionChange"
      >
        <option value="">All completion</option>
        <option value="not_started">Not started</option>
        <option value="in_progress">In progress</option>
        <option value="complete">Complete</option>
      </select>

      <div class="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2.5">
        <span class="text-sm text-muted-foreground">Author</span>
        <input
          type="text"
          :value="author ?? ''"
          placeholder="Filter by author"
          class="w-32 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          @change="onAuthorChange"
        />
      </div>
    </div>
  </section>
</template>
