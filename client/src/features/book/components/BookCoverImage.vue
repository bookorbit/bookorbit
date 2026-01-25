<script setup lang="ts">
import { computed } from 'vue'
import { useCoverVersions } from '../composables/useCoverVersions'

const props = defineProps<{
  bookId: number
  type?: 'thumbnail' | 'cover'
  class?: string
  alt?: string
}>()

const { getVersion } = useCoverVersions()
const src = computed(() => {
  const base = `/api/books/${props.bookId}/${props.type ?? 'thumbnail'}`
  const v = getVersion(props.bookId)
  return v ? `${base}?t=${v}` : base
})
</script>

<template>
  <img :src="src" :class="props.class" :alt="props.alt ?? ''" loading="lazy" />
</template>
