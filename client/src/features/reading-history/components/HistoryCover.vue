<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isAudioFormat, type ReadingHistoryItem } from '@bookorbit/types'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const props = defineProps<{
  item: Pick<ReadingHistoryItem, 'id' | 'bookId' | 'title' | 'authors' | 'coverVersion' | 'format' | 'removedAt' | 'seriesName' | 'seriesIndex'>
}>()

const { coverUrl } = useCoverVersions()
const failed = ref(false)

watch(
  () => [props.item.bookId, props.item.coverVersion],
  () => {
    failed.value = false
  },
)

const src = computed(() => (props.item.bookId === null || failed.value ? null : coverUrl(props.item.bookId, 'thumbnail', props.item.coverVersion)))
const seed = computed(() => (props.item.bookId === null ? `read-${props.item.id}` : String(props.item.bookId)))
const isAudio = computed(() => !!props.item.format && isAudioFormat(props.item.format))

function handleError() {
  failed.value = true
}
</script>

<template>
  <!-- Decorative: every place a cover appears names the book beside it. -->
  <span
    class="relative block shrink-0 overflow-hidden border border-border bg-muted"
    :class="item.removedAt ? 'opacity-55 grayscale' : undefined"
    aria-hidden="true"
  >
    <img v-if="src" :src="src" alt="" loading="lazy" decoding="async" class="absolute inset-0 h-full w-full object-cover" @error="handleError" />
    <BookCoverPlaceholder
      v-else
      :title="item.title"
      :authors="item.authors"
      :series-name="item.seriesName"
      :series-index="item.seriesIndex"
      :is-audio="isAudio"
      :seed="seed"
    />
  </span>
</template>
