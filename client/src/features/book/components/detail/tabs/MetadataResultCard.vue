<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { BookOpen } from 'lucide-vue-next'
import type { MetadataCandidate, MetadataProviderInfo } from '@projectx/types'
import { getProviderLabel, hideOnError, providerBadgeStyle } from '../../../lib/metadata-fetch'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'

const props = defineProps<{
  candidate: MetadataCandidate
  providers: MetadataProviderInfo[]
}>()

const emit = defineEmits<{ select: [MetadataCandidate] }>()

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const providerLabel = computed(() => getProviderLabel(props.candidate.provider, props.providers))

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
        v-if="candidate.coverUrl"
        :src="candidate.coverUrl"
        :alt="candidate.title"
        class="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
        @error="hideOnError"
      />
      <span v-else class="absolute inset-0 flex items-center justify-center bg-linear-to-br from-surface-2 to-surface-4">
        <BookOpen class="size-6 text-muted-foreground/25" />
      </span>
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
      </span>
    </span>
  </button>
</template>
