<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { useCoverVersions } from '../../composables/useCoverVersions'
import BookCoverArtwork from '../BookCoverArtwork.vue'
import BookCoverImage from '../BookCoverImage.vue'
import BookCoverSurface from '../BookCoverSurface.vue'
import { useRefreshingBooks } from '@/features/book/composables/useRefreshingBooks'

const props = defineProps<{
  bookId: number
  title: string | null
  version?: string | number | Date | null
  hasCover: boolean
  isAudio: boolean
  isComic: boolean
}>()

const emit = defineEmits<{ 'cover-click': [] }>()
const { t } = useI18n()
const { isRefreshing } = useRefreshingBooks()

const seed = computed(() => props.title ?? String(props.bookId))
const isRefreshingBook = computed(() => isRefreshing(props.bookId))
const { coverUrl } = useCoverVersions()
const thumbnailSrc = computed(() => coverUrl(props.bookId, 'thumbnail', props.version))
const showPreview = ref(false)
const previewPos = ref({ x: 0, y: 0 })
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function handleMouseEnter(event: MouseEvent) {
  if (!props.hasCover) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  previewPos.value = { x: rect.right + 8, y: rect.top }
  hoverTimer = setTimeout(() => {
    showPreview.value = true
  }, 300)
}

function handleMouseLeave() {
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  showPreview.value = false
}

onUnmounted(() => {
  if (hoverTimer) clearTimeout(hoverTimer)
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('cover-click')
  }
}

function handleCoverClick() {
  emit('cover-click')
}

const adjustedLeft = computed(() => {
  const previewWidth = 180
  if (previewPos.value.x + previewWidth > window.innerWidth - 8) {
    return previewPos.value.x - previewWidth - 56
  }
  return previewPos.value.x
})

const adjustedTop = computed(() => {
  const previewHeight = 260
  return Math.max(8, Math.min(previewPos.value.y, window.innerHeight - previewHeight - 8))
})
</script>

<template>
  <div class="relative" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
    <BookCoverSurface
      size="mini"
      :disable-spine="isAudio"
      :is-comic="isComic"
      tabindex="0"
      role="button"
      :aria-label="t('book.table.cover.view')"
      class="book-cover-surface--spine-fitted relative flex h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-sm transition-opacity hover:opacity-80"
      @click="handleCoverClick"
      @keydown="handleKeydown"
    >
      <BookCoverArtwork
        :src="thumbnailSrc"
        :has-cover="hasCover"
        :title="title"
        :author-line="null"
        :is-audio="isAudio"
        :seed="seed"
        :alt="title ?? ''"
        frame-aspect-ratio="1/1"
        :spine="!isAudio"
        :is-comic="isComic"
      />
      <div v-if="isRefreshingBook" class="absolute inset-0 flex items-center justify-center bg-black/50">
        <Loader2 :size="12" class="animate-spin text-white" />
      </div>
    </BookCoverSurface>

    <Teleport to="body">
      <div
        v-if="showPreview"
        class="pointer-events-none fixed z-[200] rounded-lg border border-border bg-popover p-1.5 shadow-xl transition-opacity duration-150"
        :style="{ top: `${adjustedTop}px`, left: `${adjustedLeft}px` }"
      >
        <BookCoverImage :book-id="bookId" type="cover" :version="version" class="h-[240px] w-auto rounded-md object-contain" />
      </div>
    </Teleport>
  </div>
</template>
