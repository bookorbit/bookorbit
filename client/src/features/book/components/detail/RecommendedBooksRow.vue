<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'

import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useRecommendations } from '@/features/book/composables/useRecommendations'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const props = defineProps<{ bookId: number }>()
const router = useRouter()
const { recommendations, loading, fetch } = useRecommendations()
const { coverUrl } = useCoverVersions()

watch(() => props.bookId, (id) => fetch(id), { immediate: true })
</script>

<template>
  <div v-if="loading || recommendations.length > 0" class="mt-8 pt-6 border-t border-border">
    <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">More Like This</p>

    <div v-if="loading" class="flex gap-3 overflow-x-auto pb-2">
      <div v-for="i in 10" :key="i" class="w-24 shrink-0">
        <div class="w-full rounded-sm bg-muted animate-pulse" style="aspect-ratio: 2/3" />
      </div>
    </div>

    <div v-else class="flex gap-6 overflow-x-auto pb-2">
      <button
        v-for="rec in recommendations"
        :key="rec.book.id"
        class="w-30 shrink-0 text-left group"
        @click="router.push({ name: 'book-detail', params: { bookId: rec.book.id } })"
      >
        <div
          class="w-full rounded-sm overflow-hidden shadow-sm group-hover:shadow-md group-hover:scale-[1.02] transition-all duration-150"
          style="aspect-ratio: 2/3"
          :style="bookCoverStyle(rec.book.title ?? String(rec.book.id))"
        >
          <img
            :src="coverUrl(rec.book.id, 'thumbnail')"
            :alt="rec.book.title ?? ''"
            class="w-full h-full object-cover"
            loading="lazy"
            @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
          />
        </div>
      </button>
    </div>
  </div>
</template>
