<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, Info, Loader2, ScanSearch } from '@lucide/vue'
import type { BookIsbnCandidate, BookIsbnEditionHint } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useIsbnCandidates } from '../../../composables/useIsbnCandidates'

const props = defineProps<{
  bookId: number
  isbn13: string | null
  isbn10: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{ select: [candidate: BookIsbnCandidate] }>()

const { t } = useI18n()
const open = ref(false)
const { loading, result, failed, load } = useIsbnCandidates()

const candidates = computed(() => result.value?.candidates ?? [])
const currentIsbn13 = computed(() => normalizeIsbn(props.isbn13))
const currentIsbn10 = computed(() => normalizeIsbn(props.isbn10))

type StatusKind = 'failed' | 'unreadable' | 'empty' | 'currentFound' | 'currentMissing'

const status = computed<StatusKind | null>(() => {
  if (loading.value) return null
  if (failed.value) return 'failed'
  if (!result.value) return null
  if (!result.value.readable) return 'unreadable'
  if (candidates.value.length === 0) return 'empty'
  if (!currentIsbn13.value && !currentIsbn10.value) return null
  return candidates.value.some(isCurrent) ? 'currentFound' : 'currentMissing'
})

const statusIcon = computed(() => {
  if (status.value === 'currentFound') return CircleCheck
  if (status.value === 'failed' || status.value === 'currentMissing') return CircleAlert
  return Info
})

const statusMessage = computed(() => (status.value ? t(`book.detail.editMetadata.isbnCandidates.status.${status.value}`) : ''))

watch(open, (isOpen) => {
  if (isOpen) void load(props.bookId)
})

function normalizeIsbn(value: string | null): string {
  return (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase()
}

function isCurrent(candidate: BookIsbnCandidate): boolean {
  return (
    (currentIsbn13.value !== '' && currentIsbn13.value === candidate.isbn13) ||
    (currentIsbn10.value !== '' && currentIsbn10.value === candidate.isbn10)
  )
}

function editionLabel(edition: BookIsbnEditionHint): string {
  return t(`book.detail.editMetadata.isbnCandidates.editions.${edition}`)
}

function handleSelect(candidate: BookIsbnCandidate) {
  emit('select', candidate)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="disabled"
        :aria-label="t('book.detail.editMetadata.isbnCandidates.triggerLabel')"
      >
        <ScanSearch class="size-3.5" aria-hidden="true" />
        <span>{{ t('book.detail.editMetadata.isbnCandidates.trigger') }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-96 max-w-[calc(100vw-2rem)] p-0" :aria-label="t('book.detail.editMetadata.isbnCandidates.heading')">
      <div class="border-b border-border px-3 py-2.5">
        <p class="text-sm font-semibold">{{ t('book.detail.editMetadata.isbnCandidates.heading') }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t('book.detail.editMetadata.isbnCandidates.description') }}</p>
      </div>

      <div role="status" aria-live="polite" class="px-3 text-xs" :class="loading || status ? 'py-2.5' : ''">
        <p v-if="loading" class="flex items-center gap-2 text-muted-foreground">
          <Loader2 class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          {{ t('book.detail.editMetadata.isbnCandidates.loading') }}
        </p>
        <p
          v-else-if="status"
          class="flex items-start gap-2"
          :class="status === 'currentFound' || status === 'currentMissing' || status === 'failed' ? 'text-foreground' : 'text-muted-foreground'"
        >
          <component :is="statusIcon" class="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {{ statusMessage }}
        </p>
      </div>

      <ul v-if="!loading && candidates.length > 0" class="max-h-80 overflow-y-auto border-t border-border p-1.5">
        <li v-for="candidate in candidates" :key="candidate.isbn13">
          <button
            type="button"
            class="w-full rounded-md px-2 py-2 text-start transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="handleSelect(candidate)"
          >
            <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-mono text-sm text-foreground tabular-nums">{{ candidate.isbn13 }}</span>
              <span v-if="candidate.edition" class="rounded-full border border-border px-1.5 text-[10px] font-medium text-muted-foreground">
                {{ editionLabel(candidate.edition) }}
              </span>
              <span v-if="isCurrent(candidate)" class="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                {{ t('book.detail.editMetadata.isbnCandidates.current') }}
              </span>
            </span>
            <span v-if="candidate.isbn10" class="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">
              {{ t('book.detail.editMetadata.isbnCandidates.isbn10', { isbn: candidate.isbn10 }) }}
            </span>
            <span class="mt-1 line-clamp-2 block text-xs text-muted-foreground">{{ candidate.context }}</span>
          </button>
        </li>
      </ul>
    </PopoverContent>
  </Popover>
</template>
