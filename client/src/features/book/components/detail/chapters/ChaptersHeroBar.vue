<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Lock, LockOpen, Pencil } from '@lucide/vue'
import type { AudiobookChapterSource, BookChaptersState, BookCoverSlot, BookDetail } from '@bookorbit/types'
import { formatNumber, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { useBookCoverAspectRatio } from '@/features/book/composables/useBookCoverAspectRatio'
import { coverAspectRatioValue } from '@/features/book/lib/cover-aspect-ratio'
import { formatChapterLength } from '@/features/book/lib/chapter-time'

const props = defineProps<{
  book: BookDetail
  state: BookChaptersState
  editing: boolean
  canEdit: boolean
  chapterCount: number
}>()

const emit = defineEmits<{ edit: []; done: [] }>()

const SOURCE_KEYS: Record<Exclude<AudiobookChapterSource, 'manual'>, string> = {
  embedded: 'book.detail.chapters.source.embedded',
  tracks: 'book.detail.chapters.source.tracks',
  provider: 'book.detail.chapters.source.provider',
  migration: 'book.detail.chapters.source.migration',
}

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

const defaultAspectRatio = useBookCoverAspectRatio(() => props.book)

/**
 * This tab is only about the audiobook, so it shows the audiobook's own art in that art's shape. A
 * book without audio art falls back to its usual cover, framed as the server frames it.
 */
const cover = computed(() => {
  const audio = props.book.covers.audio
  if (audio) return { src: coverUrl(props.book.id, 'thumbnail', props.book.coverVersion, 'audio'), ratio: slotRatio(audio) ?? 1 }
  const src = props.book.coverSource !== null ? coverUrl(props.book.id, 'thumbnail', props.book.coverVersion) : null
  return { src, ratio: coverAspectRatioValue(defaultAspectRatio.value) }
})
const coverStyle = computed(() => ({ aspectRatio: String(Math.min(1.5, Math.max(0.5, cover.value.ratio))) }))

function slotRatio(slot: BookCoverSlot): number | null {
  return slot.width && slot.height ? slot.width / slot.height : null
}

const sourceLine = computed(() => {
  const { source, updatedBy, updatedAt } = props.state
  if (source === 'manual') {
    const when = updatedAt ? formatRelativeTimeFromNow(updatedAt) : null
    if (updatedBy && when) return t('book.detail.chapters.source.manualBy', { name: updatedBy.name, when })
    return t('book.detail.chapters.source.manual')
  }
  // Chapters stored before provenance was recorded have no source.
  if (source === null) return props.state.chapters.length ? null : t('book.detail.chapters.source.none')
  return t(SOURCE_KEYS[source])
})

const runtimeLabel = computed(() => (props.state.totalDurationMs ? formatChapterLength(props.state.totalDurationMs) : null))
const averageLabel = computed(() =>
  props.state.totalDurationMs && props.chapterCount > 0 ? formatChapterLength(props.state.totalDurationMs / props.chapterCount) : null,
)

function handleEdit() {
  emit('edit')
}

function handleDone() {
  emit('done')
}
</script>

<template>
  <section class="chapters-hero flex shrink-0 items-center gap-3.5 rounded-xl border border-border bg-card px-3.5 py-3">
    <img
      v-if="cover.src"
      :src="cover.src"
      alt=""
      class="hero-cover h-[4.125rem] w-auto shrink-0 rounded-md border border-border object-cover shadow-sm"
      :style="coverStyle"
      loading="lazy"
      decoding="async"
    />
    <span
      v-else
      class="hero-cover flex h-[4.125rem] w-auto shrink-0 rounded-md border border-border bg-muted"
      :style="coverStyle"
      aria-hidden="true"
    />

    <div class="hero-id min-w-0 flex-1">
      <h2 class="truncate text-base font-semibold leading-tight tracking-tight">{{ book.title ?? t('book.detail.chapters.untitled') }}</h2>
      <p v-if="sourceLine" class="mt-1 truncate text-xs text-muted-foreground">{{ sourceLine }}</p>
    </div>

    <dl class="hero-stats flex shrink-0 items-center">
      <div class="hero-stat px-4 text-end">
        <dt class="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.detail.chapters.stats.chapters') }}</dt>
        <dd class="mt-1.5 text-base font-semibold leading-none tracking-tight tabular-nums">{{ formatNumber(chapterCount) }}</dd>
      </div>
      <div v-if="runtimeLabel" class="hero-stat border-s border-border px-4 text-end">
        <dt class="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.detail.chapters.stats.runtime') }}</dt>
        <dd class="mt-1.5 whitespace-nowrap text-base font-semibold leading-none tracking-tight tabular-nums">{{ runtimeLabel }}</dd>
      </div>
      <div v-if="averageLabel" class="hero-stat border-s border-border px-4 text-end">
        <dt class="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.detail.chapters.stats.average') }}</dt>
        <dd class="mt-1.5 whitespace-nowrap text-base font-semibold leading-none tracking-tight tabular-nums">{{ averageLabel }}</dd>
      </div>
    </dl>

    <div class="hero-actions flex shrink-0 items-center gap-2 border-s border-border ps-4">
      <span
        class="inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
        :class="state.locked ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'"
        :title="state.locked ? t('book.detail.chapters.protectedHint') : t('book.detail.chapters.unprotectedHint')"
      >
        <Lock v-if="state.locked" class="size-2.5" aria-hidden="true" />
        <LockOpen v-else class="size-2.5" aria-hidden="true" />
        {{ state.locked ? t('book.detail.chapters.protected') : t('book.detail.chapters.unprotected') }}
      </span>

      <button
        v-if="canEdit && !editing"
        class="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleEdit"
      >
        <Pencil class="size-4" aria-hidden="true" />
        {{ t('book.detail.chapters.edit') }}
      </button>
      <button
        v-else-if="editing"
        class="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-input px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleDone"
      >
        <Check class="size-4" aria-hidden="true" />
        {{ t('book.detail.chapters.done') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
@container chapterstab (max-width: 45rem) {
  .chapters-hero {
    flex-wrap: wrap;
    row-gap: 0.75rem;
  }

  .hero-id {
    flex: 1 1 12rem;
  }

  .hero-stats {
    order: 3;
    width: 100%;
    justify-content: space-between;
  }

  .hero-stats .hero-stat:first-child {
    padding-left: 0;
  }

  .hero-actions {
    border-left: 0;
    padding-left: 0;
  }
}
</style>
