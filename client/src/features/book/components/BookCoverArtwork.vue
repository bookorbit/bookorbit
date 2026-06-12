<script setup lang="ts">
import type { BookCoverDisplayMode, CoverAspectRatio } from '@bookorbit/types'
import { computed, inject, ref, watch, type ComponentPublicInstance } from 'vue'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO, coverAspectRatioValue, fittedCoverFrameStyle } from '../lib/cover-aspect-ratio'
import { getCachedCoverRatio, rememberLoadedCover } from '../lib/cover-load-cache'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import BookCoverPlaceholder from './BookCoverPlaceholder.vue'

const props = withDefaults(
  defineProps<{
    src: string | null
    hasCover: boolean
    title: string | null
    authorLine?: string | null
    isAudio?: boolean
    seed: string
    alt?: string
    mode?: BookCoverDisplayMode
    frameAspectRatio?: CoverAspectRatio | string
    loading?: 'lazy' | 'eager'
    decoding?: 'async' | 'auto' | 'sync'
    backdropClass?: string
    imageClass?: string
    resetKey?: string | number | null
    spine?: boolean
  }>(),
  {
    authorLine: null,
    isAudio: false,
    alt: '',
    mode: undefined,
    frameAspectRatio: undefined,
    loading: 'lazy',
    decoding: 'async',
    backdropClass: 'blur-md brightness-90',
    imageClass: '',
    resetKey: null,
    spine: true,
  },
)

const emit = defineEmits<{
  load: [ratio: number | null]
  error: []
}>()

const { bookCoverDisplayMode } = useDisplaySettings()
const injectedAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const loaded = ref(false)
const failed = ref(false)
const imageRatio = ref<number | null>(null)
// When a pooled view is reassigned to another book (virtual scroll, resize),
// the browser already has the cover cached; restoring from this cache skips
// the skeleton flash and fade-in replay that otherwise make the grid flicker.
const instant = ref(false)

restoreFromCoverCache()

const effectiveMode = computed(() => props.mode ?? bookCoverDisplayMode.value)
const frameAspectRatio = computed(() => props.frameAspectRatio ?? injectedAspectRatio.value)
const slotRatio = computed(() => coverAspectRatioValue(String(frameAspectRatio.value)))
const canRenderImage = computed(() => props.hasCover && props.src !== null && props.src !== '' && !failed.value)
const showBlurredBackdrop = computed(() => effectiveMode.value === 'blurred-fit' && canRenderImage.value && loaded.value)
const useNaturalFrame = computed(() => effectiveMode.value === 'natural-bottom' && canRenderImage.value && loaded.value)
const showSpineLayer = computed(() => props.spine && canRenderImage.value && loaded.value)

const frameStyle = computed(() => {
  if (useNaturalFrame.value) return fittedCoverFrameStyle(imageRatio.value, slotRatio.value, 'bottom')
  return { inset: '0' }
})

const imageFitClass = computed(() => {
  if (effectiveMode.value === 'blurred-fit') return 'object-contain'
  return 'object-cover'
})

const spineStyle = computed(() => {
  if (effectiveMode.value === 'blurred-fit') return fittedCoverFrameStyle(imageRatio.value, slotRatio.value)
  return { inset: '0' }
})

function restoreFromCoverCache() {
  const cached = getCachedCoverRatio(props.src)
  instant.value = cached !== null
  loaded.value = instant.value
  imageRatio.value = cached?.ratio ?? null
}

function resetImageState() {
  failed.value = false
  restoreFromCoverCache()
}

watch(() => [props.src, props.hasCover, props.resetKey] as const, resetImageState)

function updateImageRatio(img: HTMLImageElement | null): number | null {
  if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null
  const ratio = img.naturalWidth / img.naturalHeight
  imageRatio.value = ratio
  return ratio
}

function handleImageRef(el: Element | ComponentPublicInstance | null) {
  const img = el as HTMLImageElement | null
  if (img?.complete && img.naturalWidth > 0) {
    const ratio = updateImageRatio(img)
    loaded.value = true
    failed.value = false
    rememberLoadedCover(props.src, ratio)
    emit('load', ratio)
  }
}

function handleImageLoad(event: Event) {
  const ratio = updateImageRatio(event.target as HTMLImageElement | null)
  loaded.value = true
  failed.value = false
  rememberLoadedCover(props.src, ratio)
  emit('load', ratio)
}

function handleImageError() {
  loaded.value = false
  failed.value = true
  imageRatio.value = null
  emit('error')
}
</script>

<template>
  <template v-if="canRenderImage">
    <span
      :class="[
        'absolute inset-0 z-0 transition-opacity duration-200 ease-out',
        loaded ? 'opacity-0 pointer-events-none' : 'opacity-100',
        effectiveMode === 'natural-bottom' ? 'book-cover-artwork-placeholder-natural overflow-hidden rounded-[inherit]' : '',
      ]"
      aria-hidden="true"
    >
      <BookCoverPlaceholder :title="title" :author-line="authorLine" :is-audio="isAudio" :seed="seed" />
    </span>
    <img
      v-if="showBlurredBackdrop"
      :src="src ?? ''"
      :class="['absolute inset-0 z-0 h-full w-full scale-110 object-cover transition-opacity duration-300 ease-out', backdropClass]"
      aria-hidden="true"
      loading="lazy"
    />
    <span
      :class="['book-cover-artwork-frame z-[1]', useNaturalFrame ? 'book-cover-artwork-frame--natural' : 'book-cover-artwork-frame--full']"
      :style="frameStyle"
    >
      <img
        :ref="handleImageRef"
        :src="src ?? ''"
        :alt="alt"
        :loading="loading"
        :decoding="decoding"
        :class="[
          'absolute inset-0 h-full w-full',
          instant ? '' : 'transition-opacity duration-300 ease-out',
          imageFitClass,
          loaded ? 'opacity-100' : 'opacity-0',
          imageClass,
        ]"
        @load="handleImageLoad"
        @error="handleImageError"
      />
      <span v-if="showSpineLayer" class="book-cover-spine-layer absolute inset-0 z-[3]" :style="spineStyle" />
    </span>
    <span v-if="!loaded" class="absolute inset-0 z-[2] animate-pulse bg-foreground/5" />
  </template>
  <span
    v-else
    :class="[
      'absolute inset-0',
      effectiveMode === 'natural-bottom' ? 'book-cover-artwork-placeholder-natural overflow-hidden rounded-[inherit]' : '',
    ]"
  >
    <BookCoverPlaceholder :title="title" :author-line="authorLine" :is-audio="isAudio" :seed="seed" />
  </span>
</template>
