<script setup lang="ts">
import { computed } from 'vue'
import type { MetadataCandidate, MetadataProviderInfo } from '@projectx/types'
import { getProviderLabel, hideOnError } from '../../../lib/metadata-fetch'

const props = defineProps<{
  candidate: MetadataCandidate
  providers: MetadataProviderInfo[]
}>()

defineEmits<{ select: [MetadataCandidate] }>()

const providerLabel = computed(() => getProviderLabel(props.candidate.provider, props.providers))
</script>

<template>
  <button
    class="w-full flex gap-3 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 text-left transition-colors group"
    @click="$emit('select', candidate)"
  >
    <!-- Cover thumbnail -->
    <div class="shrink-0 w-10 rounded overflow-hidden bg-muted" style="aspect-ratio: 2/3">
      <img
        v-if="candidate.coverUrl"
        :src="candidate.coverUrl"
        :alt="candidate.title"
        class="w-full h-full object-cover"
        @error="hideOnError"
      />
    </div>

    <!-- Info -->
    <div class="flex-1 min-w-0 space-y-0.5">
      <p class="text-sm font-medium leading-snug truncate group-hover:text-foreground">{{ candidate.title }}</p>
      <p v-if="candidate.authors?.length" class="text-xs text-muted-foreground truncate">
        {{ candidate.authors.join(', ') }}
      </p>
      <div class="flex items-center gap-2 pt-0.5">
        <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {{ providerLabel }}
        </span>
        <span v-if="candidate.publishedYear" class="text-[10px] text-muted-foreground">
          {{ candidate.publishedYear }}
        </span>
        <span v-if="candidate.pageCount" class="text-[10px] text-muted-foreground">
          {{ candidate.pageCount }}p
        </span>
      </div>
    </div>
  </button>
</template>
