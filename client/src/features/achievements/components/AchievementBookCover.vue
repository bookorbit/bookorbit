<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen } from '@lucide/vue'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const props = defineProps<{
  bookId: number
}>()

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
  <span
    class="relative flex aspect-[2/3] shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-border bg-muted"
    aria-hidden="true"
  >
    <img v-if="!failed" :src="src" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" @error="handleError" />
    <BookOpen v-else :size="12" class="text-muted-foreground" />
  </span>
</template>
