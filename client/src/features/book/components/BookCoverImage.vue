<script setup lang="ts">
import { computed } from 'vue'
import { useCoverVersions } from '../composables/useCoverVersions'

const props = defineProps<{
  bookId: number
  type?: 'thumbnail' | 'cover'
  class?: string
  alt?: string
}>()

const { coverUrl } = useCoverVersions()
const src = computed(() => coverUrl(props.bookId, props.type ?? 'thumbnail'))
</script>

<template>
  <img :src="src" :class="props.class" :alt="props.alt ?? ''" loading="lazy" />
</template>
