<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff } from '@lucide/vue'
import type { BookMergeVisibility, BookMergeVisibilityCandidate } from '@bookorbit/types'

type CandidateKind = 'tag' | 'genre'

const props = defineProps<{
  visibility: BookMergeVisibility
  includeTagIds: number[]
  includeGenreIds: number[]
}>()

const emit = defineEmits<{
  'include-tag': [id: number, include: boolean]
  'include-genre': [id: number, include: boolean]
}>()

const { t } = useI18n()
const idPrefix = `merge-visibility-${useId()}`

const rows = computed(() => [
  ...props.visibility.tags.map((candidate) => ({ kind: 'tag' as CandidateKind, candidate })),
  ...props.visibility.genres.map((candidate) => ({ kind: 'genre' as CandidateKind, candidate })),
])

function rowId(kind: CandidateKind, candidate: BookMergeVisibilityCandidate): string {
  return `${idPrefix}-${kind}-${candidate.id}`
}

function candidateName(kind: CandidateKind, name: string): string {
  return kind === 'tag' ? t('book.merge.visibility.tagName', { name }) : t('book.merge.visibility.genreName', { name })
}

function effectText(candidate: BookMergeVisibilityCandidate): string {
  return candidate.effect === 'widens' ? t('book.merge.visibility.widens') : t('book.merge.visibility.narrows')
}

function isIncluded(kind: CandidateKind, id: number): boolean {
  return (kind === 'tag' ? props.includeTagIds : props.includeGenreIds).includes(id)
}

function toggle(kind: CandidateKind, id: number, event: Event): void {
  const include = (event.target as HTMLInputElement).checked
  if (kind === 'tag') emit('include-tag', id, include)
  else emit('include-genre', id, include)
}
</script>

<template>
  <div class="space-y-2.5">
    <p class="text-xs text-muted-foreground">{{ t('book.merge.visibility.intro') }}</p>
    <ul class="space-y-1.5">
      <li
        v-for="row in rows"
        :key="`${row.kind}-${row.candidate.id}`"
        class="rounded-md border border-border px-2.5 py-2"
        data-testid="merge-visibility-row"
      >
        <div :id="rowId(row.kind, row.candidate)" class="flex items-start gap-2">
          <component
            :is="row.candidate.effect === 'widens' ? Eye : EyeOff"
            :size="14"
            class="mt-0.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-foreground">{{ candidateName(row.kind, row.candidate.name) }}</span>
            <span class="block text-xs text-muted-foreground">{{ effectText(row.candidate) }}</span>
          </span>
        </div>
        <label v-if="visibility.canOverride" class="mt-1.5 flex cursor-pointer items-center gap-2 ps-6 text-sm text-foreground">
          <input
            type="checkbox"
            class="accent-primary"
            :checked="isIncluded(row.kind, row.candidate.id)"
            :aria-describedby="rowId(row.kind, row.candidate)"
            @change="toggle(row.kind, row.candidate.id, $event)"
          />
          {{ t('book.merge.visibility.includeAnyway') }}
        </label>
      </li>
    </ul>
    <p v-if="!visibility.canOverride" class="text-xs text-muted-foreground">{{ t('book.merge.visibility.managersOnly') }}</p>
  </div>
</template>
