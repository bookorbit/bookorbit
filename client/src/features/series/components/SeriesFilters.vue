<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CompletionStatus } from '../types/series'

const { t } = useI18n()

defineProps<{
  libraryId: number | null
  libraries: { id: number; name: string }[]
  completionStatus: CompletionStatus | null
  activeCount?: number
  closable?: boolean
  embedded?: boolean
}>()

const emit = defineEmits<{
  'update:libraryId': [value: number | null]
  'update:completionStatus': [value: CompletionStatus | null]
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
</script>

<template>
  <section :class="embedded ? 'rounded-md border border-border bg-card p-3' : 'mb-4 rounded-md border border-border bg-card p-3'">
    <div v-if="!embedded" class="mb-3 flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">{{ t('series.filters.title') }}</span>
      <div class="flex items-center gap-2">
        <button
          v-if="(activeCount ?? 0) > 0"
          class="h-7 rounded-md border border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="onClear"
        >
          {{ t('series.filters.clearAll') }}
        </button>
        <button
          v-if="closable"
          class="h-7 rounded-md border border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="onClose"
        >
          {{ t('common.close') }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <select
        :value="libraryId ?? ''"
        class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
        @change="onLibraryChange"
      >
        <option value="">{{ t('series.filters.allLibraries') }}</option>
        <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
      </select>

      <select
        :value="completionStatus ?? ''"
        class="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
        @change="onCompletionChange"
      >
        <option value="">{{ t('series.filters.allCompletion') }}</option>
        <option value="not_started">{{ t('series.filters.notStarted') }}</option>
        <option value="in_progress">{{ t('series.filters.inProgress') }}</option>
        <option value="complete">{{ t('series.filters.complete') }}</option>
      </select>
    </div>
  </section>
</template>
