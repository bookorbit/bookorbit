<script setup lang="ts">
import { watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useRecommendations } from '@/features/book/composables/useRecommendations'
import BookCarousel from '@/features/book/components/detail/BookCarousel.vue'

const props = withDefaults(
  defineProps<{
    bookId: number
    excludeBookIds?: number[]
  }>(),
  {
    excludeBookIds: () => [],
  },
)

const { t } = useI18n()
const { recommendations, loading, fetch } = useRecommendations()

watch(
  () => props.bookId,
  (id) => fetch(id),
  { immediate: true },
)

const filteredRecommendations = computed(() => {
  if (props.excludeBookIds.length === 0) return recommendations.value
  const excluded = new Set(props.excludeBookIds)
  return recommendations.value.filter((r) => !excluded.has(r.id))
})
</script>

<template>
  <div v-if="loading || filteredRecommendations.length > 0" class="mt-8 pt-6 border-t border-border">
    <BookCarousel :books="filteredRecommendations" :loading="loading">
      <template #header>
        <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{{ t('book.detail.recommended.moreLikeThis') }}</p>
      </template>
    </BookCarousel>
  </div>
</template>
