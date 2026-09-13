<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookImage } from '@lucide/vue'
import type { AuthorSummary } from '@bookorbit/types'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { toDisplayCoverUrl } from '@/features/book/lib/metadata-fetch'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { authorInitials } from '../lib/author-identity'

/**
 * The one place the author artwork rule lives: a portrait if we have one, else the
 * cover of a book they wrote, else a monogram. Only a small minority of a real
 * library's authors have a portrait, so without the middle step the grid is a wall
 * of near-identical letter tiles.
 *
 * The monogram always renders underneath, so an image that is slow, missing, or
 * broken degrades to letters instead of an empty rectangle. Fills its container;
 * the caller owns the size.
 */
const props = withDefaults(
  defineProps<{
    author: AuthorSummary
    shape?: 'square' | 'circle'
    /** Marks cover-derived artwork so it never reads as a photograph of the person. */
    showSourceBadge?: boolean
    /**
     * Turn off while filtering for authors that have no portrait: standing in a book
     * cover there fills every tile and hides the very gap the filter exists to show.
     */
    coverFallback?: boolean
  }>(),
  { shape: 'square', showSourceBadge: true, coverFallback: true },
)

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

const portraitFailed = ref(false)
const coverFailed = ref(false)

watch(
  () => props.author.imageUrl,
  () => {
    portraitFailed.value = false
  },
)
watch(
  () => props.author.coverBookId,
  () => {
    coverFailed.value = false
  },
)

const portraitSrc = computed(() => {
  if (portraitFailed.value) return ''
  return toDisplayCoverUrl(props.author.imageUrl)
})

const coverSrc = computed(() => {
  if (!props.coverFallback || portraitSrc.value || coverFailed.value) return ''
  const bookId = props.author.coverBookId
  return bookId ? coverUrl(bookId) : ''
})

const source = computed<'portrait' | 'cover' | 'monogram'>(() => {
  if (portraitSrc.value) return 'portrait'
  if (coverSrc.value) return 'cover'
  return 'monogram'
})

const initials = computed(() => authorInitials(props.author.name))
const monogramStyle = computed(() => bookCoverStyle(props.author.name || String(props.author.id)))

/** Same rule as the tile badges: a circle clips whatever sits in the square's corner. */
const badgeInset = computed(() => (props.shape === 'circle' ? 'bottom-[9%] left-[9%]' : 'bottom-1 left-1'))

function handlePortraitError() {
  portraitFailed.value = true
}

function handleCoverError() {
  coverFailed.value = true
}
</script>

<template>
  <span
    class="@container relative flex h-full w-full items-center justify-center overflow-hidden"
    :class="shape === 'circle' ? 'rounded-full' : 'rounded-[inherit]'"
    :style="monogramStyle"
  >
    <span
      class="select-none font-serif font-semibold leading-none tracking-tight text-[length:clamp(0.55rem,36cqw,2.25rem)]"
      :style="{ color: monogramStyle.color }"
      aria-hidden="true"
    >
      {{ initials }}
    </span>

    <img
      v-if="portraitSrc"
      :src="portraitSrc"
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      fetchpriority="low"
      class="absolute inset-0 h-full w-full object-cover object-[50%_26%]"
      @error="handlePortraitError"
    />
    <img
      v-else-if="coverSrc"
      :src="coverSrc"
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      fetchpriority="low"
      class="absolute inset-0 h-full w-full object-cover object-[50%_18%]"
      @error="handleCoverError"
    />

    <span v-if="source === 'cover'" class="pointer-events-none absolute inset-0 bg-linear-to-t from-black/35 to-transparent to-45%" />

    <span
      v-if="source === 'cover' && showSourceBadge"
      class="pointer-events-none absolute hidden size-4 place-items-center rounded bg-black/45 text-white/85 backdrop-blur-[2px] @[3.5rem]:grid"
      :class="badgeInset"
      :title="t('author.portrait.fromTheirBook')"
    >
      <BookImage :size="9" />
    </span>
  </span>
</template>
