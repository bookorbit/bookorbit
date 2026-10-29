<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeftRight, BookOpen, Headphones, Pencil } from '@lucide/vue'
import type { BookDetail, CoverMedium } from '@bookorbit/types'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { COVER_STACK_ASPECT_RATIO } from '@/features/book/lib/cover-stack'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'

const props = defineProps<{
  book: Pick<BookDetail, 'id' | 'title' | 'covers' | 'coverVersion'>
  /** The cover that starts in front: the one the page would show on its own. */
  face: CoverMedium
  editable?: boolean
}>()

const emit = defineEmits<{ open: [medium: CoverMedium]; edit: [] }>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

const front = ref<CoverMedium>(props.face)
watch(
  () => [props.book.id, props.face] as const,
  ([, face]) => {
    front.value = face
  },
)

const MEDIA = ['ebook', 'audio'] as const

function mediumLabel(medium: CoverMedium): string {
  return t(`book.detail.coverLightbox.${medium}`)
}

const cards = computed(() =>
  MEDIA.map((medium) => ({
    medium,
    isFront: medium === front.value,
    src: coverUrl(props.book.id, 'cover', props.book.covers[medium]?.updatedAt ?? props.book.coverVersion, medium),
    label: medium === front.value ? t('book.detail.details.viewCover') : t(`book.detail.details.coverStack.show.${medium}`),
  })),
)

const announcement = computed(() => t(`book.detail.details.coverStack.front.${front.value}`))

function handleCardClick(medium: CoverMedium) {
  if (medium === front.value) emit('open', medium)
  else front.value = medium
}

function handleEdit() {
  emit('edit')
}
</script>

<template>
  <div class="cover-stack relative w-full" data-test="cover-stack" :data-front="front" :style="{ aspectRatio: COVER_STACK_ASPECT_RATIO }">
    <div
      v-for="card in cards"
      :key="card.medium"
      class="cover-stack__card group"
      :class="[`cover-stack__card--${card.medium}`, card.isFront ? 'cover-stack__card--front' : 'cover-stack__card--back']"
      :data-medium="card.medium"
    >
      <BookCoverSurface
        class="book-cover-surface--spine-fitted relative h-full w-full overflow-hidden rounded-lg shadow-lg shadow-black/40"
        :disable-spine="card.medium === 'audio'"
      >
        <button
          type="button"
          class="absolute inset-0 z-[4] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="card.isFront ? 'cursor-zoom-in' : 'cursor-pointer'"
          :aria-label="card.label"
          :data-test="`cover-stack-${card.medium}`"
          @click="handleCardClick(card.medium)"
        />
        <button
          v-if="editable && card.isFront"
          type="button"
          class="absolute start-1.5 top-1.5 z-10 rounded-xs bg-cover-chip p-1 text-cover-chip-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          :aria-label="t('book.detail.details.editCover')"
          data-test="cover-stack-edit"
          @click.stop="handleEdit"
        >
          <Pencil class="size-3" aria-hidden="true" />
        </button>
        <BookCoverArtwork
          :src="card.src"
          :has-cover="true"
          :title="book.title"
          :is-audio="card.medium === 'audio'"
          :seed="String(book.id)"
          :alt="''"
          :frame-aspect-ratio="card.medium === 'audio' ? '1/1' : '2/3'"
          :spine="card.medium === 'ebook'"
          loading="eager"
          backdrop-class="blur-lg brightness-50"
        />
        <span
          class="pointer-events-none absolute end-1.5 top-1.5 z-[5] inline-flex items-center gap-1 rounded-xs bg-cover-chip px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cover-chip-foreground backdrop-blur-sm"
          aria-hidden="true"
        >
          <Headphones v-if="card.medium === 'audio'" class="size-2.5" />
          <BookOpen v-else class="size-2.5" />
          <span class="cover-stack__label">{{ mediumLabel(card.medium) }}</span>
          <ArrowLeftRight v-if="!card.isFront" class="size-2.5" />
        </span>
      </BookCoverSurface>
    </div>
    <p class="sr-only" role="status" aria-live="polite" data-test="cover-stack-status">{{ announcement }}</p>
  </div>
</template>

<style scoped>
/* Width is a share of the stage, height a share of the portrait's, so the pair scales with the column. */
.cover-stack {
  --portrait-width: 86%;
  --square-width: 95%;
  --square-height: 73.64%;
  --square-top: 26.36%;
  /* How far the cover behind may stick out past the stage: always less than the gap beside the column. */
  --bleed: min(0.75rem, 6%);
  /*
   * Where the cover behind starts so that, tilted 3 degrees and scaled to 94% about its centre, its
   * outline ends on the stage's edge: (100% - outline width / 2) - card width / 2. Tilting alone throws
   * a portrait's top corner tens of pixels into the neighbouring column.
   */
  --portrait-back-start: 13.46%;
  --square-back-start: 5.57%;
  --ease: cubic-bezier(0.3, 0.9, 0.25, 1);
  isolation: isolate;
  container-type: inline-size;
}

/* A badge's words do not fit on a thumbnail-sized stack; its icons still say which cover it is. */
@container (max-width: 13rem) {
  .cover-stack__label {
    display: none;
  }
}

/* Only a strip of the cover behind shows, so its badge keeps to icons that fit on it. */
.cover-stack__card--back .cover-stack__label {
  display: none;
}

.cover-stack__card {
  position: absolute;
  transition:
    inset-inline-start 0.5s var(--ease),
    top 0.5s var(--ease),
    width 0.5s var(--ease),
    height 0.5s var(--ease),
    transform 0.5s var(--ease),
    filter 0.4s;
}

.cover-stack__card--front {
  z-index: 2;
}

.cover-stack__card--back {
  z-index: 1;
  filter: brightness(0.92);
  transform-origin: 50% 50%;
}

.cover-stack__card--back:hover {
  filter: brightness(1);
}

.cover-stack__card--ebook.cover-stack__card--front {
  inset-inline-start: 0;
  top: 0;
  width: var(--portrait-width);
  height: 100%;
}

.cover-stack__card--audio.cover-stack__card--front {
  inset-inline-start: 0;
  top: var(--square-top);
  width: var(--square-width);
  height: var(--square-height);
}

.cover-stack__card--ebook.cover-stack__card--back {
  inset-inline-start: calc(var(--portrait-back-start) + var(--bleed));
  top: 0;
  width: var(--portrait-width);
  height: 100%;
  transform: rotate(3deg) scale(0.94);
}

.cover-stack__card--audio.cover-stack__card--back {
  inset-inline-start: calc(var(--square-back-start) + var(--bleed));
  top: var(--square-top);
  width: var(--square-width);
  height: var(--square-height);
  transform: rotate(-3deg) scale(0.94);
}

.cover-stack__card--ebook.cover-stack__card--back:dir(rtl) {
  transform: rotate(-3deg) scale(0.94);
}

.cover-stack__card--audio.cover-stack__card--back:dir(rtl) {
  transform: rotate(3deg) scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .cover-stack__card {
    transition: none;
  }
}
</style>
