<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookMetadataFetchConditions, BookMetadataFetchPreviewBook } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const MAX_REASONS = 3

const props = defineProps<{
  items: BookMetadataFetchPreviewBook[]
  matching: number | null
  total: number | null
  conditions: BookMetadataFetchConditions
  /** Library names by id, shown on the global tab where the list spans libraries. */
  libraryNames?: Map<number, string> | null
}>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

type Reason = { key: string; label: string; tone: 'never' | 'poor' | 'fair' | 'good' | 'missing' }

const TONE_CLASS: Record<Reason['tone'], string> = {
  never: 'bg-foreground/8 text-foreground',
  poor: 'bg-destructive/15 text-destructive',
  fair: 'bg-warning/18 text-warning',
  good: 'bg-success/15 text-success',
  missing: 'bg-primary/13 text-primary',
}

function reasonsFor(book: BookMetadataFetchPreviewBook): Reason[] {
  const out: Reason[] = []
  const c = props.conditions
  if (c.neverFetched.enabled && book.neverFetched)
    out.push({ key: 'never', label: t('settings.metadata.autoFetch.conditions.neverFetched.label'), tone: 'never' })
  if (c.scoreThreshold.enabled && (book.metadataScore === null || book.metadataScore < c.scoreThreshold.threshold)) {
    const score = book.metadataScore ?? 0
    out.push({
      key: 'score',
      label: t('settings.metadata.autoFetch.preview.score', { score: book.metadataScore === null ? '-' : formatNumber(score) }),
      tone: score < 50 ? 'poor' : score < 70 ? 'fair' : 'good',
    })
  }
  for (const field of book.missingFields) out.push({ key: field, label: t(`settings.metadata.autoFetch.preview.missing.${field}`), tone: 'missing' })
  return out
}

const rows = computed(() =>
  props.items.map((book) => {
    const reasons = reasonsFor(book)
    const library = props.libraryNames?.get(book.libraryId) ?? null
    return {
      book,
      reasons: reasons.slice(0, MAX_REASONS),
      more: Math.max(0, reasons.length - MAX_REASONS),
      byline: [book.author ?? t('settings.metadata.autoFetch.preview.unknownAuthor'), library].filter(Boolean).join(' · '),
      src: coverUrl(book.bookId, 'thumbnail', book.coverVersion),
      frame: book.coverAspectRatio ?? '2/3',
    }
  }),
)

const matchingText = computed(() =>
  props.matching === null || props.total === null
    ? ''
    : t('settings.metadata.autoFetch.preview.matching', { matching: props.matching, total: formatNumber(props.total) }),
)
const showingText = computed(() => (props.matching ? t('settings.metadata.autoFetch.preview.showing', { count: props.items.length }) : ''))
</script>

<template>
  <section class="border-t border-border px-4 pt-4 pb-5 md:px-6" data-testid="auto-fetch-preview">
    <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <h3 class="settings-card-title">{{ t('settings.metadata.autoFetch.preview.title') }}</h3>
      <p class="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
        <span>{{ matchingText }}</span>
        <template v-if="showingText">
          <span aria-hidden="true">·</span>
          <span>{{ showingText }}</span>
        </template>
      </p>
    </div>
    <p v-if="matching === 0" class="py-2 text-sm text-muted-foreground">{{ t('settings.metadata.autoFetch.preview.empty') }}</p>
    <ul v-else class="grid grid-cols-1 gap-x-7 @min-[48rem]:grid-cols-2 @min-[72rem]:grid-cols-3">
      <li
        v-for="row in rows"
        :key="row.book.bookId"
        class="flex min-w-0 items-center gap-3 border-t border-border/70 py-2 first:border-t-0 @min-[48rem]:[&:nth-child(2)]:border-t-0 @min-[72rem]:[&:nth-child(3)]:border-t-0"
      >
        <BookCoverSurface
          size="mini"
          :disable-spine="row.frame === '1/1'"
          class="book-cover-surface--spine-fitted relative flex h-[45px] w-[30px] shrink-0 overflow-hidden rounded-[3px]"
        >
          <BookCoverArtwork
            :src="row.src"
            :has-cover="row.book.hasCover"
            :title="row.book.title"
            :author-line="row.book.author"
            :seed="row.book.title ?? String(row.book.bookId)"
            :frame-aspect-ratio="row.frame"
            :spine="row.frame !== '1/1'"
            alt=""
          />
        </BookCoverSurface>
        <div class="min-w-0 flex-1">
          <RouterLink
            :to="{ name: 'book-detail', params: { bookId: row.book.bookId } }"
            class="block truncate text-[13px] font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {{ row.book.title }}
          </RouterLink>
          <p class="mt-px truncate text-xs text-muted-foreground">{{ row.byline }}</p>
          <div class="mt-[5px] flex flex-wrap items-center gap-1">
            <span
              v-for="reason in row.reasons"
              :key="reason.key"
              class="inline-flex h-[19px] items-center rounded-[5px] px-1.5 text-[11px] font-medium whitespace-nowrap"
              :class="TONE_CLASS[reason.tone]"
            >
              {{ reason.label }}
            </span>
            <span v-if="row.more" class="text-[11px] text-muted-foreground">{{
              t('settings.metadata.autoFetch.preview.more', { count: row.more })
            }}</span>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
