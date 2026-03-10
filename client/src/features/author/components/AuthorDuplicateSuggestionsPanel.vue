<script setup lang="ts">
import type { AuthorDuplicateSuggestion } from '@projectx/types'

defineProps<{
  suggestions: AuthorDuplicateSuggestion[]
  loading: boolean
  error: string | null
  canMerge: boolean
  merging: boolean
}>()

const emit = defineEmits<{
  (event: 'open-author', authorId: number): void
  (event: 'quick-merge', suggestion: AuthorDuplicateSuggestion): void
}>()
</script>

<template>
  <section class="rounded-xl border border-border/70 bg-card/60 p-3">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-foreground">Duplicate Suggestions</h2>
      <span class="text-xs text-muted-foreground">Confidence-ranked</span>
    </div>

    <div v-if="error" class="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
      {{ error }}
    </div>
    <div v-else-if="loading" class="py-3 text-xs text-muted-foreground">Loading suggestions...</div>
    <div v-else-if="suggestions.length === 0" class="py-3 text-xs text-muted-foreground">No likely duplicates found.</div>
    <div v-else class="space-y-2">
      <article
        v-for="suggestion in suggestions.slice(0, 8)"
        :key="`${suggestion.left.id}-${suggestion.right.id}`"
        class="rounded-lg border border-border/70 bg-background/40 p-2.5"
      >
        <div class="flex flex-wrap items-center gap-2">
          <button class="truncate text-left text-sm font-medium text-foreground hover:underline" @click="emit('open-author', suggestion.left.id)">
            {{ suggestion.left.name }}
          </button>
          <span class="text-xs text-muted-foreground">↔</span>
          <button class="truncate text-left text-sm font-medium text-foreground hover:underline" @click="emit('open-author', suggestion.right.id)">
            {{ suggestion.right.name }}
          </button>
          <span class="ml-auto rounded-md bg-primary/10 px-1.5 py-px text-[11px] font-semibold text-primary">
            {{ Math.round(suggestion.confidence * 100) }}%
          </span>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">{{ suggestion.reasons.join(', ') }}</p>
        <div v-if="canMerge" class="mt-2 flex justify-end">
          <button
            class="h-7 rounded-md border border-input px-2.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60"
            :disabled="merging"
            @click="emit('quick-merge', suggestion)"
          >
            Merge Into Left
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
