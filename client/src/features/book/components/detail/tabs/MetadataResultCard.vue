<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { MetadataCandidate, MetadataProviderInfo } from '@bookorbit/types'
import { Star } from '@lucide/vue'
import { getProviderLabel, hideOnError, providerBadgeStyle, toDisplayCoverUrl } from '../../../lib/metadata-fetch'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'
import { formatCommunityRatingValue } from '../../../lib/community-rating'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'

const props = defineProps<{
  candidate: MetadataCandidate
  providers: MetadataProviderInfo[]
}>()

const emit = defineEmits<{ select: [MetadataCandidate] }>()

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const providerLabel = computed(() => getProviderLabel(props.candidate.provider, props.providers))
const displayCoverUrl = computed(() => toDisplayCoverUrl(props.candidate.coverUrl))
const candidateSeed = computed(() => props.candidate.title ?? props.candidate.provider)
const candidateAuthorLine = computed(() => props.candidate.authors?.join(', ') || null)
const communityRatingDisplay = computed(() => formatCommunityRatingValue(props.candidate.communityRating, props.candidate.communityRatingCount))

function handleSelect() {
  emit('select', props.candidate)
}
</script>

<template>
  <button
    class="group relative flex flex-row gap-3.5 p-3 rounded-2xl border text-left transition-all active:scale-[0.98] overflow-hidden w-full border-border/60 bg-card hover:border-border hover:shadow-md hover:-translate-y-px"
    @click="handleSelect"
  >
    <!-- Cover -->
    <span class="relative shrink-0 rounded-lg overflow-hidden bg-muted block shadow-sm" :style="{ width: '88px', aspectRatio: coverAspectRatio }">
      <img
        v-if="displayCoverUrl"
        :src="displayCoverUrl"
        :alt="candidate.title"
        class="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
        @error="hideOnError"
      />
      <BookCoverPlaceholder v-else :title="candidateSeed" :author-line="candidateAuthorLine" :is-audio="false" :seed="candidateSeed" />
    </span>

    <!-- Info -->
    <span class="flex-1 min-w-0 flex flex-col justify-center gap-1.5 py-0.5">
      <span class="text-sm font-semibold leading-snug line-clamp-2 text-foreground">{{ candidate.title }}</span>
      <span v-if="candidate.authors?.length" class="text-xs text-muted-foreground line-clamp-1 block leading-tight">
        {{ candidate.authors.join(', ') }}
      </span>
      <span v-if="candidate.subtitle" class="text-xs text-muted-foreground line-clamp-2 leading-snug">
        {{ candidate.subtitle }}
      </span>
      <span class="flex items-center gap-1.5 flex-wrap">
        <span class="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md" :style="providerBadgeStyle(candidate.provider)">
          {{ providerLabel }}
        </span>
        <span v-if="candidate.publishedYear" class="text-[10px] text-muted-foreground tabular-nums">{{ candidate.publishedYear }}</span>
        <span v-if="candidate.pageCount" class="text-[10px] text-muted-foreground tabular-nums">{{ candidate.pageCount }}p</span>
        <span v-if="communityRatingDisplay" class="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
          <Star class="size-3 text-primary" />
          {{ communityRatingDisplay }}
        </span>
      </span>
    </span>
  </button>
</template>
