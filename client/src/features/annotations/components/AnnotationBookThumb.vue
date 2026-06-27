<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen } from '@lucide/vue'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const props = defineProps<{ bookId: number; title?: string | null }>()

const { coverUrl } = useCoverVersions()
const failed = ref(false)
const src = computed(() => coverUrl(props.bookId, 'thumbnail'))

watch(
  () => props.bookId,
  () => {
    failed.value = false
  },
)

function handleError() {
  failed.value = true
}
</script>

<template>
  <span class="relative flex shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
    <img v-if="!failed" :src="src" :alt="title ?? ''" loading="lazy" class="h-full w-full object-cover" @error="handleError" />
    <BookOpen v-else :size="14" class="text-muted-foreground/60" />
  </span>
</template>
