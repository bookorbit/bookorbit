<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MetadataCandidate } from '@bookorbit/types'
import { hideOnError, toDisplayCoverUrl } from '../../../lib/metadata-fetch'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'

const props = defineProps<{
  candidate: MetadataCandidate
  seriesName?: string
  isHighlighted?: boolean
}>()

const emit = defineEmits<{ select: [MetadataCandidate] }>()

const { t } = useI18n()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const displayCoverUrl = computed(() => toDisplayCoverUrl(props.candidate.coverUrl))
const candidateSeed = computed(() => props.candidate.title ?? props.candidate.provider)
const candidateAuthorLine = computed(() => props.candidate.authors?.join(', ') || null)

const volumeNumberDisplay = computed(() => {
  const index = props.candidate.seriesIndex
  if (index == null) return t('book.detail.editMetadata.mangabakaDrillDown.volumeLabelUnknown')
  const padded = index.toString().padStart(2, '0')
  return t('book.detail.editMetadata.mangabakaDrillDown.volumeLabel', { n: padded })
})

const coverAlt = computed(() => {
  const series = props.seriesName ?? props.candidate.seriesName
  const index = props.candidate.seriesIndex
  if (series && index != null) return t('book.detail.editMetadata.mangabakaDrillDown.coverAlt', { series, index })
  return t('book.detail.editMetadata.mangabakaDrillDown.selectVolume')
})

const metaLine = computed(() => {
  const parts: string[] = []
  if (props.candidate.publisher) parts.push(props.candidate.publisher)
  if (props.candidate.language) parts.push(props.candidate.language)
  return parts.join(' · ')
})

const publishedYear = computed(() => {
  const date = props.candidate.publishedDate
  if (!date) return null
  const year = new Date(date).getFullYear()
  return Number.isNaN(year) ? null : year
})

const buttonLabel = computed(() => {
  return t('book.detail.editMetadata.mangabakaDrillDown.volumeSelectLabel', {
    title: props.candidate.title,
    volume: volumeNumberDisplay.value,
  })
})

function handleSelect() {
  emit('select', props.candidate)
}
</script>

<template>
  <button
    type="button"
    class="group flex flex-col items-center gap-1.5 p-2 rounded-xl border text-left transition-all active:scale-[0.98] w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    :class="
      isHighlighted
        ? 'border-primary bg-primary/5 ring-2 ring-primary'
        : 'border-border/60 bg-card hover:border-border hover:shadow-md hover:-translate-y-px'
    "
    :aria-label="buttonLabel"
    :aria-current="isHighlighted ? 'true' : undefined"
    @click="handleSelect"
  >
    <span class="relative shrink-0 rounded-lg overflow-hidden bg-muted block shadow-sm" :style="{ width: '60px', aspectRatio: coverAspectRatio }">
      <img
        v-if="displayCoverUrl"
        :src="displayCoverUrl"
        :alt="coverAlt"
        class="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
        @error="hideOnError"
      />
      <BookCoverPlaceholder v-else :title="candidateSeed" :author-line="candidateAuthorLine" :is-audio="false" :seed="candidateSeed" />
    </span>

    <span class="w-full flex flex-col gap-0.5">
      <span
        class="inline-flex items-center justify-center self-start rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground tabular-nums"
      >
        {{ volumeNumberDisplay }}
      </span>
      <span v-if="metaLine" class="text-[10px] text-muted-foreground truncate">{{ metaLine }}</span>
      <span v-if="publishedYear" class="text-[10px] text-muted-foreground tabular-nums">{{ publishedYear }}</span>
      <span class="text-xs font-medium leading-snug line-clamp-2 text-foreground">{{ candidate.title }}</span>
    </span>
  </button>
</template>
