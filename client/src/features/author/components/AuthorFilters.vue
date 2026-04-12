<script setup lang="ts">
import type { LibraryFilterOption } from '../types/author'

defineProps<{
  libraryId: number | null
  libraries: LibraryFilterOption[]
  hasPhoto: boolean | null
  minBookCount: number | null
  activeCount?: number
  closable?: boolean
}>()

const emit = defineEmits<{
  'update:libraryId': [value: number | null]
  'update:hasPhoto': [value: boolean | null]
  'update:minBookCount': [value: number | null]
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

function onHasPhotoChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'true') emit('update:hasPhoto', true)
  else if (value === 'false') emit('update:hasPhoto', false)
  else emit('update:hasPhoto', null)
}

function onMinBookCountChange(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const num = parseInt(raw, 10)
  emit('update:minBookCount', Number.isInteger(num) && num >= 1 ? num : null)
}
</script>

<template>
  <section class="mb-4 rounded-md border border-border bg-card p-3">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">Author Filters</span>
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
        :value="hasPhoto === true ? 'true' : hasPhoto === false ? 'false' : ''"
        class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
        @change="onHasPhotoChange"
      >
        <option value="">All authors</option>
        <option value="true">Has photo</option>
        <option value="false">Missing photo</option>
      </select>

      <div class="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2.5">
        <span class="text-sm text-muted-foreground">Min books</span>
        <input
          type="number"
          :value="minBookCount ?? ''"
          min="1"
          placeholder="Any"
          class="w-14 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          @change="onMinBookCountChange"
        />
      </div>
    </div>
  </section>
</template>
