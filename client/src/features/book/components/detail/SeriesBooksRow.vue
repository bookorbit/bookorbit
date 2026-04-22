<script setup lang="ts">
import { watch, computed } from 'vue'

import { useSeriesBooks } from '@/features/book/composables/useSeriesBooks'
import BookCarousel from '@/features/book/components/detail/BookCarousel.vue'

const props = defineProps<{
  bookId: number
  seriesName: string
}>()

const { seriesBooks, loading, fetch } = useSeriesBooks()

watch(
  () => props.bookId,
  (id) => fetch(id),
  { immediate: true },
)

const bookIds = computed(() => seriesBooks.value.map((b) => b.id))

defineExpose({ bookIds })
</script>

<template>
  <div v-if="loading || seriesBooks.length > 0" class="mt-8 pt-6 border-t border-border">
    <BookCarousel :books="seriesBooks" :loading="loading" :current-book-id="bookId" :show-series-index="true">
      <template #header>
        <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          More in the <span class="italic">{{ seriesName }}</span> series
        </p>
      </template>
    </BookCarousel>
  </div>
</template>
