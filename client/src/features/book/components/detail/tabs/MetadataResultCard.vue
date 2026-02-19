<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, ChevronRight } from 'lucide-vue-next'
import type { MetadataCandidate, MetadataProviderInfo } from '@projectx/types'
import { getProviderLabel, hideOnError, providerBadgeStyle } from '../../../lib/metadata-fetch'

const props = defineProps<{
  candidate: MetadataCandidate
  providers: MetadataProviderInfo[]
}>()

defineEmits<{ select: [MetadataCandidate] }>()

const providerLabel = computed(() => getProviderLabel(props.candidate.provider, props.providers))
</script>

<template>
  <button
    class="group relative flex flex-row gap-3 p-2.5 rounded-xl border border-border/60 bg-card text-left transition-all hover:border-border hover:shadow-md hover:-translate-y-px active:scale-[0.98] active:shadow-sm overflow-hidden w-full"
    @click="$emit('select', candidate)"
  >
    <!-- Cover -->
    <span class="relative shrink-0 rounded-lg overflow-hidden bg-muted block shadow-sm" style="width: 64px; aspect-ratio: 2/3">
      <img
        v-if="candidate.coverUrl"
        :src="candidate.coverUrl"
        :alt="candidate.title"
        class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        @error="hideOnError"
      />
      <span v-else class="absolute inset-0 flex items-center justify-center bg-linear-to-br from-surface-2 to-surface-4">
        <BookOpen class="size-5 text-muted-foreground/25" />
      </span>
    </span>

    <!-- Info -->
    <span class="flex-1 min-w-0 flex flex-col justify-center gap-1 py-0.5">
      <span class="text-sm font-semibold leading-snug line-clamp-2 text-foreground">{{ candidate.title }}</span>
      <span v-if="candidate.authors?.length" class="text-xs text-muted-foreground truncate block leading-tight">
        {{ candidate.authors.join(', ') }}
      </span>
      <span class="flex items-center gap-1.5 flex-wrap">
        <span
          class="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md"
          :style="providerBadgeStyle(candidate.provider)"
        >
          {{ providerLabel }}
        </span>
        <span v-if="candidate.publishedYear" class="text-[10px] text-muted-foreground tabular-nums">{{ candidate.publishedYear }}</span>
        <span v-if="candidate.pageCount" class="text-[10px] text-muted-foreground tabular-nums">{{ candidate.pageCount }}p</span>
      </span>
    </span>

    <!-- Arrow -->
    <span class="shrink-0 self-center opacity-0 group-hover:opacity-100 transition-all -translate-x-1 group-hover:translate-x-0">
      <ChevronRight class="size-4 text-muted-foreground" />
    </span>
  </button>
</template>
