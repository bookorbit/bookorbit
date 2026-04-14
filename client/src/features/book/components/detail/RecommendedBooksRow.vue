<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useRecommendations } from '@/features/book/composables/useRecommendations'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const props = defineProps<{ bookId: number }>()
const router = useRouter()
const { recommendations, loading, fetch } = useRecommendations()
const { coverUrl } = useCoverVersions()

const scrollEl = ref<HTMLElement | null>(null)

watch(
  () => props.bookId,
  (id) => fetch(id),
  { immediate: true },
)

function scroll(direction: 'left' | 'right') {
  if (!scrollEl.value) return
  scrollEl.value.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' })
}
</script>

<template>
  <div v-if="loading || recommendations.length > 0" class="mt-8 pt-6 border-t border-border">
    <div class="flex items-center justify-between mb-4">
      <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">More Like This</p>
      <div class="flex items-center gap-1">
        <button
          class="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="scroll('left')"
        >
          <ChevronLeft :size="14" />
        </button>
        <button
          class="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="scroll('right')"
        >
          <ChevronRight :size="14" />
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex gap-3 overflow-x-auto pb-2">
      <div v-for="i in 10" :key="i" class="w-24 shrink-0">
        <div class="w-full rounded-sm bg-muted animate-shimmer" style="aspect-ratio: 2/3" />
      </div>
    </div>

    <div v-else ref="scrollEl" class="flex gap-6 overflow-x-auto pb-2">
      <button
        v-for="(rec, index) in recommendations"
        :key="rec.id"
        class="w-30 shrink-0 text-left group animate-fade-up"
        :style="{ animationDelay: `${index * 40}ms` }"
        @click="router.push({ name: 'book-detail', params: { bookId: rec.id } })"
      >
        <div
          class="w-full rounded-sm overflow-hidden shadow-sm group-hover:shadow-md group-hover:scale-[1.02] transition-all duration-150"
          style="aspect-ratio: 2/3"
          :style="bookCoverStyle(rec.title ?? String(rec.id))"
        >
          <img
            :src="coverUrl(rec.id, 'thumbnail')"
            :alt="rec.title ?? ''"
            class="w-full h-full object-cover transition-opacity duration-300 ease-out"
            loading="lazy"
            @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
          />
        </div>
      </button>
    </div>
  </div>
</template>
